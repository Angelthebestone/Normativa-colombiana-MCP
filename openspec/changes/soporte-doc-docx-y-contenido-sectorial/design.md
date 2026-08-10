## Context

El MCP ya tiene una arquitectura de adaptadores sectoriales (`src/fuentes/sectorial/*.ts` + `registro.ts`, contrato `Adaptador` con `dominioPermitido`, `tiposDocumento`, `soportaTexto`, `soportaVigencia`, `pruebasMinimas`, `advertencia` y `buscar()`), un lector de PDF best-effort (`src/fuentes/sectorial/pdf.ts`, `textoDePdfSectorial` con `unpdf` en `devDependencies`), un único punto de lectura (`src/herramientas/obtener_documento.ts` con `fuente` discriminador), y expedientes en memoria desactivados por defecto (`src/herramientas/expedientes.ts` + `src/nucleo/expediente.ts`, TTL 6 h, `EXPEDIENTES=1`). `http.ts` centraliza TLS/ritmo/reintentos; `unpdf` ya extrae PDF textual. Las limitaciones de buscadores están medidas: Gestor indexa solo resúmenes temáticos y une con OR; SUIN tiene huecos ("teletrabajo" → 0 pese al título de la Ley 1221 de 2008); la Corte Suprema busca sobre texto completo sin stopwords; el Consejo de Estado une con OR y el número de páginas no mide pertinencia.

## Goals / Non-Goals

**Goals:**
- Extraer el texto de documentos `.doc/.docx` sectoriales sin romper el contrato `soportaTexto=false`.
- Leer todas las pestañas/categorías de la Unidad de Víctimas (hoy solo informes) con filtro por `categoria`.
- Descargar resoluciones/documentos/providencias a una ruta local del usuario, validando dominio y escribiendo de forma segura.
- Permitir pedir el documento completo en `obtener_documento` (`entero=true` o `limite_caracteres=0`).
- Mejorar los buscadores por palabras: semántica de términos (AND/frase/OR declarado), stopwords y cierre de huecos SUIN.
- Hacer los expedientes activables y persistentes (opcional en disco), sin TTL fijo de 6 h.

**Non-Goals:**
- OCR de PDFs escaneados ni de `.doc` binario sin decodificador (se avisa "sin texto extraíble").
- Reindexar SUIN completo ni un motor de búsqueda semántica/LLM.
- Cambiar el contrato de búsqueda de los buscadores específicos por tribunal (siguen separados por anti-confusión).
- Hacer que los expedientes estén SIEMPRE activados por defecto sin configuración (la activación sigue siendo explícita, pero documentada y persistente).

## Decisions

**1. Lector Word vendoreado: `.docx` vía ZIP manual + `node:zlib`, `.doc` vía aviso.**
Un `.docx` es un ZIP con `word/document.xml`; se lee el directorio central con un lector ZIP mínimo (~60 líneas) y se infla con `node:zlib` (built-in, cero deps), parseando el XML a texto plano. Para `.doc` binario (OLE2, magic bytes `D0 CF 11 E0`) se devuelve el aviso "sin texto extraíble" (deuda abierta) sin dependencia nueva.
*Alternativa descartada:* `mammoth`/`textract`/`fflate` como dependencia — rompe `zero-dependencies` o añade ~200 KB al bundle; el patrón del repo es vendorizar (como `diff.ts`) y `node:zlib` ya está.

**2. `obtener_documento` gana `fuente="sectorial"` + `entero` + `ruta_destino` sin romper el esquema.**
Se añade `sectorial` al enum de `fuente` (con `entidad`/`url` del acto), y dos parámetros opcionales `entero: boolean` y `ruta_destino: string`. Sin ellos, el comportamiento actual (troceo) no cambia. **`entero=true` NO devuelve el texto íntegro por stdio**: escribe el archivo a disco (ruta dada con `ruta_destino`, o directorio temporal) y devuelve la ruta absoluta + un trozo de texto para leer. Devuelto el texto de 2 MB por el transporte MCP rompe límites prácticos; el archivo es la vía "completa". La descarga valida dominio y escribe con nombre sanitizado.

**3. Descarga a ruta = handler separado reutilizando `pedirBytes` + validación de dominio.**
Se implementa un helper `descargarA(dominioPermitido, url, ruta)` en la capa de descargas que reutiliza `http.ts`, valida `dominioPermitido`, deriva un nombre seguro (tipo-numero-anio.ext o el del archivo origen), evita sobrescribir con sufijo, y reporta ruta absoluta + tamaño.

**4. Unidad de Víctimas = leer todas las pestañas vía la taxonomía `categoria_biblioteca`.**
El listado actual agrupa todo en una página; las pestañas son la taxonomía `categoria_biblioteca` (Informes, Planeación, Presupuesto…). El adaptador recorre las categorías (o consulta el endpoint/filtro por categoría si existe), filtra por `categoria` cuando se pide y agrega los resultados. Se mantiene el canario: si desaparecen los `e-loop-item` o la taxonomía, `CanarioError`.

**5. Buscadores por palabras: mínima intervención por fuente, máxima declaración.**
- **Gestor:** se añade modo de combinación (todos los términos / frase exacta) o se declara explícitamente el OR; `buscar_por_tema` sigue siendo la vía recomendada para contenido temático.
- **SUIN:** cuando el índice empaquetado devuelve 0, fallback a `suin.buscar()` (API Azure viva) que sí encuentra la Ley 1221 de 2008 para "teletrabajo"; si el fallback no rinde, se declara el hueco y se sugiere `buscar_por_tema`/`resolver_cita`. Cero datos nuevos ni reindexado: una línea de fallback.
- **Corte Suprema / Consejo de Estado:** se añade filtro de stopwords compartido (`src/nucleo/stopwords.ts`, ~100 palabras en español) y semántica AND/orden; el número de páginas deja de presentarse como pertinencia cuando el motor une con OR.

**6. Expedientes: persistencia opcional en disco + activación explícita documentada.**
Se mantiene `EXPEDIENTES=1` para activar, y se añade `EXPEDIENTES_DIR` (p.ej. `~/.normativa/expedientes/`) para persistir en JSON; sin `EXPEDIENTES_DIR`, sigue en memoria pero sin TTL fijo de 6 h (el TTL se hace configurable o se elimina). No se activa por defecto sin configuración para no cambiar el comportamiento de las instalaciones existentes.

**7. Pruebas disruptivas de salida cruda por tool.**
Un `scripts/barrido-disruptivo.ts` recorre `tools/list`, llama a cada tool con adversariales (números como texto, vacíos, límites fuera de rango, ids cruzados, `entero`, `ruta_destino`, `categoria`) y verifica sobre `content[0].text` crudo: sin `isError` donde debe ser texto, sin `undefined`/`NaN`/`[object Object]`, sin nombres viejos de tools, fecha + descargo siempre. Se ejecuta como `npm run test:disruptivo` (con `--test-force-exit` en Windows) y como red `test/red-v3-disruptivo.ts` contra el servidor real, reutilizando el `Cliente` de `test/red.ts`.

**8. Citas navegables en los textos.**
`obtener_documento` corre el parser de citas existente (`parsearCita` de `nucleo/citas.ts`) sobre el texto devuelto y añade una lista "Este documento menciona: …" con la forma canónica y el recordatorio de `resolver_cita`. Sin menciones, no se añade nada. Coste casi nulo: el parser ya existe y es local.

**9. Lote de citas (`resolver_citas`).**
`resolver_cita` acepta una lista (`citas: string[]`) o se expone `resolver_citas`; cada cita se resuelve con el flujo actual (parsear → Gestor → veredicto) y las peticiones al Gestor se espacian a 1/s (ritmo de `http.ts`). Una cita sin forma no tumba el lote: se marca con el aviso de forma.

**10. Diccionario de abreviaturas jurídicas en `nucleo/alternativas.ts`.**
Se amplía el tesauro con un mapa curado SMLMV → "salario mínimo legal mensual vigente", DUR → "decreto único reglamentario", CPC/CCA/CPACA/CGP, etc., con clave sin tildes y resolución determinista. `conAlternativas`/`buscar_unificado` la usan igual que los sinónimos; la expansión se declara en la respuesta ("buscando también SMLMV = salario mínimo…").

**11. Circuit breaker y cache de búsquedas.**
En `http.ts`/`cache.ts`: un `Map` por dominio cuenta fallos consecutivos; tras N (p.ej. 3) la fuente se marca "degradada" T minutos y las llamadas devuelven el estado sin pegar a la red, declarándolo ("fuente degradada, reintentando en X"). Cache de búsquedas con TTL corto (5–10 min) para gestor/corte/dian, análogo al cache SUIN de 30 min; aditivo y sin romper el contrato.

**12. Ritmo de 1 llamada/s por fuente garantizado.**
`http.ts` ya serializa por dominio a 1/s; se garantiza que TAMBIÉN aplica cuando una consulta dispara varias peticiones (pestañas de Unidad de Víctimas, lote de citas, federado). Si una pieza nueva (pestañas, lote) encadena peticiones, todas pasan por la misma cola por host.

## Risks / Trade-offs

- **`.doc` binario sin decodificador** → se avisa "sin texto extraíble" con el enlace, sin afirmar que el documento no diga nada; se documenta la deuda.
- **Pestañas de UARIV cambian** → canario sobre la taxonomía `categoria_biblioteca` y los `e-loop-item`; si cambian, se avisa en vez de devolver vacío.
- **Descarga a disco** → validación estricta de dominio (nunca escribir fuera del dominio permitido) y sanitización de nombres (sin `..` ni separadores); ruta inexistente devuelve error claro.
- **Documentos completos** → el troceo por defecto se mantiene para no romper clientes; `entero`/`limite_caracteres=0` es explícito y puede devolver respuestas muy grandes (el transporte ya limita).
- **Buscadores más estrictos** → los resultados cambian (menos ruido); es un cambio BREAKING en salida, mitigado con declaración explícita de la semántica en la respuesta.
- **Expedientes persistentes** → el directorio puede crecer; se documenta y se deja la limpieza al usuario o a una TTL configurable.

## Migration Plan

1. `src/fuentes/sectorial/word.ts` (`.docx` vía ZIP manual + `node:zlib`, `.doc` aviso) + tests con fixtures `.docx` y `.doc`.
2. `src/herramientas/obtener_documento.ts`: `fuente="sectorial"` + `entero` (archivo a disco + trozo de texto) + `ruta_destino`; helper `descargarA()` + citas navegables.
3. `src/fuentes/sectorial/unidadvictimas.ts`: leer todas las pestañas + filtro `categoria` + tests con fixture de taxonomía.
4. Buscadores: `gestor.ts` (modo términos), `suin.ts` (fallback a API viva), `cortesuprema.ts`/`consejoestado.ts` (stopwords + AND), `alternativas.ts` (abreviaturas) + tests.
5. `src/nucleo/expediente.ts` + `src/herramientas/expedientes.ts`: persistencia opcional en disco, TTL configurable, sin TTL fijo, `accion="exportar"`; tests de reinicio.
6. `src/herramientas/resolver_cita.ts`: lote de citas (`citas: string[]`) + tests.
7. `src/nucleo/http.ts`/`cache.ts`: ritmo 1/s garantizado para cadenas de peticiones, circuit breaker y cache de búsquedas con TTL corto + tests.
8. `src/index.ts`: INSTRUCCIONES y descripciones actualizadas (mapeo viejo→nuevo, semántica de búsqueda, descarga, citas, lote, abreviaturas).
9. `scripts/barrido-disruptivo.ts` + `test/red-v3-disruptivo.ts` + `npm run test:disruptivo`.
10. `npm run check` + `npm run test:red` + `npm run build && npm run medir` (reportar delta del bundle).

Rollback: cada pieza es independiente y se revierte con su commit; `entero`/`ruta_destino`/`categoria`/`citas`/`exportar` son aditivos (sin ellos el comportamiento no cambia). Los buscadores y el ritmo 1/s son las únicas piezas con cambio de salida/comportamiento: se revierten como una pieza más.
