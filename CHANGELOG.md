# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Este proyecto sigue [versionado semántico](https://semver.org/lang/es/).

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
