# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Este proyecto sigue [versionado semántico](https://semver.org/lang/es/).

## [1.11.2] — 2026-08-11

**Optimización de latencia y de mantenimiento: la ficha de SUIN deja de colgar `resolver_cita` cuando el portal está caído, y el banco de medición mide una fila por herramienta.** Cambio no destructivo: ningún contrato de herramienta cambia.

### Mejorado

- **`resolver_cita` (y el resto de herramientas que consultan la ficha de SUIN)**: el timeout de la ficha complementaria baja de 40 s a 8 s. Un SUIN sano la sirve en menos de 2 s; cuando el portal está caído, el ETIMEDOUT del sistema tardaba ~21 s en fallar y colgaba la herramienta entera. Medido (N=5, misma máquina): p50 de `resolver_cita` 22,2 s → 9,4 s (−58 %). No cambia el contrato ni la forma de la respuesta: cuando SUIN no responde, el texto sigue declarándolo. El ritmo de 1/s por dominio, los reintentos y la cadena TLS no se tocan.
- **Duplicación eliminada**: las 3 copias locales del set de palabras vacías pasan a `src/nucleo/stopwords.ts`; los 15 helpers locales `limpio` (colapsar espacios) pasan a `colapsarEspacios` en `src/nucleo/parse.ts`; INVIMA y Supersalud comparten el factory `adaptadorNormograma` en `src/fuentes/sectorial/normograma.ts`. Sin cambios de comportamiento.

### Añadido

- **Banco de medición por herramienta** (`scripts/medir.ts`): una fila por herramienta con p50, p95, nº de peticiones HTTP y bytes de cuerpo, N=5, consulta representativa por tool (la misma del e2e). Se sube a `npm run medir`. `src/nucleo/http.ts` expone `redResumen()` y un log de diagnóstico `MEDIR_RED=1` (apagado por defecto); el stderr del servidor añade `peticiones`/`bytes` a la línea de cada herramienta.

### Verificado

- `npm run check` verde: typecheck, lint (0 errores), 135/136 tests y 42/43 e2e (1 skip por SUIN-Juriscol caído, deuda externa conocida).
- `npm run medir`: bundle `server/index.js` 2319 KB, `npm audit` 0 vulnerabilidades.

## [1.11.1] — 2026-08-10

**Soporte DOC/DOCX, todas las pestañas de la Unidad de Víctimas, descargas a ruta local, buscadores por palabras más precisos, documentos completos, expedientes persistentes y lote de citas.** Cambio no destructivo: ningún contrato de herramienta (nombres, parámetros, tipos, defaults ni respuestas) cambia.

### Añadido

- **Lector de Word vendoreado** (`src/fuentes/sectorial/word.ts`): extrae el texto de `.docx` vía ZIP manual + `node:zlib` (cero dependencias); el `.doc` binario (OLE2) avisa "sin texto extraíble" en vez de inventar texto.
- **Descargas a ruta local** (`src/nucleo/descargas.ts`): `descargarA` valida el dominio contra el adaptador, deriva un nombre de archivo seguro (sin `..` ni separadores), no sobrescribe (sufijo `_1`) y devuelve `{ rutaAbsoluta, bytes }`.
- **`obtener_documento` con `fuente="sectorial"`**: lee el acto de cualquier regulador sectorial por `entidad` + `url` (PDF, Word o HTML), con la advertencia de la fuente siempre presente.
- **`entero=true` y `ruta_destino`**: en vez de trocear, se escribe el documento completo a disco (ruta dada o temporal) y se devuelve la ruta con un trozo de lectura; en `dian`/`sectorial` descarga el archivo original. Nunca se envía el documento entero por stdio.
- **Citas navegables**: el texto devuelto por `obtener_documento` detecta menciones a otras normas (`parsearCita`) y añade "Este documento menciona: …" con recordatorio de `resolver_cita`; sin menciones no añade nada.
- **Lote de citas**: `resolver_cita` acepta `citas: ["Ley 909 de 2004", "C-337/11"]` y resuelve cada una con su enlace en una sola llamada; una cita inválida no tumba el lote.
- **Stopwords compartidas** (`src/nucleo/stopwords.ts`): ~100 palabras vacías del español, usadas por los buscadores y el federado.
- **Abreviaturas jurídicas** (`src/nucleo/alternativas.ts`): SMLMV, DUR, CPC, CCA, CPACA, CGP… se expanden con clave sin tildes y la expansión se declara en la salida.
- **Infraestructura de ritmo/cache** (`src/nucleo/http.ts`, `src/nucleo/cache.ts`): ritmo garantizado de 1 llamada/s por dominio, circuit breaker por fuente (tras N fallos se degrada T min y las llamadas lo declaran sin pegar a la red) y cache de búsquedas con TTL corto.
- **Barrido disruptivo** (`scripts/barrido-disruptivo.ts` + `test/red-v3-disruptivo.ts` + `npm run test:disruptivo`): recorre `tools/list`, llama a cada tool con adversariales (números como texto, vacíos, límites fuera de rango, ids cruzados, `entero`, `ruta_destino`, `categoria`) y verifica el texto crudo (`content[0].text`): sin `undefined`/`NaN`/`[object Object]`, sin nombres viejos, con fecha y descargo.

### Mejorado

- **Unidad de Víctimas** lee TODAS las categorías de la biblioteca (taxonomía `categoria_biblioteca`, no solo la pestaña visible) y acepta el filtro `categoria`.
- **Gestor Normativo y Consejo de Estado**: los buscadores por palabras usan AND local (exigen TODOS los términos) en vez de unir con OR; el número de páginas ya no se presenta como pertinencia.
- **Corte Suprema**: descarta stopwords para términos poco distintivos.
- **SUIN**: cuando el índice empaquetado devuelve 0, se consulta el buscador vivo (API Azure) que sí encuentra la Ley 1221 de 2008 para "teletrabajo"; si el fallback no rinde, se declara el hueco sin concluir que la norma no existe.
- **Expedientes**: persistencia opcional en disco (`EXPEDIENTES_DIR`, JSON por expediente, carga al arrancar), TTL configurable (sin la fija de 6 h) y `expediente(accion="exportar", ruta)` que vuelca el expediente a markdown/JSON.

### Verificado

- `npm run check` verde: typecheck, lint (0 errores), tests del change 73/73 y smoke 54 pass + 1 skip por SUIN-Juriscol caído (deuda externa conocida).
- `npm run test:red` verde: 43/43 con red real.
- `npm run test:disruptivo` verde: barrido 24/24 herramientas sin problemas.
- `npm run medir`: bundle `server/index.js` 2319 KB (objetivo `+6–12 KB` del spec, delta +24 KB sobre 2295 KB), `npm audit` 0 vulnerabilidades.

## [1.11.0] — 2026-08-10

**La superficie de herramientas se reduce de 34 a 24, se lee texto de PDFs sectoriales, se federan las búsquedas y se añaden la ANT y la Unidad para las Víctimas.** Cambio BREAKING en nombres de herramientas: los 6 `obtener_*` pasan a una sola `obtener_documento(fuente)`, los 3 `expediente_*` a `expediente(accion)`, `validar_cita` a `resolver_cita(validar)`, y `listar_subtemas`/`buscar_conceptos_fp`/`listar_normas_fp` a catálogos de `listar_catalogos`. Las descripciones y `INSTRUCCIONES` incluyen el mapeo viejo→nuevo.

### Añadido

- **`obtener_documento`**: una sola herramienta para las seis fuentes con texto (`gestor|corte|suprema|consejo|dian|creg`), con el esquema común definido una vez y los extras por fuente (`id`/`articulo`/`historial`, `ruta`/`seccion`, `sala`, `token`, `link`). Elimina ~200 líneas de handlers repetidos.
- **`expediente(accion: crear|agregar|leer)`** en lugar de las tres tools de expediente (feature desactivado por defecto).
- **`resolver_cita(validar: true)`** devuelve el veredicto ✓/✗ que antes daba `validar_cita`.
- **`listar_catalogos`** ampliado: `catalogo="subtemas"` (con `tema_id`), `catalogo="conceptos_fp"` (número/año) y `catalogo="normas_fp"`.
- **`buscar_unificado`** (V2): búsqueda federada con perfiles (laboral, tributario…), filtro de fuentes y huecos reportados por fuente; una fuente caída no tumba el resto.
- **Vigencia de decretos por ficha directa** en `resolver_cita`/`analizar_conflicto`: cuando el índice de SUIN no cubre un decreto, se consulta la ficha `viewDocument.asp` y se distingue índice ausente / ficha caída / no consta, con cache de 30 min.
- **PDF-texto sectorial** (`src/fuentes/sectorial/pdf.ts`): extrae texto de PDFs no escaneados (reutilizando `unpdf`, ya en `devDependencies`), validando el dominio contra el adaptador.
- **Supersalud** como regulador sectorial: consulta el backend `Buscar.ashx` real de su normograma (Avance Jurídico, mismo patrón que Invima/DIAN), con shape `tipo/entidad/nombre/link/year/numero/epigrafe`.
- **ANT** (`src/fuentes/sectorial/ant.ts`): normativa de la Agencia Nacional de Tierras (Drupal, `/normativa` con filtro `title` y paginación `?page=N`); tipo/número/fecha/objeto/PDF por acto.
- **Unidad para las Víctimas** (`src/fuentes/sectorial/unidadvictimas.ts`): biblioteca de documentos (WordPress + Elementor, `/documentos_bibliotec/` con paginación `/page/N/`); categoría como tipo, título como epígrafe y enlace a la página del documento.
- **Contrato léxico** en `comparar_articulos`: se exportan `normalizarLexico`/`bigramas` y se verifica que los cambios solo de tildes/puntuación se clasifican como `EDITORIAL` (umbral 0,92), sin que la sinonimia real se cuele.
- **Red de pruebas de regresión** (`test/red.ts` + `test/red-gestor.ts`, `red-tribunales.ts`, `red-v2.ts`): 43 casos por dominio leyendo `content[0].text` crudo e `isError`, con adversariales (argumentos numéricos, límites fuera de rango, ids cruzados, vacíos como texto), ejecutables como subprocesos (`npm run test:red`).

### Corregido

- **Nombres viejos de herramientas en las salidas**: `buscar_normativa_tributaria` decía "link para obtener_documento_dian", `buscar_jurisprudencia_suprema`/`consejo_estado` decían "obtener_providencia_*", `buscar_jurisprudencia` decía "obtener_sentencia", y varios avisos decían "obtener_norma". Ahora todas las salidas usan `obtener_documento con fuente="…"` (barrido de salidas crudas `content[0].text`).
- **Ruta del índice temático en el bundle**: al mover `src/indice.ts` a `src/nucleo/`, `../../datos/` apuntaba fuera del paquete en `server/index.js`; `cargarIndice()` ahora prueba `../../datos/` (fuente) y `../datos/` (bundle).
- `listar_catalogos` con `conceptos_fp` sin filtro se rechaza (antes devolvía los 21.759 conceptos).
- Mensajes de `explicar_relacion_tema`/`buscar_por_tema` actualizados a los nombres nuevos de las herramientas.

### Reorganizado

- `src/nucleo/` — módulos compartidos (http, parse, ca, citas, evidencia, compiladas, alternativas, entidades, jerarquia, perfiles, indice, expediente, actualizacion).
- `src/fuentes/jurisprudencia/` — corte, cortesuprema, consejoestado.
- `src/herramientas/diff.ts` — movido junto a sus handlers.
- Verificado con graphify: 48/48 archivos con nodo, 0 imports colgantes, 0 rutas viejas, sin ciclos.

### Verificado

- `npm run check` verde: typecheck, lint (0 errores), 123/123 tests unitarios (1 skip por SUIN caído) y 42/42 e2e.
- `npm run test:red` verde: 43/43 con red real.
- `npm run medir`: bundle `server/index.js` 2295 KB, sin `dependencies` nuevas (`npm audit` 0 vulnerabilidades), `manifest.json` auto-sync 34 → 24 herramientas.
- OpenSpec `validate` del change `proxima-ampliacion-valor`: `valid: true`.

## [1.10.2] — 2026-08-08

**Perfil de Glama al 88 %: se añade `glama.json` y se reescriben las descripciones de las herramientas peor puntuadas.** Cambio no destructivo: ningún contrato de herramienta (nombres, parámetros, tipos, defaults ni respuestas) cambia.

### Añadido

- **`glama.json`** en la raíz, siguiendo el [schema oficial de Glama](https://glama.ai/mcp/schemas/server.json) (`$schema` + `maintainers`). Se empaqueta en el `.mcpb` y viaja en el paquete npm.
- **Sección "Cómo llegar al 100 % del checklist"** en `CALIDAD_HERRAMIENTAS_GLAMA.md`: documenta el sembrado de uso con "Try in Browser" como único paso manual pendiente ("No recent usage"), sin depender de que los portales del Estado estén en línea.

### Mejorado (descripciones de herramientas, sin romper contrato)

Reescritas siguiendo el diagnóstico de `CALIDAD_HERRAMIENTAS_GLAMA.md` (la nota de Glama es 60 % media + 40 % mínimo, así que las peores arrastran el conjunto):

- `expediente_agregar` (2.6 → objetivo >4): ahora declara que el expediente DEBE existir (creado con `expediente_crear`), que es de solo escritura, el almacenamiento temporal (6 h) y la activación con `EXPEDIENTES=1`; los 3 parámetros llevan `describe()`.
- `expediente_leer` (3.2): se elimina la cláusula confusa heredada de `expediente_crear` y se aclara el origen del `id`.
- `buscar_normativa_anh`, `buscar_resoluciones_creg`, `buscar_jurisprudencia`, `consultar_perfil` y `consultar_por_jerarquia`: propósito con verbo + recurso, cuándo-usar/cuándo-no-usar con alternativas nombradas, y comportamiento (qué devuelve).
- Parámetros sin `describe()` cubiertos: `limite` en `consultar_perfil`, `consultar_jerarquia`, `buscar_conceptos_fp`, CREG y jurisprudencia; `max_pasajes` en los 4 `obtener_*` que lo tenían sin descripción.

### Verificado

- `npm run typecheck` y `npm run lint`: limpios.
- `npm test` (smoke) 112 pass / 0 fail y `npm run test:e2e` 42 pass / 0 fail (1 skip por SUIN caído, no por código).
- `git diff` confirma que ningún `inputSchema` cambió nombres, tipos, required/optional ni defaults: solo texto de `description`/`describe()`.

## [1.10.1] — 2026-08-06

**La relatoría dejó de mentir sobre las búsquedas de varias palabras, y `comparar_articulos` distingue cambios editoriales.** Doce búsquedas en `buscar_jurisprudencia` fallaban con el mismo error («la API devolvió algo que no es JSON»); ninguna otra herramienta fallaba.

### Corregido

- **`buscar_jurisprudencia` fallaba con frases de varias palabras.** El backend de la relatoría (`buscador_new/`) antepone un **aviso HTML** («No fue posible ejecutar búsquedas flexibles») a la respuesta JSON cuando una consulta con varias palabras no halla coincidencias —y devuelve 0 hits—. Ese HTML rompía el `JSON.parse` y se reportaba como «la API devolvió algo que no es JSON… pudo haber cambiado». No era un cambio de API: era el canario de «0 resultados» que el propio servidor pone.
  - El JSON ahora se **extrae del cuerpo** aunque el aviso vaya delante (busca `{`/`[` y su cierre), y el aviso se detecta sin depender de tildes (esbuild escapa la «ú» en el bundle y el texto real la trae literal, así que comparar la forma acentuada fallaba según dónde se ejecutara).
  - Si el aviso está, la consulta **reintenta con una sola palabra** del término —la más distintiva, medida por frecuencia en la relatoría— y devuelve resultados reales en vez de vacío o error. «mora querella policiva» se busca como «querella» (987 providencias), no como «mora» (6.554, casi todas ajenas). La palabra usada se **anuncia en la respuesta**: «La relatoría no indexa la frase completa; se buscó con el núcleo «X»».
  - La pertinencia (el marcador «⚠ no menciona el término») se mide contra el núcleo realmente usado, no contra la frase completa que nadie buscó como tal.
  - El error «no es JSON» ya no se tira para este caso: el vacío legítimo (0 real) se informa como texto, no como fallo de herramienta.

### Añadido

- **`comparar_articulos` detecta cambios editoriales.** Dos diferencias que eran el mismo cambio reescrito (ortografía, puntuación, orden de palabras) se agrupan como «EDITORIAL — «X» → «Y» (sim. N, cambio menor)» usando **similitud léxica de Dice sobre bigramas (≥0,92)**, sin modelo semántico: «multa» → «sanción pecuniaria» no se detecta y queda en «no clasificado» para revisión manual. El cierre lo dice con todas las letras.

## [1.10.0] — 2026-08-06

**Nueve herramientas V2, un prompt nuevo y una capa común de metadatos, evidencia y normalización.** Se implementan las ideas de `IDEAS_V2_ADICIONALES.md` con subagentes en paralelo, y un agente de QA probó ~130 llamadas reales contra los portales antes de publicar.

### Añadido

- **Herramientas V2** (34 en total, antes 25):
  - `consultar_por_jerarquia` — filtra por nivel de autoridad (constitución, ley, decreto, resolución, concepto, jurisprudencia) y explica el carácter de cada nivel.
  - `validar_cita` — comprueba cita y enlace (número/año, dominio, id, artículo) y clasifica en "validada / parcialmente validada / no fue posible validar".
  - `analizar_conflicto` — reúne EVIDENCIA de un posible conflicto entre dos normas (metadatos, vigencia si consta, jerarquía, reformas, pasajes); no concluye.
  - `cambios_desde` — resume los cambios que el Gestor anota sobre las normas listadas, filtrados por fecha; no rastrea novedades.
  - `comparar_articulos` — compara dos artículos, marca añadido/eliminado y clasifica por patrones (plazo, sanción, excepción, sujeto); lo no clasificado se revisa a mano.
  - `consultar_perfil` — ejecuta una consulta con las fuentes y filtros preconfigurados de un perfil (laboral, tributario, ambiental, contratación estatal, energía).
  - `expediente_crear` / `expediente_agregar` / `expediente_leer` — expediente temporal en memoria (6 h, desactivado por defecto con `EXPEDIENTES=1`).
- **Prompt `aclarar-consulta`**: hace las preguntas precisas (año, jurisdicción, sector, qué se busca, alcance) antes de consultar una norma ambigua.
- **Módulos puros**: `indice` (índice temático extraído de `index.ts`), `alternativas` (tesauro + escalera sin tildes/sinónimo), `entidades` (alias institucionales), `jerarquia`, `compiladas`, `evidencia`, `diff`, `expediente`, `perfiles`.
- **SDK de fuentes sectoriales**: el contrato `Adaptador` ahora declara `dominioPermitido`, `tiposDocumento`, `soportaTexto`, `soportaVigencia` y `pruebasMinimas`; `registrar()` valida en arranque.
- **`scripts/probar-tools.ts`**: inspector de salidas que dispara cada herramienta contra los portales reales y vuelca el texto, para validar a ojo (con filtro por nombre y `SIN_RED=1`).

### Comportamiento en herramientas existentes

- `buscar_normas`: normalización de entidades ("Mintrabajo" → "Ministerio del Trabajo"; "dian" no es filtro del Gestor y se orienta a `buscar_normativa_tributaria`); la vía temática se anuncia siempre.
- `buscar_jurisprudencia` y `buscar_en_suin`: alternativas de búsqueda (sin tildes, sinónimo del tesauro) SIEMPRE anunciadas.
- `obtener_norma` y `resolver_cita`: aviso de normas compiladoras (Decreto Único Reglamentario o > 300.000 caracteres) con índice de artículos.
- `resolver_cita`: validación del dominio del enlace (falla blanda).

### Corregido (del QA)

- **Falso canario en la DIAN**: un vacío legítimo (`No se encontraron resultados.`, que el backend manda sin comillas, no-JSON) disparaba "el portal cambió su estructura". Ahora es un vacío explicado.
- **Ambigüedad sin año**: `cambios_desde`, `validar_cita`, `analizar_conflicto` y `comparar_articulos` elegían en silencio el primer resultado ("Decreto 1072" son 4). Nuevo `candidatosAmbiguos`: piden el año listando los candidatos.
- `validar_cita`: validaba el enlace del item aunque el usuario pasara uno ajeno; ahora valida el enlace del usuario (dominio + id) y una URL malformada no da error de esquema.
- `analizar_conflicto`: toda reforma salía como "MODIFICADO"; ahora usa la acción real (DEROGADO, ADICIONADO, DECLARADO…) con año, y avisa que las sentencias se resuelven con `resolver_cita`.
- `consultar_perfil`: el vacío salía en silencio (línea en blanco); ahora explica y orienta.
- `obtener_norma`: "desde" pasado del final devolvía un trozo vacío sin explicación, y "limite_caracteres" informaba lo mostrado con el valor no ajustado.
- `comparar_articulos`: mezclaba las notas entre paréntesis (reformas, "Ver sentencia") como contenido; nueva `limpiarArticulo` compara solo el texto sustantivo.
- `consultar_por_jerarquia`: "constitución" daba un vacío que ocultaba que el Gestor no cataloga ese tipo; ahora avisa y orienta.

## [1.9.0] — 2026-08-04

**Las tres altas cortes entregan ya texto completo.** Eran dos; la Corte Suprema y el Consejo de Estado estaban declarados como «sin texto» y en ambos casos era falso.

### Añadido

- **`obtener_providencia_consejo_estado`**: texto completo de una providencia del Consejo de Estado. Medido: la sentencia 25000232600020090088801 de la Sección Tercera son 36 páginas y 102.296 caracteres, en unos 3 segundos de extremo a extremo.

  **La verificación anti-robot no cubría lo que parecía.** Está en la ficha del proceso —que es a donde enlazábamos— y por eso se dio el texto por inalcanzable. La providencia tiene otra ruta, **y la publica el propio buscador en sus resultados**: un enlace firmado `VerProvidencia.aspx?tokenDocumento=<JWT>` que no pide nada, y que a su vez genera una URL SAS de Azure con el PDF. Los tres saltos son el camino que el portal ofrece a cualquiera que use su buscador.

  El token **caduca en una hora**, así que no es citable: para citar sigue valiendo el radicado, y la respuesta lo dice en mayúsculas. Se regenera repitiendo la búsqueda.

  El token se lee de `documentlink_<n>`, con el mismo índice que el radicado, por la regla que ya regía este módulo: emparejar por proximidad atribuiría el documento de una providencia a otra.

- **`obtener_providencia_suprema`**: texto completo de una providencia de la Corte Suprema, por su ruta y su sala. Medido en las cuatro: ATP284-2021 (Tutelas) 7.781 caracteres, una casación Civil 50.758, la 29456 (Laboral) 33.771, AP5252-2021 (Penal) 31.733. Se trocea igual que el resto —`buscar_en_texto`, `desde`, `limite_caracteres`—, porque una casación no cabe en una respuesta.

  **Exige la MISMA sala con la que se encontró.** Comprobado: la SL3772-2018 devuelve 46.910 caracteres desde `Laboral` y `null` desde Penal, Civil y Tutelas. El backend no devuelve otro documento, devuelve nada.

### Lo que resultó ser falso

- **«Las providencias son .docx y esta extensión no las lee» era falso dos veces**, y estaba escrito en cuatro sitios: el docstring del módulo, la descripción de la herramienta, `describir_fuentes` y el README.

  Primero, **no son .docx**: de 22 providencias muestreadas en las cuatro salas, **18 son `.doc` binario**, 3 `.docx` y 1 `.pdf`. Una librería de OOXML habría fallado en el grueso del corpus, y en silencio.

  Segundo, **no hace falta ninguna librería**: su propio backend GraphQL ya sirve el texto extraído. La introspección está abierta y expone `getContentSearch(previewDocument:{id, room, text})`. Lo que devuelve no es el documento sino los pasajes que contienen `text`: sin él llegan 547 caracteres de rótulos, con «despido» 49.956 y con un punto —que casa con todo— la providencia entera.

### Corregido

### Dependencias

- **Primera dependencia de peso del proyecto: `unpdf`**, para leer el PDF del Consejo de Estado. El bundle pasa de 669 kB a 2,2 MB, y se carga en diferido para que solo lo pague quien pida un texto.

  Se probó antes **`@llamaindex/liteparse`**, que era **el doble de rápido** —417 ms contra 884 en la misma sentencia de 36 páginas, con el mismo contenido: 15.969 palabras frente a 15.970— y aun así se descartó: trae **un binario nativo por plataforma** (17,9 MB en Windows, 24,5 en Linux). El `.mcpb` viaja sin `node_modules`, así que la herramienta respondía `Failed to load native module for win32-x64`. Comprobado ejecutando el servidor compilado en un directorio limpio, que es como se instala de verdad; con `unpdf`, la misma prueba responde el texto. Este proyecto ya había descartado antes una dependencia nativa, y por la misma razón.

  Nota al margen: el OCR de `liteparse` viene activado por defecto y sobre un PDF con capa de texto costaba **125.011 ms** en vez de 417. Juzgar una librería por su configuración por defecto habría dado la respuesta contraria.

### Corregido

- **El quitador de preámbulo de Word se comía la cabecera de los fallos.** Descarta las líneas cortas iniciales para limpiar la basura que Word dejó en los documentos viejos, y la cabecera de la Corte son siete líneas de menos de 40 caracteres: «CORTE SUPREMA DE JUSTICIA», «Radicación n.° 46498», el ponente, «SL3772-2018». Se perdían enteras, **con el radicado dentro, que es la clave con la que se cita**. El propio `ponytail:` de `parse.ts` había anticipado este caso y señalado la salida; se aplicó por ahí, ampliando `INICIO_REAL` con CORTE, SALA y RADICACIÓN. El preámbulo de Word nunca empieza por esas palabras: son «Clean», «false», «mso-…» o cifras sueltas.

## [1.8.2] — 2026-08-04

Un recorrido completo por las 23 herramientas en Claude Desktop encontró **una fuente «caída»** que no lo estaba.

### Corregido

- **Seis de las siete secciones de ANLA estaban rotas, y la extensión culpaba al portal.** Eureka usa DOS plantillas de Joomla: «leyes» es un blog (`div.article`, 10 por página) y las seis secciones temáticas son páginas de etiqueta (`ul.com-tags-tag__category`, 20 por página). El parser solo entendía la primera, así que las otras seis —que respondían **200 con sus documentos dentro**— salían como «su plantilla de Joomla cambió». Rotas eran justo las que dan la **curaduría temática**, que es lo único que esta fuente aporta: lo que sí funcionaba era la sección de leyes, la que el propio módulo documenta como la menos útil porque `resolver_cita` la resuelve mejor. Medido tras el arreglo: licencia-ambiental, biodiversidad, cambio climático, consulta previa, impacto ambiental y participación ciudadana devuelven 20 entradas cada una.
- **El «hay más» de ANLA repetía documentos.** Se deducía de contar entradas (`>= 10`) y de sumar 10 fijos, con dos plantillas que paginan distinto: la última página de cambio climático trae 12 documentos y decía «repite con desde=70», que devolvía otra vez lo ya visto. Ahora el salto se lee de los enlaces `?start=N` del propio portal, y la última página se declara última (comprobado: 72 documentos en cuatro páginas, sin repetir ninguno).

### Cambiado

- **Cuando la ficha de SUIN no responde, se dice qué servidor se cayó.** SUIN vive en dos: la ficha de vigencia en `www.suin-juriscol.gov.co` y el buscador en un índice de Azure. Al ver «SUIN no respondió» junto a un `buscar_en_suin` que funcionaba, la conclusión natural era la contraria a la verdadera —que fallaba el índice empaquetado y respondía lo consultado en vivo—, cuando son dos servidores independientes y el que se cae es el de la ficha.

## [1.8.1] — 2026-08-04

Tanda de correcciones sobre respuestas que **parecían buenas**. Ninguna fallaba: contestaban con aplomo algo distinto de lo preguntado.

### Corregido

- **Los ids temáticos ahora llevan prefijo: `ts-`, `sub-` y `tema-`.** El portal mantiene tres taxonomías que numeran cada una por su cuenta, así que el mismo entero existe en las tres: el 38968 es «Teletrabajo durante jornada día sin carro» en `listar_subtemas` e «INHABILIDADES E INCOMPATIBILIDADES / Ex Diputados» en el de `buscar_por_tema`. Advertirlo en las descripciones no bastaba —un id cruzado no daba error, respondía por el subtema equivocado—. Con el prefijo pegado al id, cruzarlos es un error explícito que además dice de qué catálogo salió.
- **La celda «Norma» del MinTrabajo perdía los decretos y se inventaba años.** Su número va pelado, sin rótulo delante, y exigirlo devolvía «Decreto  de 2026» sin número con el que citar ni filtrar. Y «Ley 1929» salía como «Ley 1929 de 1929» cuando su fila fechaba 2018: ahora solo cuenta como año el que va tras «de».
- **`resolver_cita` callaba la vigencia en los decretos.** Las leyes siempre traían la línea, aunque fuera para decir que SUIN no respondió, y los decretos la perdían sin más — que se lee como «no aplica» en vez de «no se puede saber». El índice de SUIN son casi solo leyes; ahora lo dice.
- **El Consejo de Estado repetía providencias entre páginas sin avisar.** SAMAI pagina por problema jurídico y no por caso, así que un radicado con varias tesis reaparece en la página siguiente y quien suma páginas cuenta dos veces el mismo precedente. Se recuerdan los radicados de la búsqueda en curso y los repetidos van marcados.
- **El canario de ANLA daba por caído el portal entero.** La caída es por sección: en la misma sesión «leyes» respondió y «licencia-ambiental» no.

### Añadido

- **ANLA marca la cita que su propio resumen desmiente.** Eureka titula «Ley 2585 de 2026» un artículo cuyo texto dice «la Ley 2577 de 2026»; la 2585 no existe. No se corrige el número —cuál es el bueno lo dice la fuente, no esta extensión—: se entregan los dos.
- **`describir_fuentes` acepta `fuente`.** Preguntar por el alcance de la CREG no debería costar el texto de las otras veinte.
- **Las fichas del Gestor salen rotuladas como lo que son.** El Decreto 1072 de 2015 declara «Fecha de Entrada en Vigencia: 10 de marzo de 2022»: es su dato, y cuando el año no cuadra con el del título se avisa en vez de servirlo como si lo afirmáramos nosotros.
- **La ANM y el MinTrabajo declaran hasta dónde llega su dato.** El «[Vigencia según el portal]» de la ANM es texto que ella escribió, no una comprobación; y la fila «Ley 2021 de 2021» del MinTrabajo enlaza el PDF de la Ley 2101 de 2021.

## [1.8.0] — 2026-08-03

Diez reguladores sectoriales más, en **una sola herramienta**.

### Añadido

- **`buscar_normativa_sectorial`**, con diez entidades que el Gestor Normativo no cataloga: MinAgricultura, ICA y ANM (primario y extractivo); Supersociedades, SIC, INVIMA y Superfinanciera (industria, comercio, consumo y sector financiero); MinTrabajo, Supertransporte y Parques Nacionales (transversales).

  **Una herramienta y no diez.** CREG, ANH, UPME y ANLA conservan la suya porque cada una devuelve algo distinto —la CREG entrega articulado, ANLA una clasificación temática—, pero estas diez publican todas lo mismo: un acto con tipo, número, fecha, epígrafe y enlace. Eso no rompe la regla de «una herramienta por fuente»: lo que esa regla evita son los parámetros condicionales, los que solo aplican según el valor de otro, y aquí `entidad` solo elige a quién se pregunta.

  El contrato obliga a cada adaptador a declarar **qué NO cubre**, y esa advertencia viaja en toda respuesta, haya resultados o no. Una prueba lo verifica: una fuente nueva que se registre sin ella no pasa.

### Lo que NO se construyó, y por qué

- **Nada para «la ley del sector».** Se comprobó que **los 20 Decretos Únicos Reglamentarios están todos en el Gestor** —1071 agropecuario, 1074 comercio e industria, 1076 ambiente, 1079 transporte, 1072 trabajo, 780 salud…—, resolubles con `resolver_cita` y con texto completo. Construir fuentes para eso habría duplicado peor lo que ya funciona, así que la descripción de la herramienta desvía explícitamente ese caso.

- **El filtro por entidad del Gestor no sirve para recorrer un sector**, y quedó medido: 16 normas para el Ministerio de Agricultura, 7 para el de Comercio, 1 para «Sector Transporte». El grueso está bajo «Nivel Nacional». Ese es exactamente el hueco que llenan los diez adaptadores.

### Hallazgos de la exploración

- **`normograma.info` sí es un proveedor compartido.** Estaba anotado lo contrario tras probar 20 instancias: solo respondía `prueba-dian`. Es falso — el buscador del INVIMA vive en `normograma.info/prueba-invima/buscador/Buscar.ashx`, y da **5.765 documentos**. Se encontró leyendo el JS de su aplicación Angular.
- **La SIC no era inalcanzable, era una cadena TLS rota.** Su certificado no envía el intermedio de GlobalSign. Se añadió el intermedio siguiendo el patrón que ya existía para funcionpublica.gov.co, **sin desactivar la verificación** en ningún momento.
- **El ruido administrativo es un patrón, no una anécdota.** Igual que en la ANH, en la SIC 41 de 50 filas recientes son nombramientos de personal. Cada adaptador lo aparta y lo dice.
- **Dos portales mienten con la fecha**, como ya hacía la UPME: la ANM publica la de subida al portal, no la del acto, y la Supersociedades llegó a servir «Expedición 27 Dic 0031» en una resolución de 2026.

## [1.7.0] — 2026-08-02

Tercer lote de fallos encontrados usándolo. Dos de ellos eran del tipo caro: la respuesta parecía correcta.

### Añadido

- **Cuatro reguladores sectoriales: CREG, ANH, UPME y ANLA.** Es la primera vez que este MCP sale de «ley nacional y altas cortes», y por eso el alcance se declara con más cuidado que nunca, no con menos.

  - **CREG** (`buscar_resoluciones_creg`, `obtener_resolucion_creg`) — resulta ser la mejor de las cuatro. Su «Gestor Normativo Alejandría 2.0» no es el software de Función Pública, pero publica el articulado en **HTML**, así que es la única fuente sectorial cuyo texto se puede leer aquí. Y hace algo rarísimo en Colombia: **mantiene compilaciones separadas de resoluciones no derogadas y derogadas**. Esa señal se traslada literal, con el rótulo de la propia compilación, sin convertirla en un sí o un no. Las compilaciones se publican **por año**: sin el parámetro `anio` solo se ve el año en curso —20 resoluciones frente a las 118 de 2025—, y la respuesta lo dice.
  - **ANH** (`buscar_normativa_anh`) — 785 documentos exactos, contados paginando hasta el final (39 × 20 + 5). Un formulario GET sin estado de sesión: la fuente más sencilla de todo el proyecto. **Dos de cada tres son actos de personal** —15 de 20 en la primera página—, así que se ocultan por defecto y se dice cuántos se ocultaron.
  - **UPME** (`buscar_normativa_upme`) — su portal es WordPress y dejó `wp-json` abierto, con un tipo propio `circular_resolucion`. Aviso que va en la propia descripción porque induce a error: **la fecha que publica es la de publicación en la web, no la de la norma** — la «Resolución 1163 de 2024» figura publicada en 2025. El número y el año reales se leen del título.
  - **ANLA** (`listar_normativa_ambiental_anla`) — su sistema «Eureka» aporta una **curaduría temática**, no documentos nuevos: casi todo lo que lista son leyes y decretos que `resolver_cita` ya resuelve mejor, con texto y vigencia. La herramienta lo dice y remite. Un detalle que habría producido citas falsas: Eureka escribe «Decreto – Ley 2893 de 2011» con guion largo, y el extractor ingenuo sacaba de ahí «Ley 2893 de 2011», que es **otra norma**.

  ANH y UPME solo publican PDF, así que entregan epígrafe y enlace, como ya hacían la Corte Suprema y el Consejo de Estado.

- **`describir_fuentes` declara los límites de esta ampliación.** Añadir cuatro reguladores crea justo el riesgo que este proyecto combate: que «tener algo sectorial» se lea como «tener lo sectorial». Por eso la herramienta ahora dice, con todas las letras, que **no** están la SIC, la Superfinanciera, la CRC ni la Superservicios.

- **`describir_fuentes`.** Declara el alcance real sin consultar la red: qué responde cada una de las seis fuentes, con qué fecha se generaron los índices empaquetados —números leídos de los propios ficheros, no prosa escrita a mano— y, sobre todo, **qué NO está cubierto**: el estado procesal de un caso, la vigencia de los decretos (el índice de SUIN son casi solo leyes, porque los sitemaps de decretos devuelven 404), la normativa departamental y municipal, y los tribunales distintos de las tres altas cortes.

  Existe para una sola situación, que es la más peligrosa de todas: que una búsqueda vacía se lea como «esa norma no existe». Si el índice deja de viajar con la instalación, la herramienta lo dice en vez de callarlo — una capacidad ausente no es un resultado negativo.

  La idea está tomada del `list_sources` de `@ansvar/colombian-law-mcp`, que fue lo mejor que encontré al revisarlo. Su implementación no era aprovechable —declara `jurisdiction: "EE"` (Estonia) y `languages: ["en"]` en un servidor colombiano cuyo corpus está en español—, pero el concepto de publicar la procedencia y la cobertura como dato consultable sí lo era.

- **Los índices empaquetados dejan de poder degradarse en silencio.** Son la diferencia entre que esto funcione y que encuentre la mitad sin avisar, y no había una sola prueba que los mirara: un `generar-indice` truncado habría dejado todo en verde. Ahora se afirman sus tamaños (12.063 pares tema/subtema, 56.458 asociaciones, 11.599 leyes de SUIN, con umbrales al 90 %) y que traen una fecha de generación legible, sin la cual no se puede advertir de que están viejos. La idea —afirmar el tamaño del corpus como contrato— viene de los `golden tests` de `@ansvar/colombian-law-mcp`.

- **`resolver_cita` distingue tres silencios que antes se veían iguales.** Que el índice de SUIN no esté instalado, que SUIN no responda y que la norma no conste en el índice producían todos la misma respuesta: ninguna línea de vigencia. Los dos primeros son estados del sistema, no datos sobre la norma, y ahora se dicen —«capacidad ausente» y «la fuente no respondió»—. El tercero se sigue callando, porque la regla general ya cubre el «no consta». Portado del `detectCapabilities` del mismo servidor, que apaga funciones según lo que traiga su base y lo publica en vez de fingir.

- **La Corte Suprema amplía la búsqueda en vez de darla por vacía.** Con la frase exacta por defecto, una consulta de varias palabras sin coincidencia literal devolvía «no encontré», que no es lo mismo que «no existe esa frase». Ahora, si la frase exacta no da nada, se reintenta uniendo las palabras con OR y **la respuesta se abre diciendo que es una búsqueda ampliada** y que hay que verificar la pertinencia de cada resultado. La escalera —lo más específico primero, ampliar solo si hace falta, y decir siempre cuál de las dos respondió— viene del `buildFtsQueryVariants` del mismo servidor.

### Corregido

- **`historial` daba por intacto lo que el propio texto mostraba reformado.** Pedir el historial de la Ley 1221 de 2008 respondía «las notas del Gestor no registran cambios», mientras que el artículo 6 traía tres notas a la vista. La causa: el parser solo reconocía una de las **tres formas** en que el portal anota un cambio. Ahora lee las tres, con las notas reales como prueba:

  - pasiva: `(Modificado por el art. 1 Decreto 666 de 2017)`
  - activa entre paréntesis: `(Adiciona Art 54 numerales 13, 14,15 de la Ley 2466 de 2025)`
  - control constitucional: `Declarada inhibida por ineptitud sustantiva de la demanda (Numeral 1. ) Sentencia de la Corte Constitucional C-351 de 2013`

  Las dos formas nuevas **exigen que la nota identifique la norma o la sentencia**, y la activa exige además ir entre paréntesis. Sin esas dos condiciones entraba la prosa del articulado —«las normas que la modifiquen o adicionen»— y, peor, el artículo de vigencias, que dice qué deroga **esta** norma: se habría registrado al revés, como si la hubieran reformado a ella.

- **El mismo punto ciego en las advertencias de vigencia.** El artículo 6 de la Ley 1221 —inhibida en un numeral, exequible de forma condicionada en otro y adicionado por la Ley 2466 de 2025— se mostraba **sin una sola advertencia**. Ahora avisa de las notas en activa y de las de control constitucional, que es donde vive la parte de un artículo que no rige como está escrita.

- **`resolver_cita` sin año elegía por ti, sin decirlo.** «Decreto 1072» son cuatro decretos —2025, 2015, 2004 y 1999— y devolvía el de 2025, sobre tarifas de energía, cuando el que casi cualquiera cita es el de 2015, el Único Reglamentario del Sector Trabajo. Acertaba la forma y fallaba el fondo, sin nada en la respuesta que invitara a sospechar. Ahora, cuando el mismo tipo y número existen en años distintos, **devuelve los candidatos y pide el año** en vez de escoger. Las citas que no son ambiguas —«Decreto 1083», «Ley 909»— siguen resolviéndose directas.

- **`buscar_normas` fallaba en silencio al filtrar por entidad.** `Ley` + `1993` + `Congreso de la República` devolvía cero pese a existir la Ley 80 y la Ley 100 de ese año, porque el Gestor no cataloga por emisor: la misma consulta con `Nivel Nacional` devuelve 39. El mensaje mandaba a dudar de la norma cuando el equivocado era el filtro, así que ahora **nombra esa entidad** cuando el vacío viene de filtrar por otra.

### Cambiado

- **`buscar_jurisprudencia_consejo_estado` pagina.** Antes solo existía la primera página: con 15.406 páginas de resultados y un tope de 5, la sexta providencia era inalcanzable. La salida estaba en el propio botón «Copiar Link Permanente de Búsqueda»: un **GET con la consulta y el número de página**, sin `__VIEWSTATE`, sin cookie y sin POST. Se comprobó radicado por radicado, en tres consultas distintas, que devuelve exactamente lo mismo que el postback, así que **sustituye a toda la maquinaria de WebForms** en vez de convivir con ella.

  Se pide por `pagina` y no por el `desde` del resto de herramientas porque SAMAI pagina en bloques de ~10 que no siempre traen 10 filas legibles: un desplazamiento exacto sería un número inventado.

  De paso, cada providencia trae ahora **el enlace a su ficha de proceso**, en vez de remitir al buscador para que se busque a mano.

- **`exacto` viene activado en `buscar_jurisprudencia_suprema`.** El modo por defecto unía las palabras con OR y devolvía 33.607 resultados en la sala Penal y 3.318 en la Civil: para más de una palabra era inservible, y la propia herramienta lo advertía en cada respuesta. Ponerlo en `false` sigue disponible para ampliar a propósito una búsqueda que quedó corta.

- **`buscar_conceptos_fp` exige `numero` o `anio`.** Sin filtro devolvía los 21.759 conceptos, y el listado no dice de qué trata ninguno. `buscar_normas` y `buscar_jurisprudencia` ya rechazaban la llamada vacía.

- **Las providencias que no traen texto dan el número para pegarlo.** Corte Suprema y Consejo de Estado no publican el texto en un formato legible aquí; ahora la respuesta termina con el radicado o el número de cada providencia, listo para el buscador oficial, en vez de un enlace genérico.

- **`listar_catalogos` dice de quién son sus catálogos.** Buscar «DIAN» entre las entidades devolvía vacío y se leía como que no hay normativa de la DIAN. Son catálogos **solo del Gestor Normativo de Función Pública**: la DIAN tiene su propio normograma, y SUIN y las tres cortes quedan fuera.

- **Un 500 del Consejo de Estado se reportaba como «el portal cambió su estructura».** Al reemplazar la maquinaria de WebForms por el enlace permanente se perdió la comprobación del código de estado, y SAMAI responde `500 The wait operation timed out` cuando su base de datos agota el tiempo con consultas amplias. El canario culpaba al marcado y mandaba a actualizar la extensión, que no arregla nada. Ahora se distingue: la fuente se cayó, y así se dice.

- **Una prueba acusaba al índice cuando el caído era el portal.** El e2e de SUIN fallaba con «falta `datos/indice-suin.json`: genera el índice» durante una caída de SUIN, con el índice intacto y sus 11.599 leyes dentro: mandaba a regenerar media hora de datos para nada. Ahora distingue las dos causas preguntándole a `describir_fuentes` si el índice viaja, y solo culpa al índice cuando de verdad falta.

### Sin cambios, a propósito

- **«Telebrajo durante jornada día sin carro».** La errata es del portal de Función Pública y así está indexada. Corregirla en silencio rompería la correspondencia con la fuente, así que se sigue devolviendo tal cual; quien cite ese subtema debe citarlo como está.

## [1.6.0] — 2026-08-01

### Añadido

- **Consejo de Estado** (`buscar_jurisprudencia_consejo_estado`), con lo que se completan **las tres altas cortes**. Contencioso administrativo: nulidad y restablecimiento, contratación estatal, nulidad electoral, reparación directa y conceptos de la Sala de Consulta. Cada resultado trae radicado, fecha, sala, ponente, las partes y —lo que de verdad orienta— **el problema jurídico que la Sala se planteó y su respuesta**.

  Es la única fuente sin API: su buscador es ASP.NET WebForms. Tres cosas costaron averiguarse y quedan escritas en el módulo porque ninguna es evidente:

  - **La búsqueda no es un botón.** Es un LinkButton que dispara `__doPostBack('ctl00$MainContent$BusquedaRapidaLinkButton')`. Sin ese `__EVENTTARGET` el portal responde 200 con la misma página sin haber buscado nada, y eso se parece tantísimo a «no hay resultados» que estuvo a punto de quedar documentado como un límite del portal cuando era un error de lectura.
  - **No hay asistente de tres pasos.** Las pestañas son `slideUp/slideDown` en el navegador: todos los campos viven en el mismo formulario y basta una petición.
  - **El `__VIEWSTATE` se reutiliza** entre búsquedas, así que el formulario se pide una vez por proceso.

  El canario cuenta providencias y nunca mira el código HTTP —aquí un 200 no significa nada— y distingue dos fallos: que el postback no llegara a ser una búsqueda, y el traicionero, que el buscador sí buscara pero el marcado cambiara y no se pudiera leer ninguna fila.

### Nota sobre un error evitado

El primer parser emparejaba el radicado con la tesis **por cercanía en el HTML**. Con diez bloques de texto y solo siete radicados separados por decenas de miles de caracteres, eso habría atribuido la tesis de una providencia a otra: una cita falsa, con toda la apariencia de ser correcta. Se corrigió leyendo cada campo por su id indexado antes de que llegara a publicarse.

## [1.5.0] — 2026-08-01

### Añadido

- **Aviso de versión nueva, diseñado para no molestar.** Se publican versiones cada pocos días y quien instaló el `.mcpb` no se entera, pero un recordatorio en cada respuesta compite con el texto de la norma por la atención de quien lee. Por eso: una consulta al registro **por proceso** y solo después de la primera petición —nunca en el arranque—, **un aviso por sesión** y nunca más, silencio definitivo si el registro no contesta en tres segundos, y **solo versiones mayores o menores**: un parche no interrumpe a nadie. El texto distingue las dos formas de instalación, porque quien usa el `.mcpb` no se actualiza solo.

### Explorado y no implementado

- **SAMAI (Consejo de Estado).** Mapeado entero: su buscador de jurisprudencia es **WebForms puro**, sin ScriptManager ni servicios web; el manejador genérico `.ashx?Servicio=` solo alimenta widgets de la interfaz, y la relatoría anterior es JSF. El postback real devuelve **200, 447.531 caracteres y cero radicados**: la búsqueda es un asistente de tres pasos que arrastra 53 KB de estado opaco por petición.

  Lo decisivo no es el peso sino que **un postback rechazado responde 200 con la misma página**, indistinguible de «no hay resultados» — justo el vacío silencioso que este proyecto tiene prohibido. Implementarlo exige tres postbacks encadenados y un canario que cuente radicados en vez de mirar el código HTTP.

## [1.4.0] — 2026-08-01

### Añadido

- **`obtener_sentencia` con `seccion`.** Devuelve solo los antecedentes, las consideraciones o la decisión. La T-099/24 pasa de 140.162 caracteres a 39.906, y la C-337/11 de 134.223 a 8.312 empezando por el RESUELVE. Antes había que adivinar qué `buscar_en_texto` pedir para llegar al fallo.

  Dos trampas que costaron una corrección cada una: el encabezado debe ocupar su propio renglón y estar en mayúsculas, porque «Decisión frente a la cual presentó recurso…» —prosa a mitad de la sentencia— pasaba por encabezado y devolvía el trozo equivocado, que parece la respuesta; y una sección no se corta con su propio encabezado, porque tras «III. DECISIÓN» viene «RESUELVE» y cortar ahí dejaba la fórmula de cortesía sin la parte resolutiva.

- **`obtener_norma` con `historial`.** Reconstruye qué normas modificaron, adicionaron o derogaron una norma o un artículo, a partir de las notas que el propio portal incrusta en el texto. El Decreto 1083 trae 99 cambios distintos, 96 con la norma identificada.

  Se devuelve **siempre la nota literal** junto a los campos sueltos, y lo que la nota no dice queda vacío en vez de completarse. Tampoco se ordenan por fecha ni se deduce cuál rige hoy: eso exigiría interpretar, y aquí interpretar mal es afirmar algo falso sobre derecho vigente.

## [1.3.3] — 2026-08-01

### Corregido

- **El aviso de baja pertinencia de `buscar_jurisprudencia` culpaba siempre al filtro de fechas**, incluso cuando no se había enviado ninguno: mandaba a quitar un `desde/hasta` que quien consultaba nunca puso. Ahora la causa que sugiere corresponde a lo que se pidió, y si la búsqueda se restringió a autos propone no restringirla, porque suelen ser de trámite.

### Verificado, no era un fallo

- **El filtro `entidad` de `buscar_normas` sí se aplica.** Con `palabras="encargo"`: 10 resultados sin filtro, 5 con Función Pública y **0 con Corte Constitucional**. Que coincidieran los resultados con y sin filtro en una prueba concreta era porque esos conceptos ya eran todos de esa entidad.

## [1.3.2] — 2026-08-01

Todo lo de esta versión salió de dos sesiones de uso real en Claude Desktop. Ninguna prueba lo habría encontrado.

### Corregido

- **`buscar_jurisprudencia_suprema` no respetaba el límite.** Más exactamente: el parámetro no existía y el backend pagina de diez en diez, así que `limite=1` y `limite=25` devolvían los mismos 10. Ahora hay un `limite` real.
- **Providencias duplicadas, el fallo más grave.** El índice de la Corte guarda una entrada por ARCHIVO, no por providencia: el mismo auto en `.docx` y `.pdf`, y a veces con el ponente escrito de dos formas («Myriam Avila» y «Myriam Ávila Roldán»). Una página de diez podía traer solo dos documentos distintos repetidos cinco veces cada uno, y al paginar buena parte de lo prometido eran copias. Se deduplica por número de providencia conservando la grafía más completa del ponente, **y la respuesta dice cuántas entradas traía la página frente a cuántas providencias distintas quedaron**, porque si no «quedan N» sigue prometiendo documentos que no existen.
- **El recuento era engañoso.** El buscador de la Corte Suprema hace texto completo sobre la providencia entera y no descarta palabras comunes: `"de"` solo devuelve 69.454 resultados y «despido sin justa causa» daba 176.012 frente a 20.233 con `exacto=true`. Ese número se presentaba como «coinciden». Ahora se rotula como coincidencia parcial, se remite a `exacto=true` y la descripción de la herramienta explica el mecanismo.
- **«Artículos detectados» inventaba artículos en decretos compilados.** Las referencias cruzadas de las notas entraban como encabezados: en el Decreto 1083 aparecían «21», «5» y «19» entre 2.2.1.3.1, y en el Decreto 1072 un «2.2.2.47.7» fuera de secuencia. Ahora el encabezado debe abrir renglón, la misma regla que ya usaba la extracción de un artículo suelto.
- **El tipo de norma mal escrito no daba ninguna pista.** «Decreto 1567 de 1998» no existe —es «Decreto Ley»— y la respuesta era un «no encontré» sin salida. Ahora se reintenta sin filtrar por tipo y se nombra el tipo oficial.
- **La vigencia se perdía en las citas sin año.** «Decreto 1083» no traía el bloque de SUIN; ahora el año se toma del título que resolvió el Gestor.

### Documentación

- **La vigencia solo cubre leyes.** El índice tiene 11.585 leyes y 11 decretos porque los sitemaps de decretos de SUIN devuelven 404. Que no conste para un decreto no significa ni vigente ni derogado, y así se advierte en las instrucciones y en el README.
- **`buscar_en_suin` tiene huecos de índice.** «Teletrabajo» devuelve cero pese a estar en el título de la Ley 1221 de 2008, y una frase larga empareja por sus palabras comunes y trae normas de 1877 sin relación. La descripción lo advierte y remite a `buscar_por_tema` o `resolver_cita`.

## [1.3.1] — 2026-08-01

### Corregido

- **Las 26 vulnerabilidades que reportaba `npm install`.** No estaban en el código: hasta el 1 de agosto la única versión publicada en npm era la **1.0.0**, que declaraba `zod`, `cheerio` y el SDK de MCP como dependencias de ejecución y arrastraba **208 paquetes**. La 1.0.1 lo corrigió pasándolas a desarrollo —esbuild ya las empaqueta dentro del bundle— pero nunca llegó a publicarse. Con la 1.3.0 en el registro, `npm install normativa-colombia-mcp` instala **1 paquete y ninguna dependencia**.
- `esbuild` sube a 0.28.1: la 0.24.2 arrastraba [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). Solo afectaba a su servidor de desarrollo, que este proyecto no usa, y era dependencia de desarrollo: nunca llegó a nadie que instalara el paquete. `npm audit` queda en cero.

### Documentación

- README al día con las cinco fuentes, las quince herramientas y la vigencia, que dejó de ser un «no se puede saber».
- Se documentan los límites medidos: los ~20 s de la primera búsqueda tributaria, las providencias de la Corte Suprema en `.docx` y los tres avisos sobre el dato de vigencia.
- El manifiesto del `.mcpb` declara las quince herramientas; se había quedado en once.

## [1.3.0] — 2026-08-01

### Añadido

- **Corte Suprema de Justicia** (`buscar_jurisprudencia_suprema`): providencias de las salas de Tutelas, Civil, Laboral y Penal. Cada una trae **las normas que cita**, resolubles con `resolver_cita`. Su backend es GraphQL con la introspección abierta, así que el esquema está verificado, no adivinado.
- **Normograma de la DIAN** (`buscar_normativa_tributaria`, `obtener_documento_dian`): lo tributario, aduanero y cambiario, que ninguna otra fuente cubría.
- `pedirJson` añade POST al cliente HTTP conservando ritmo, cadena TLS y reintentos.

### Corregido

- La búsqueda de la DIAN se cachea por término. Su portal devuelve siempre el resultado completo —3,16 MB— y no admite tope: se probaron `max`, `top`, `limite`, `rows`, `pagina/tam` y `start/count`, y los siete devuelven lo mismo. Cada página con `desde` volvía a bajar los 3 MB; ahora la segunda pasa de 20 s a 0 ms.

### Notas

Cuatro afirmaciones del plan resultaron falsas al reproducir las peticiones: el certificado de `normograma.info` no cubre `www`, la instancia del Senado en ese normograma no existe, el `/api` de la Corte Suprema es GraphQL y no REST, y sus providencias son `.docx` y no PDF escaneados.

## [1.2.0] — 2026-08-01

### Añadido

- **SUIN-Juriscol, y con él la vigencia**, que ninguna fuente publicaba. Índice offline de 11.599 leyes (1844-2026) generado desde sus sitemaps, que es la única vía porque su buscador Solr no resuelve ni por nombre ni por IP.
- `resolver_cita` responde con SUIN cuando el Gestor no tiene la norma. Antes decía «no encontré», que se lee como «no existe».
- `buscar_en_suin`: 56.832 documentos por materia, sector y entidad emisora.
- Paginación real con `desde` en `listar_normas_fp` y `buscar_conceptos_fp`.
- `npm run medir`: banco de métricas repetible.

### Corregido

- **El estado de vigencia se lee del registro del documento, no de su prosa.** La etiqueta visible falta en documentos antiguos —la Ley 74 de 1923 está DEROGADA y no la muestra— y donde aparecen ambas se contradicen: la Ley 1541 de 2012 dice «Vigente» en pantalla y «Vigencia en Estudio» en su campo.
- Un documento sin texto extraíble se informa como tal, con detección de PDF escaneado, en vez de devolver un vacío que se lee como «no dice nada».
- `obtener_sentencia` acepta la cita corta (`C-337/11`), no solo la ruta interna.
- El parser de citas ya no parte los números largos: «Ley 99999999 de 1800» perdía el año y el error pedía un año que sí se había indicado.

### Rendimiento

- Bundle minificado: 1.099 → 583 KB.
- Índice temático sin los títulos que nunca se muestran: 4,92 → 3,10 MB.
- Primera consulta temática: 95,6 → 70,2 ms.

## [1.1.0] — 2026-07-28

### Corregido

- `limite_caracteres` se ignoraba al usar `buscar_en_texto`, tanto en `obtener_norma` como en `obtener_sentencia`: pedir 1.500 caracteres devolvía más de 18.000. Era el defecto más caro, porque reventaba el contexto justo en las normas grandes, que son las que el troceado existe para poder manejar. Ahora el tope manda en los dos modos.
- Un `limite_caracteres` por debajo del mínimo lanzaba un error de validación crudo. Ahora se ajusta al rango en silencio.
- `buscar_normas` rechazaba el subtema por nombre sin decir qué esperaba. Ahora lo acepta si se indica también el tema —los subtemas no son únicos en el portal— y si falta el tema, lo explica.
- El respaldo temático atribuía los resultados a un par tema/subtema que no era el suyo. Ahora dice qué filtro se usó y advierte que las dos taxonomías del portal no coinciden.

### Añadido

- `max_pasajes` en `obtener_norma` y `obtener_sentencia`, para acotar cuántos extractos devuelve `buscar_en_texto`.
- `buscar_jurisprudencia` señala las providencias que no mencionan el término buscado. Al acotar por fechas, el buscador de la relatoría pierde precisión y colaba resultados sin relación.
- `listar_subtemas` advierte en su descripción que el catálogo de búsqueda y el índice temático son dos taxonomías distintas del portal, con ids que no son intercambiables.

## [1.0.1] — no publicada

### Corregido

- El paquete de npm declaraba como dependencias el SDK de MCP, cheerio y zod, y `npm install` bajaba 111 paquetes que nunca se usan: esbuild ya los empaqueta dentro del bundle. Pasan a dependencias de desarrollo y la instalación queda sin dependencias.

### Añadido

- El README documenta las tres formas de instalar desde npm: `npx`, local y global.

## [No publicado]

### Añadido

- Documentos de comunidad: código de conducta, guía de contribución, política de seguridad, plantillas de issue y de pull request.
- Guarda `SIN_RED=1` para correr solo las pruebas de lógica pura, sin consultar los portales.

## [1.0.0] — 2026-07-28

Primera versión. Publicada en [npm](https://www.npmjs.com/package/normativa-colombia-mcp) y como extensión `.mcpb` en [Releases](https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases/tag/v1.0.0).

### Añadido

- Once herramientas sobre dos fuentes oficiales: Gestor Normativo de Función Pública y relatoría de la Corte Constitucional.
- `resolver_cita`, que entiende las formas colombianas de citar («Ley 909 de 2004», «C-337/11», «art. 6 de la Ley 1221 de 2008») y resuelve a la norma exacta.
- Búsqueda dentro del articulado (`buscar_en_texto`), que es la búsqueda de texto completo que los portales no ofrecen.
- Respaldo temático: cuando la búsqueda por palabras rinde poco se reintenta por el subtema oficial. Para «teletrabajo» pasa de 3 documentos a 43 conceptos.
- Índice temático empaquetado (12.054 subtemas) que responde sin red.
- Instrucciones de uso que el servidor entrega al cliente al conectarse.
- Cuatro comandos listos en Claude Desktop.

### Notas de diseño

- Ninguna norma se devuelve entera: el Decreto 1083 son 925.000 caracteres.
- Un parseo roto lanza `CanarioError` en vez de devolver una lista vacía, que se leería como «no existe esa norma».
- Se completa la cadena TLS incompleta de `funcionpublica.gov.co` con el intermedio correcto, sin desactivar la verificación.
- Una petición por segundo sostenida por dominio, ráfaga de cinco, y respeto a `Retry-After`.
- Toda respuesta lleva enlace oficial y fecha de consulta.

### Limitación conocida

Ninguna de las dos fuentes publica la vigencia como dato estructurado. La extensión traslada las marcas de «Derogado» y «Modificado por» del texto, pero no puede confirmar que una norma siga vigente.
