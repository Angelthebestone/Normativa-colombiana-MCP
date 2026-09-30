## Purpose

Obliga a cada perfil sectorial a revisar lo que dice revisar y a declarar solo las fuentes que consulta, para que un vacío del perfil no se lea como «no hay normativa» cuando solo se miró una parte.

## Requirements

### Requirement: El perfil ambiental revisa todas las secciones de Eureka y dice cuánto revisó
El perfil ambiental SHALL revisar la primera página de cada una de las secciones de Eureka (leyes, licencia ambiental, biodiversidad, cambio climático, consulta previa, impacto ambiental y participación ciudadana), mostrar cada entrada una sola vez aunque figure en dos secciones, y SHALL declarar en su advertencia que Eureka no tiene buscador propio, que solo se revisó la primera página de cada sección y que un vacío no prueba que no haya normativa.

#### Scenario: Término que vive en otra sección
- **WHEN** el usuario consulta el perfil ambiental con «licencia»
- **THEN** el sistema devuelve entradas de la sección de licencia ambiental, en vez de «no encontré resultados»

#### Scenario: Término de la primera página de leyes
- **WHEN** el usuario consulta el perfil ambiental con «Procuraduría»
- **THEN** el sistema sigue devolviendo las entradas de la Procuraduría que hoy devuelve

#### Scenario: Vacío honesto
- **WHEN** ninguna entrada revisada coincide con el término
- **THEN** la respuesta declara qué se revisó (primera página de cada sección) y remite a la lista por sección con `desde` para seguir

#### Scenario: Entrada repetida
- **WHEN** la misma norma figura en dos secciones
- **THEN** el perfil la lista una sola vez

### Requirement: El perfil de contratación estatal identifica cada providencia
El perfil de contratación estatal SHALL mostrar de cada providencia su radicado, la clase de proceso, la fecha con su rótulo verdadero (la del proceso, no la de la providencia), la sala y las partes cuando el portal las publica, además del enlace a la ficha, de modo que el resultado se pueda leer sin abrir cada enlace. SHALL NOT limitarse a listar radicados desnudos.

#### Scenario: Resultado identificable
- **WHEN** el usuario consulta el perfil de contratación estatal con «licitación»
- **THEN** cada resultado trae el radicado, la sala y la fecha del proceso rotulada como tal, y el enlace a la ficha

#### Scenario: El portal no publica las partes
- **WHEN** una providencia no trae actor o demandado
- **THEN** el resultado omite esa línea en vez de imprimir un hueco

### Requirement: El perfil de energía declara el año que revisa
El perfil de energía SHALL declarar en su advertencia que solo revisa las resoluciones de la CREG del año en curso, porque la fuente así lo hace cuando no se le indica año, y SHALL remitir a `buscar_resoluciones_creg` con `anio` para otros años. Un resultado corto SHALL NOT leerse como «esto es todo lo que hay».

#### Scenario: Perfil de energía sin año
- **WHEN** el usuario consulta el perfil de energía con «solar»
- **THEN** la respuesta dice que solo se revisó el año en curso y cómo consultar otro año

### Requirement: Un perfil declara solo las fuentes que consulta
Cada perfil SHALL rotular su sector con las fuentes que de verdad consulta y SHALL NOT nombrar otras: el perfil de contratación estatal consulta el Consejo de Estado, y el de energía consulta la CREG.

#### Scenario: Perfil de energía
- **WHEN** el usuario consulta el perfil de energía
- **THEN** el sector mostrado nombra la CREG y no nombra la UPME ni la ANH

#### Scenario: Perfil de contratación estatal
- **WHEN** el usuario consulta el perfil de contratación estatal
- **THEN** el sector mostrado nombra el Consejo de Estado y no nombra el Gestor
