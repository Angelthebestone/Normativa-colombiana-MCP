## Purpose

Reúne promesas pequeñas del contrato de las herramientas que hoy no se cumplen: el límite pedido, la pertinencia tras sustituir un término, los recuentos que se muestran, los resultados repetidos, el error de una fuente caída y la verdad de las descripciones publicadas.

## Requirements

### Requirement: `limite` se respeta en el diario oficial
El sistema SHALL mostrar como máximo `limite` diarios, aunque el portal los sirva de diez en diez, y SHALL declarar cuántos faltan y cómo pedirlos.

#### Scenario: Límite menor que la página del portal
- **WHEN** el usuario pide los diarios de septiembre de 2026 con `limite=5`
- **THEN** el sistema muestra 5 diarios, los más recientes, y dice cuántos faltan

#### Scenario: Límite mayor que la página del portal
- **WHEN** el usuario pide `limite=25`
- **THEN** el sistema muestra 25 diarios, como hasta ahora

### Requirement: La sustitución de términos en SUIN conserva la pertinencia
Cuando la búsqueda literal en SUIN no rinde resultados y se usa una variante, el sistema SHALL conservar solo los documentos cuyo título o epígrafe contienen todos los términos significativos de la variante usada; si no queda ninguno, SHALL responder que no rindió, conservar el aviso de que el índice de SUIN tiene huecos y remitir a la búsqueda temática.

#### Scenario: Variante que arrastra documentos ajenos
- **WHEN** el usuario busca «teletrabajo» en SUIN y el sistema sustituye por «trabajo remoto»
- **THEN** el sistema no devuelve leyes o decretos que solo dicen «trabajo» y responde el vacío con orientación a la búsqueda temática

#### Scenario: Variante que sí casa
- **WHEN** la variante usada aparece completa en el título o el epígrafe de un documento
- **THEN** el sistema lo conserva y anuncia la variante

### Requirement: El bloque de temas asociados cuenta lo que muestra
El encabezado «Temas asociados (N de M)» de `obtener_documento` SHALL indicar cuántos temas se muestran de verdad, no el máximo posible: con un tope de caracteres corto, en que solo caben algunos, N SHALL ser ese número.

#### Scenario: Tope corto
- **WHEN** el usuario lee la Ley 1221 de 2008 con `limite_caracteres=1000` y la norma tiene 7 temas asociados
- **THEN** el encabezado dice «3 de 7» y se listan 3

#### Scenario: Tope holgado
- **WHEN** el usuario lee la misma norma con el tope por defecto
- **THEN** el encabezado dice «7 de 7» y se listan 7

### Requirement: Un mismo acto sale una sola vez en la búsqueda unificada
Con perfil de salud, la búsqueda unificada SHALL listar una sola vez el acto que INVIMA y Supersalud publican en el mismo normograma (mismo archivo), atribuido a la primera fuente y con la mención de que la otra también lo lista, y SHALL NOT gastar el límite de resultados en copias.

#### Scenario: Acto compartido por dos normogramas
- **WHEN** el usuario busca «medicamentos» con perfil de salud y la Circular 2 de 2000 figura en INVIMA y en Supersalud
- **THEN** el resultado la lista una vez, con la mención de que Supersalud también la publica, y el límite se completa con actos distintos

#### Scenario: Actos distintos de cada entidad
- **WHEN** INVIMA y Supersalud devuelven actos diferentes
- **THEN** el sistema conserva ambos

### Requirement: Una fuente degradada declara de qué falló y no promete un reintento que no hace
El error de una fuente marcada como degradada SHALL nombrar la causa del último fallo (por ejemplo el código HTTP o el error de red), SHALL decir que el sistema no reintenta por su cuenta y que las llamadas a esa fuente se cortan durante un plazo, y SHALL distinguir el fallo recién ocurrido de la pausa en curso: en esta última SHALL decir cuánto queda y que no se llamó a la fuente. SHALL NOT redactarse como si el sistema fuera a reintentar («reintentando en 60 s»).

#### Scenario: Fallo recién ocurrido
- **WHEN** una consulta a Superfinanciera falla tres veces seguidas y arma la pausa
- **THEN** el error nombra la causa del último fallo y dice que se vuelve a llamar a la fuente pasados 60 s, sin decir «reintentando»

#### Scenario: Pausa en curso
- **WHEN** el usuario repite la consulta dentro de la pausa
- **THEN** el error dice cuánto queda, que no se llamó a la fuente y cuál fue la causa del fallo que armó la pausa

#### Scenario: La fuente se recupera
- **WHEN** pasada la pausa la fuente responde
- **THEN** el sistema devuelve el resultado y no conserva el estado degradado

### Requirement: Las descripciones publicadas no afirman lo que ya no es cierto
La descripción de `listar_catalogos` SHALL NOT fijar recuentos de tipos, entidades o temas que el portal cambia. Las advertencias de INVIMA y Supersalud SHALL NOT decir «sin texto extraíble» de las páginas HTML de su normograma, cuyo texto se lee con `obtener_documento` y `fuente="sectorial"`.

#### Scenario: Descripción del catálogo
- **WHEN** el cliente lee la descripción de `listar_catalogos`
- **THEN** no contiene un recuento de tipos de documento

#### Scenario: Advertencia de INVIMA o Supersalud
- **WHEN** una respuesta de INVIMA o Supersalud trae su advertencia
- **THEN** dice que las páginas HTML se leen con `obtener_documento` y no las declara ilegibles
