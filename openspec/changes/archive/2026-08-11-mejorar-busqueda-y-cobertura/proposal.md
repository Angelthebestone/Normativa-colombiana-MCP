## Why

Una auditoría práctica del MCP contra portales reales reveló que la exhaustividad de las búsquedas está limitada por tres problemas: (1) la mayoría de fuentes sectoriales solo indexan el título (el término está en el PDF, no en el índice del portal), (2) varias herramientas no permiten medir pertinencia (OR sin modo frase exacta, duplicados que inflan el total, paginación limitada), y (3) hay capacidades útiles ya implementadas pero mal descubiertas o con latencia evitable (índices snapshot sin advertencia de antigüedad, expedientes opt-in, DIAN lenta en la primera consulta). Este cambio ataca los puntos de mayor retorno sin rehacer lo que ya está especificado.

## What Changes

- **UPME**: añadir fallback al buscador del portal (`?q=`) cuando el REST de WordPress devuelve 0 resultados, porque el portal indexa el contenido del PDF (SearchWP) que wp-json no. Es el piloto del problema general "término en el PDF, no en el índice".
- **Consejo de Estado**: añadir modo frase exacta (`exacto=true`) con la misma semántica que la Corte Suprema. Nota verificada: el CE ya aplica un filtro local AND (`contienenTodas` exige todos los términos sobre problema/respuesta/nota y lo declara); lo que falta es el modo frase exacta en la consulta a SAMAI (`searchMode`), no el AND.
- **Deduplicación**: deduplicar resultados por número de norma (sectorial) o radicado (jurisprudencia) antes de paginar, para que el total declarado corresponda a documentos únicos (Minagricultura, Mintrabajo, Corte Suprema). Nota verificada: el sistema no puede corregir el total del portal, solo declarar el dedup estimado.
- **DIAN**: **ya existe una caché por término** en `normograma.ts` (`Map` sin TTL, con el comentario "un proceso MCP vive lo que la conversación, así que no hace falta TTL"). La mejora real es añadir TTL para servicio largo y que la respuesta rotule cuándo viene de caché — no implementar la caché desde cero.
- **`consultar_vigencia`**: nueva herramienta central que intenta `resolver_cita` primero y expone un nivel de confianza según la fuente (Gestor confiable, SUIN con contradicciones conocidas, sectoriales sin verificación).
- **INVIMA/Supersalud**: parámetro `solo_entidad` para filtrar actos propios vs. compilación completa del sector (hoy mezclan leyes, decretos y sentencias con sus propios actos).
- **`buscar_unificado`**: ampliar perfiles a `salud` y `mineria` (INVIMA, Supersalud, ANM), que ya funcionan por separado.
- **Detección de portal roto**: advertencia automática cuando el número citado en el epígrafe no corresponde al nombre del archivo enlazado (documentado en Parques Nacionales y Mintrabajo), sin bloquear el resultado.
- **Advertencia de snapshot antiguo**: los índices empaquetados (temático, SUIN) muestran una advertencia cuando su fecha de generación supera un umbral (p.ej. 30/60 días).
- **Expedientes**: el mensaje de desactivación explicado **ya existe** (`AVISO_DESACTIVADO` en `expedientes.ts`). La mejora restante es documentar el opt-in en la descripción de la herramienta y en `describir_fuentes`, no reimplementar el aviso.
- **Autoverificación**: un comando único de salud (`npm run verificar`) que ejecute build → typecheck → tests unitarios → red de regresión contra el bundle → smoke, con garantía de cobertura por tool (una tool nueva sin casos rompe), fixtures congelados para parsers (tests deterministas sin red viva), y detección de "término que antes rendía y ahora da vacío" para cazar portales que cambiaron. Es lo que evita "probar el MCP a cada rato".
- **Documentación de `listar_catalogos(catalogo="temas")`** como paso previo recomendado a `buscar_por_tema`, y de `analizar_conflicto` como "reúne evidencia, no concluye". (Un fallback automático al catálogo temático se descartó: requeriría una tabla de sinónimos que no escala; la documentación cubre el caso sin hardcodear.)
- **`historial_norma`**: cadena de reformas navegable de una norma (qué la modificó/adicionó/derogó y qué artículo afectó cada cambio). El parser `historial()` ya extrae `Cambio[]` desde las notas del Gestor; falta estructurarlo como cadena navegable y exponerlo como herramienta (o ampliar `obtener_documento` con `historial=true`).
- **Extracción de obligaciones/sujetos/plazos por patrones**: ampliar la clasificación de `comparar_articulos` (`clasificarDiferencia` en `diff.ts`) más allá de los patrones actuales (`plazo`, `sancion`, `excepcion`, `sujeto`) para cubrir cumplimiento ("queda prohibido", "el responsable deberá", plazos concretos), sin modelo semántico, declarando el límite léxico.

## Capabilities

### New Capabilities

- `busqueda/frase-exacta-consejo-estado`: modo frase exacta para el buscador del Consejo de Estado, con la misma semántica declarada que la Suprema (exacto por defecto, OR explícito como fallback).
- `busqueda/deduplicacion-resultados`: deduplicación por número de norma o radicado antes de paginar, con total de únicos declarado.
- `busqueda/cache-por-termino`: cache en memoria con TTL para búsquedas repetidas por término (aplicado primero a DIAN), sin invalidar semántica ni ritmo.
- `sectorial/portal-roto`: detección de discordancia entre el número citado en el epígrafe y el nombre del archivo enlazado, como advertencia no bloqueante.
- `vigencia/consultar-vigencia-central`: herramienta única que consolida `resolver_cita` + nivel de confianza por fuente.
- `busqueda/perfiles-ampliados`: perfiles `salud` y `mineria` en `buscar_unificado`.
- `pruebas/autoverificacion`: comando único de salud, garantía de cobertura por tool, fixtures congelados y barrido de términos con resultados previos.
- `historial/historial-norma`: cadena de reformas navegable de una norma a partir del parser `historial()` existente.
- `comparar-articulos/patrones-cumplimiento`: ampliación de los patrones de clasificación de `comparar_articulos` para obligaciones, sujetos y plazos de cumplimiento.

### Modified Capabilities

- `sectorial/pdf-texto`: **la extracción de texto ya está especificada**; este cambio añade el requisito de que el **buscador** (no solo `obtener_documento`) pueda localizar actos cuyo término está solo en el PDF, empezando por UPME como caso piloto.
- `busqueda/busqueda-federada`: ampliar el conjunto de perfiles de `buscar_unificado` (nuevos `salud`, `mineria`) y añadir la advertencia de snapshot antiguo en las fuentes de índice.
- `expedientes/expedientes-persistentes`: mejorar el descubrimiento del opt-in (mensaje de desactivación claro, documentación), sin cambiar el contrato de activación.

## Impact

- **Código**: `src/fuentes/upme.ts`, `src/fuentes/jurisprudencia/consejoestado.ts`, `src/fuentes/jurisprudencia/corte.ts` (dedup Suprema), `src/fuentes/sectorial/{minagricultura,mintrabajo,invima,supersalud}.ts`, `src/fuentes/normograma.ts` (TTL + rotulación de caché), `src/herramientas/buscar_unificado.ts`, `src/index.ts` (registro de `consultar_vigencia`, `solo_entidad`, advertencias, `historial_norma`), `src/nucleo/` (helpers de cache, snapshot, historial). **Patrones**: `src/herramientas/diff.ts`. **Autoverificación**: `scripts/verificar.ts` (o npm script), `test/fixtures/` (snapshots congelados), ampliación de `scripts/barrido-disruptivo.ts` o nuevo barrido de términos con resultados previos, mapa tool→pruebas.
- **Nuevas herramientas MCP**: `consultar_vigencia`; parámetros nuevos en `buscar_normativa_sectorial` (`solo_entidad`), `buscar_jurisprudencia_consejo_estado` (`exacto`), `buscar_unificado` (`perfil` ampliado). **No es herramienta MCP**: `verificar` es un comando de desarrollo/CI.
- **Datos**: índices empaquetados ganan metadatos de antigüedad para la advertencia.
- **Dependencias**: ninguna nueva de runtime; se reutilizan `unpdf`, `cheerio`, `pedir`/`http.ts` existentes.
- **Compatibilidad**: `exacto` nuevo parámetro opcional (default preserva comportamiento actual); `solo_entidad` opcional (default `false`); `consultar_vigencia` es aditiva. No hay **BREAKING**.
