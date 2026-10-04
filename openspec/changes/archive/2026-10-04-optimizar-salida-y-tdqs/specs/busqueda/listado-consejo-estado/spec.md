## Purpose

Fija la forma del listado de `buscar_jurisprudencia_consejo_estado` para que el token de lectura, la cabecera de un radicado y los avisos fijos no se repitan dentro de una misma respuesta.

## ADDED Requirements

### Requirement: Token una vez por documento
Cada documento listado SHALL llevar su token de lectura en UNA sola línea (`token: <valor>`). La respuesta SHALL explicar una sola vez, en el pie, cómo leer un documento con ese token: la llamada `obtener_documento` con `fuente="consejo"` y el enlace del navegador construido con el token. La ficha del proceso (`Ficha del proceso:`) SHALL conservarse por radicado.

#### Scenario: Página de 10 documentos
- **WHEN** la búsqueda devuelve 10 documentos con token
- **THEN** cada token aparece exactamente una vez en la respuesta y la explicación de cómo leerlos aparece una vez

#### Scenario: Documento sin token
- **WHEN** SAMAI no entrega token para un documento
- **THEN** ese documento no lleva línea `token:` y el resto del listado no cambia

### Requirement: Radicado repetido en la misma página
Cuando dos o más documentos de la MISMA página comparten radicado, el sistema SHALL emitir una sola cabecera para ese radicado (clase, fecha del proceso, sala, ponente, partes, ficha). Bajo esa cabecera SHALL listar cada documento con su token y sus problemas jurídicos, sin perder ninguno. El conteo de la página SHALL distinguir documentos de radicados cuando no coincidan.

#### Scenario: Sentencia y salvamento del mismo proceso
- **WHEN** la página trae dos documentos del radicado `50001233300020150008801` con tokens distintos
- **THEN** la cabecera del radicado aparece una vez, debajo están los dos tokens con sus tesis, y la línea de conteo dice cuántos documentos y cuántos radicados hay

### Requirement: Pie sin repeticiones
El pie SHALL mantener: el aviso de que la fecha es la del proceso, la caducidad del token, que se cita por radicado en el buscador de relatoría, y la indicación de página siguiente cuando la hay. El sistema SHALL NOT repetir en el pie la lista de radicados ya mostrados. El aviso de repetidas entre páginas SHALL emitirse solo cuando la página contiene alguna ya vista en una página anterior de la misma búsqueda.

#### Scenario: Página sin repetidas
- **WHEN** ningún radicado de la página salió en una página anterior de la misma búsqueda
- **THEN** la respuesta no contiene «UNA PROVIDENCIA PUEDE REPETIRSE» ni la lista de radicados en el pie

#### Scenario: Página con repetidas
- **WHEN** un radicado de la página 2 ya salió en la página 1 de la misma búsqueda
- **THEN** la entrada se marca como repetida y el pie dice cuántas son nuevas
