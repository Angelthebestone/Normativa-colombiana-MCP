## Context

Ver proposal.md - Why. El sistema es un MCP TypeScript (src/) con un bundle server/index.js (esbuild, cero dependencias de runtime), un núcleo http.ts con cola por dominio y ritmo, parsers por fuente en src/fuentes/, un registro de adaptadores sectoriales en src/fuentes/sectorial/registro.ts con contrato `Adaptador` (dominioPermitido, tiposDocumento, soportaTexto, soportaVigencia, pruebasMinimas, advertencia), y una capa de extracción de PDF/Word best-effort (unpdf + pedirBytes + pdfEsEscaneo) ya especificada en sectorial/pdf-texto y desplegada en obtener_documento.

Restricciones que condicionan el diseño:
- `http.ts` centraliza TLS/CA, cola por dominio (1/s sostenido), reintento 429/503; ninguna fuente salta este camino.
- El bundle se reconstruye con `npm run build` y el peso se vigila (taste del proyecto: cero deps de runtime, bundle único).
- El proyecto ya usa cheerio para HTML (consejoestado, parques, sic) y `textoDe(cargar(...))` para extraer texto de HTML.
- Los índices empaquetados (temático, SUIN) viajan en `datos/` y son snapshots con fecha de generación.
- La semántica de términos ya existe en la Suprema (`exacto` con fallback OR declarado); Consejo de Estado no la tiene.

## Goals / Non-Goals

**Goals:**
- Que `buscar_normativa_upme` encuentre actos cuyo término está solo en el PDF, vía fallback al buscador del portal (SearchWP) cuando el REST devuelve 0.
- Que el Consejo de Estado tenga modo frase exacta con la misma semántica observable que la Suprema.
- Que los totales declarados cuenten documentos únicos (dedup por número/radicado) antes de paginar.
- Que la DIAN sirva búsquedas repetidas por término desde su caché existente, con TTL y rotulación de frescura.
- Que exista `consultar_vigencia` como herramienta única con nivel de confianza por fuente.
- Que INVIMA/Supersalud puedan filtrar "solo actos de la entidad", que `buscar_unificado` sume perfiles salud/minería, que se advierta de portal roto y de snapshot antiguo, y que el opt-in de expedientes se explique.
- Que `verificar` (comando único) garantice cobertura por tool, tests de parser con fixtures congelados y detección de regresiones de portal por barrido de términos.

**Non-Goals:**
- NO reescribir el contrato `Adaptador` ni el registro sectorial.
- NO extraer texto de PDF masivamente en todas las sectoriales en este cambio (la extracción best-effort ya existe; aquí solo se añade el fallback del buscador UPME como piloto y la rotulación).
- NO añadir nuevos reguladores desde cero (CRC, Superservicios, normativa territorial) — son fases separadas, declaradas en el proposal como fuera de alcance.
- NO cambiar el modelo de activación de expedientes (sigue `EXPEDIENTES=1`), solo su descubrimiento.

## Decisions

### 1. Fallback UPME: consultar el buscador del portal `?q=` cuando el REST devuelve vacío
El REST de WordPress (`circular_resolucion?search=`) no indexa el contenido de los PDF adjuntos; el portal sí (SearchWP). Decisión: en `upme.buscar`, cuando `texto` está presente y el REST devuelve 0 items, se consulta `https://www.upme.gov.co/nosotros/biblioteca-juridica/biblioteca-juridica/?q=<texto>` vía `pedir` (HTML), se parsean las tarjetas `.bj-tarjeta` con cheerio (título, epígrafe, fecha, categoría, enlace PDF) y se rotulan como `resultados del buscador del portal, que indexa el contenido del PDF`. La paginación del portal se respeta si el HTML expone un paginador; si no, se devuelve la primera página con nota.
- **Alternativa considerada**: usar `/wp-json/wp/v2/search` (búsqueda global de WP). Descartada: no cubre el post type `circular_resolucion` con el contenido de PDFs; devuelve páginas/ufaq, no la normativa.
- **Alternativa considerada**: extraer el PDF y buscar dentro. Descartada como mecanismo del buscador: no hay lista exhaustiva de PDFs y sería N descargas por consulta; el fallback al índice del portal es más barato y es lo que el usuario ve.

### 2. Dedup: clave estable por tipo+numero+anio (sectorial) o radicado (jurisprudencia)
Se aplica post-parse, antes de paginar: un `Map<clave, item>` conserva la primera entrada y cuenta las fusionadas. La clave se normaliza con `sinTildes` y mayúsculas. En jurisprudencia se usa el radicado si existe, si no el par url-normalizado. El total declarado pasa a ser `uniqueCount` y se añade `N duplicado(s) fusionado(s)`. Si el portal declara un total mayor (porque su contador incluye duplicados), se declara el total del portal y el deduplicado estimado.
- **Alternativa considerada**: dedup por URL. Insuficiente: el mismo fallo en `.doc` y `.pdf` tiene URLs distintas.

### 3. Caché por término: extender la caché existente de la DIAN con TTL y rotulación
La DIAN ya cachea por término en `src/fuentes/normograma.ts` (`Map` sin TTL, con el comentario explícito de que un proceso MCP vive lo que la conversación). Decisión: NO crear un módulo nuevo de caché; se añade a la caché existente un TTL (default 30 min) y una marca `deCache` en la respuesta. La caché vive en memoria del proceso. Un fallo de red NUNCA se sirve como fresco: si hay caché, se ofrece rotulada como obsoleta.
- **Alternativa considerada**: caché genérica en `src/nucleo/cache.ts`. Descartada: la DIAN ya tiene la suya y el patrón no se repite en otras fuentes; añadir un helper genérico sería sobre-ingeniería para un solo caso.
- **Alternativa considerada**: caché en disco. Descartada: el MCP no persiste estado de sesión; memoria es suficiente.

### 4. `consultar_vigencia`: orquestación sobre `resolver_cita` + ficha SUIN + confianza por fuente
Nueva herramienta que reutiliza `resolver_cita` (que ya integra Gestor y la ficha SUIN directa con caché 30 min). Devuelve: estado, URL de ficha, `confianza` (`alta` Gestor/ficha directa; `media` índice SUIN; `baja` sin cobertura) y la explicación. No duplica lógica: llama a los módulos existentes y solo añade el nivel de confianza y el mensaje unificador. Se registra en `src/index.ts` como herramienta nueva.
- **Alternativa considerada**: ampliar `resolver_cita` con un campo `confianza`. Descartada: cambiaría el contrato de una herramienta usada por analizar_conflicto; mejor una herramienta nueva que lo envuelva.

### 5. `solo_entidad` en INVIMA/Supersalud: filtro por tipo documental propio
Ambos adaptadores devuelven la compilación del sector (leyes, decretos, sentencias) además de actos propios. Decisión: un parámetro `solo_entidad` (default `false`) en `buscar_normativa_sectorial` que, cuando es `true`, filtra los resultados al tipo de acto propio de la entidad (resoluciones/circulares para INVIMA/Supersalud), dejando la compilación para `false`. Se implementa en el adaptador (que ya conoce sus `tiposDocumento`), no en el orquestador.
- **Alternativa considerada**: nueva fuente separada. Descartada: duplica el parser; un filtro en el adaptador es más simple y no rompe el contrato.

### 6. Portal roto: comparación conservadora epígrafe vs. nombre de archivo
Helper en `src/nucleo/` que extrae el número del epígrafe (`/\b(\d{2,6})\b/` tras el tipo) y el número del nombre del archivo; solo marca discordancia si el epígrafe tiene número Y el nombre del archivo tiene un número distinto (o el nombre es un patrón claro tipo `HONORARIOS` sin número). Nombres genéricos (`documento.pdf`) no marcan. Se aplica en los adaptadores sectoriales que devuelven PDF, como campo `advertencia` adicional no bloqueante.

### 7. Snapshot antiguo: metadatos de fecha en los índices + advertencia
Los índices `datos/*.json` llevan (o se les añade) una fecha de generación. Un helper `advertenciaSnapshot(fecha, umbral=30d)` devuelve el texto cuando aplica. Se integra en las respuestas que usan el índice temático y el de SUIN.

### 8. Perfiles salud/minería en `buscar_unificado`
Extender el mapa de perfiles existente: `salud → [invima, supersalud]`, `mineria → [anm]`. El federado ya sabe fan-out por perfil; solo se añaden entradas y sus fuentes al fan-out, reutilizando `buscar_normativa_sectorial` con el `entidad` correspondiente.

### 9. Autoverificación: comando único de salud + cobertura por tool + fixtures + barrido
La red de regresión ya existe (`test/red*.ts` arranca el bundle y ejerce tools), pero no hay un comando único ni garantía de cobertura. Decisión: un script `scripts/verificar.ts` (npm script `verificar`) que orquesta la cadena con `spawn`/`node:test`: build → typecheck → unit → red contra bundle → smoke. Mantiene un mapa `tool → archivo de pruebas` (derivable de `tools/list` y los archivos `test/red*.ts`) y rompe si una tool publicada no tiene caso. Los parsers se prueban contra `test/fixtures/` (HTML/JSON real medido congelado) para que los tests unitarios no dependan de la red viva; el smoke sigue vivo y separado. Un barrido de términos por fuente con resultados conocidos detecta "término que antes rendía y ahora vacío" (caso UPME), distinguiendo `vacío` de `red`.
- **Alternativa considerada**: GitHub Actions/CI externo. Descartada: el proyecto es minimalista en infra; el comando local sirve igual y no depende de un runner.
- **Alternativa considerada**: cobertura de código (nyc/istanbul). Descartada: añade dependencias y el valor está en el mapa tool→casos, no en el porcentaje.

### 10. `historial_norma`: estructurar el parser `historial()` existente como cadena navegable
El parser `historial(texto)` en `src/nucleo/parse.ts` ya devuelve `Cambio[]` con `{accion, norma, anio, articulo, literal}` desde las notas del Gestor (tres formas: pasiva, activa entre paréntesis, control constitucional). Decisión: NO reimplementar el parseo; se expone el historial como herramienta nueva (`historial_norma(cita)`) o ampliando `obtener_documento` con `historial=true` (que ya existe para el Gestor). El resultado se estructura como cadena navegable: acción → norma (año) → artículo afectado → literal citable, con tope declarado (p.ej. 20) y sin deducir vigencia (remite a `resolver_cita`). Verificable con fixtures del texto del Gestor (las tres formas de nota), sin red.
- **Alternativa considerada**: nueva capacidad de consolidación de texto (unir reformas al texto base). Descartada: es un proyecto propio (consolidación normativa) y excede este cambio; aquí solo se estructura lo que el Gestor ya anota.

### 11. Patrones de cumplimiento: ampliar `clasificarDiferencia` en `diff.ts`
La clasificación actual en `diff.ts` tiene 4 patrones (`plazo`, `sancion`, `excepcion`, `sujeto`) evaluados en orden, gana el primero. Decisión: añadir patrones léxicos de cumplimiento (prohibiciones: "queda prohibido", "no podrá"; obligaciones: "el responsable deberá", "estará obligado a"; plazos concretos: "dentro de los X días hábiles", "a más tardar") al mismo mecanismo, en `diff.ts`, sin dependencias nuevas. Se declara el límite léxico en `DESCRIPCION` y `CIERRE` (sinonimia real queda en `no clasificado`). Verificable con casos directos sin red.
- **Alternativa considerada**: modelo semántico (LLM) para clasificar. Descartada: coste y no-determinismo; el proyecto declara explícitamente "sin modelo semántico" y el valor está en ampliar los patrones baratos.

## Risks / Trade-offs

- [El HTML del portal UPME cambia (rediseño de la Biblioteca Jurídica) y el selector `.bj-tarjeta` deja de existir] → Mitigación: el fallback degrada a "portal no parseable" y devuelve el enlace del buscador al usuario, sin romper el camino REST; se documenta el selector en el código y en tests de fixture.
- [El fallback UPME duplica latencia (REST vacío + HTML del portal)] → Mitigación: solo se dispara cuando el REST devuelve 0 items Y hay texto; es el caso de menor frecuencia (el resto ya rinde). La caché por término (Decisión 3) puede amortiguarlo.
- [Dedup por tipo+numero+anio puede fusionar normas distintas si el portal usa el mismo número para dos actos del mismo año] → Mitigación: la clave incluye el tipo (Resolución ≠ Circular) y, cuando el epígrafe difiere materialmente, se conservan ambas y solo se fusionan entradas con epígrafe normalizado igual o muy similar.
- [`solo_entidad` depende de que el adaptador distinga actos propios de la compilación por tipo; puede clasificar mal sentencias de altas cortes] → Mitigación: el filtro se basa en la lista `tiposDocumento` del adaptador (ya declarada) y se documenta en la respuesta qué tipos se consideraron propios.
- [La caché devuelve datos que pueden quedar desactualizados si el portal actualiza rápido] → Mitigación: TTL corto (30 min) y rotulación explícita `deCache`; la semántica de términos no cambia.
- [La advertencia de portal roto puede generar ruido si el nombre del archivo es una variante no detectada] → Mitigación: regla conservadora (solo número presente y distinto, o patrón claro sin número); sin número en el archivo, no se advierte.

## Migration Plan

- Cambios aditivos y retrocompatibles: `exacto` (default `true` en Consejo de Estado, igual que Suprema), `solo_entidad` (default `false`), perfiles nuevos, `consultar_vigencia` nueva, caché transparente, advertencias opcionales.
- El fallback UPME y el dedup cambian el contenido de respuestas existentes solo en los casos donde hoy se devuelve vacío o totales inflados; no rompen parsers.
- Rollback: cada pieza es independiente y se revierte por archivo; el bundle se reconstruye con `npm run build`.
- Los índices con fecha de generación: si un índice existente no trae fecha, la advertencia se omite (comportamiento actual), no se inventa.

## Open Questions

- Umbral exacto del snapshot (30 vs. 60 días) y TTL de caché (30 min) son configurables; los defaults se fijan en tasks y se pueden ajustar sin cambiar specs.
- Si el portal de la UPME expone paginación real en el HTML del buscador `?q=` (más allá de la primera página) se decide en implementación, conservando el contrato (el fallback devuelve lo que el HTML permita, con nota).
