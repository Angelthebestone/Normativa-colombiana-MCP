# Contrato de implementación con subagentes en paralelo

Cada grupo es un subagente independiente que escribe SOLO los archivos que declara (rutas disjuntas).
Las variables de entorno son la interfaz de configuración; decláralas en el entorno del proceso.
Mantén soluciones mínimas y eficientes: reutiliza `http.ts`/`parse.ts`/`trocear`/`fragmentos`/`conAlternativas`,
no añadas `dependencies` nuevas, y respeta el patrón vendoreado del repo (como `diff.ts`).

- **Variables globales:** `EXPEDIENTES=1` (activa expedientes), `EXPEDIENTES_DIR` (persistencia en disco, p.ej. `~/.normativa/expedientes/`), `SIN_RED=1` (modo offline para tests), `LENTO`/`CONTRATO` (timeouts en la red de regresión).
- **Rutas a escribir por subagente (disjuntas):**
  - Subagente A (Word): `src/fuentes/sectorial/word.ts`, `test/doc-docx.ts`
  - Subagente B (Descargas): `src/nucleo/descargas.ts`, `src/nucleo/stopwords.ts`, `test/descargas.ts`, `test/stopwords.ts`
  - Subagente C (Unidad de Víctimas): `src/fuentes/sectorial/unidadvictimas.ts`, `test/sectorial-sdk.ts`
  - Subagente D (Buscadores): `src/fuentes/gestor.ts`, `src/fuentes/suin.ts`, `src/fuentes/jurisprudencia/cortesuprema.ts`, `src/fuentes/jurisprudencia/consejoestado.ts`, `test/busqueda-por-palabras.ts`
  - Subagente E (Expedientes): `src/nucleo/expediente.ts`, `src/herramientas/expedientes.ts`, `test/expediente.ts`, `test/expedientes-herramientas.ts`
  - Subagente G (Lote de citas + infraestructura): `src/herramientas/validar_cita.ts`, `src/nucleo/http.ts`, `src/nucleo/cache.ts`, `test/lote-citas.ts`, `test/cache-ritmo.ts`
  - Subagente F (Integración): `src/herramientas/obtener_documento.ts`, `src/index.ts`, `scripts/barrido-disruptivo.ts`, `test/red-v3-disruptivo.ts`
  - F no arranca hasta que A/B/D/E/G hayan terminado (los importa); A–E y G corren en paralelo.

## 0. Base compartida

- [x] 0.1 Verificar que `src/nucleo/http.ts` expone `pedirBytes`/`pedir` y `src/nucleo/parse.ts` expone `trocear`/`fragmentos`/`avisoSinTexto`/`textoDe`; anotar firmas para los subagentes
- [x] 0.2 Confirmar `node:zlib` disponible y que `unpdf` (devDependency) se mantiene solo para PDF; sin dependencias nuevas en `package.json`

## 1. Subagente A — Lector Word vendoreado (.docx / .doc)

- [x] 1.1 Crear `src/fuentes/sectorial/word.ts` — extracción `.docx` vía ZIP manual (directorio central + `node:zlib` inflate, sin librerías) leyendo `word/document.xml` → texto plano; `.doc` binario (magic bytes `D0 CF 11 E0`) → aviso `sinTexto`; `extraerTextoWord(dominioPermitido, url, deps?)` inyectable con `pedirBytes`/`descomprimirZip`
- [x] 1.2 Tests `test/doc-docx.ts` — fixtures `.docx` textual (texto extraído), `.doc` binario (aviso "sin texto extraíble"), dominio no permitido (aviso), `limite_caracteres`/`buscar_en_texto` respetados

## 2. Subagente B — Descargas a ruta local

- [x] 2.1 Crear `src/nucleo/descargas.ts` — `descargarA(dominioPermitido, url, ruta)` reutilizando `pedirBytes`; valida dominio, deriva nombre seguro (tipo-numero-anio.ext o nombre origen, sin `..` ni separadores), no sobrescribe (sufijo `_1`), devuelve `{ rutaAbsoluta, bytes }`; ruta inexistente/no escribible → error claro
- [x] 2.2 Crear `src/nucleo/stopwords.ts` — lista compartida de ~100 palabras vacías en español, `esStopword(t)`/`filtrarStopwords(tokens)`; usada por buscadores y federado
- [x] 2.3 Tests `test/descargas.ts` + `test/stopwords.ts` — ruta válida, ruta inexistente (error), dominio fuera (rechazo sin escribir), archivo existente (sufijo), nombre sanitizado; stopwords filtran artículos/preposiciones

## 3. Subagente C — Unidad de Víctimas: todas las pestañas

- [x] 3.1 Ampliar `src/fuentes/sectorial/unidadvictimas.ts` — recorrer la taxonomía `categoria_biblioteca` (todas las categorías/pestañas, no solo la visible), filtro `categoria` opcional (acepta "Informes"/"Planeación"/…), agregar resultados de todas las categorías; mantener canario sobre `e-loop-item`/taxonomía
- [x] 3.2 Tests `test/sectorial-sdk.ts` — listado sin filtro agrega todas las categorías, filtro por `categoria` devuelve solo esa, hueco con `advertencia` completa

## 4. Subagente D — Buscadores por palabras

- [x] 4.1 Gestor (`src/fuentes/gestor.ts`) — modo de combinación de términos (todos / frase exacta) o declaración explícita del OR; `buscar_por_tema` sigue siendo la vía temática
- [x] 4.2 SUIN (`src/fuentes/suin.ts`) — cuando el índice empaquetado devuelve 0, fallback a `suin.buscar()` (API Azure viva) que sí encuentra la Ley 1221 de 2008 para "teletrabajo"; declarar el hueco si el fallback no rinde
- [x] 4.3 Corte Suprema (`src/fuentes/jurisprudencia/cortesuprema.ts`) — descartar stopwords (`filtrarStopwords`) para términos poco distintivos
- [x] 4.4 Consejo de Estado (`src/fuentes/jurisprudencia/consejoestado.ts`) — semántica AND/orden en vez de OR; el número de páginas no se presenta como pertinencia
- [x] 4.5 `src/nucleo/alternativas.ts` — diccionario de abreviaturas jurídicas (SMLMV → "salario mínimo legal mensual vigente", DUR → "decreto único reglamentario", CPC/CCA/CPACA/CGP…), clave sin tildes, resolución determinista; `conAlternativas`/`buscar_unificado` la usan y declaran la expansión
- [x] 4.6 Tests `test/busqueda-por-palabras.ts` — términos con AND/frase, stopwords, hueco SUIN cerrado vía fallback, declaración de OR cuando persista, abreviatura ampliada y abreviatura no conocida (literal)

## 5. Subagente E — Expedientes persistentes y activables

- [x] 5.1 `src/nucleo/expediente.ts` — persistencia opcional en disco (`EXPEDIENTES_DIR`, JSON por expediente, carga al arrancar), TTL configurable o sin TTL fijo de 6 h
- [x] 5.2 `src/herramientas/expedientes.ts` — `EXPEDIENTES=1` documentado, `EXPEDIENTES_DIR` para persistir, avisos de activación/persistencia
- [x] 5.3 Añadir `expediente(accion="exportar", ruta)` — volcar el expediente a markdown/JSON en la ruta indicada, reutilizando `descargarA` (nombre seguro, no sobrescribir, reporte de ruta + tamaño)
- [x] 5.4 Tests `test/expediente.ts`/`test/expedientes-herramientas.ts` — persistencia entre reinicios, sin TTL fijo, activación por configuración, exportar a ruta (archivo creado, ruta inexistente → error, expediente inexistente → aviso)

## 6. Subagente G — Lote de citas + infraestructura de ritmo/cache

- [x] 6.1 `src/herramientas/validar_cita.ts` — `resolver_cita` acepta `citas: string[]` (o expone `resolver_citas`): resuelve cada cita con el flujo actual, una inválida no tumba el lote (aviso de forma), veredicto + enlace por cita
- [x] 6.2 `src/nucleo/http.ts` — garantizar ritmo 1 llamada/s por dominio incluso con cadenas de peticiones (pestañas, lote, federado); circuit breaker: N fallos seguidos → fuente "degradada" T min → llamadas declaran el estado sin pegar a la red
- [x] 6.3 `src/nucleo/cache.ts` — cache de búsquedas con TTL corto (5–10 min) para gestor/corte/dian, análogo al cache SUIN de 30 min; aditivo y sin romper contrato
- [x] 6.4 Tests `test/lote-citas.ts` + `test/cache-ritmo.ts` — lote con válidas+inválida (no falla el lote), ritmo 1/s con varias peticiones (timestamps espaciados), circuit breaker tras N fallos, cache devuelve sin red

## 7. Subagente F — Integración en obtener_documento e index (tras A/B/D/E/G)

- [x] 7.1 `src/herramientas/obtener_documento.ts` — `fuente="sectorial"` (con `entidad`/`url` del acto) reutilizando `word.ts` y `pdf.ts`; `entero: boolean` que, en vez de trocear, escribe el archivo a disco (ruta dada o temporal) y devuelve la ruta + un trozo de texto para leer; `ruta_destino` que usa `descargarA`
- [x] 7.2 Añadir citas navegables — detectar menciones a otras normas en el texto devuelto (`parsearCita`) y devolver "Este documento menciona: …" con recordatorio de `resolver_cita`; sin menciones no añadir nada
- [x] 7.3 `src/index.ts` — INSTRUCCIONES y descripciones: `fuente="sectorial"`, `entero`, `ruta_destino`, `categoria` en Unidad de Víctimas, semántica de búsqueda, expedientes persistentes, lote de citas, abreviaturas
- [x] 7.4 Tests de integración — fuente sectorial con PDF textual y `.docx`, documento completo vía archivo + texto, límites respetados, citas navegables

## 8. Tests disruptivos de salida cruda (barrido + red)

- [x] 8.1 Crear `scripts/barrido-disruptivo.ts` — recorre `tools/list`, llama a cada tool con adversariales (números como texto, vacíos, límites fuera de rango, ids cruzados, `entero`, `ruta_destino`, `categoria`), lee `content[0].text` crudo y verifica: sin `isError` donde debe ser texto, sin `undefined`/`NaN`/`[object Object]`, sin nombres viejos de tools, fecha + descargo siempre
- [x] 8.2 Añadir `test/red-v3-disruptivo.ts` — red de regresión que ejecuta el barrido contra el servidor real y verifica el texto crudo de cada tool
- [x] 8.3 Añadir script npm `test:disruptivo` en `package.json` (`node scripts/barrido-disruptivo.ts` con `--test-force-exit`)

## 9. Verificación final

- [x] 9.1 `npm run check` (typecheck + lint + test) verde
- [x] 9.2 `npm run test:red` + `npm run test:disruptivo` verdes (con red; con `SIN_RED=1` solo los casos offline)
- [x] 9.3 `npm run build && npm run medir` — reportar delta del bundle (`server/index.js`, objetivo `+6–12 KB`) y `npm audit` 0 vulns
