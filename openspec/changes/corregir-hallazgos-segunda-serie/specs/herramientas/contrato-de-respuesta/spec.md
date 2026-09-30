## Purpose

Reúne tres promesas pequeñas del contrato de las herramientas que hoy no se cumplen: el límite pedido, la pertinencia tras sustituir un término y la verdad de las descripciones publicadas.

## ADDED Requirements

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

### Requirement: Las descripciones publicadas no afirman lo que ya no es cierto
La descripción de `listar_catalogos` SHALL NOT fijar recuentos de tipos, entidades o temas que el portal cambia. Las advertencias de INVIMA y Supersalud SHALL NOT decir «sin texto extraíble» de las páginas HTML de su normograma, cuyo texto se lee con `obtener_documento` y `fuente="sectorial"`.

#### Scenario: Descripción del catálogo
- **WHEN** el cliente lee la descripción de `listar_catalogos`
- **THEN** no contiene un recuento de tipos de documento

#### Scenario: Advertencia de INVIMA o Supersalud
- **WHEN** una respuesta de INVIMA o Supersalud trae su advertencia
- **THEN** dice que las páginas HTML se leen con `obtener_documento` y no las declara ilegibles
