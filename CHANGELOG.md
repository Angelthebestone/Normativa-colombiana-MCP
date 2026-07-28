# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Este proyecto sigue [versionado semántico](https://semver.org/lang/es/).

## [No publicado]

### Añadido

- Documentos de comunidad: código de conducta, guía de contribución, política de seguridad, plantillas de issue y de pull request.
- Guarda `SIN_RED=1` para correr solo las pruebas de lógica pura, sin consultar los portales.

## [1.0.0] — 2026-07-28

Primera versión.

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
