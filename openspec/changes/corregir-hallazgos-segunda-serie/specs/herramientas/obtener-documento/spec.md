## ADDED Requirements

### Requirement: El artículo pedido respeta el tope de caracteres
Cuando se pide un artículo concreto de una norma del Gestor, el sistema SHALL respetar `limite_caracteres` y `desde` igual que en el resto de modos: devolver a lo sumo ese tope, informar total, mostrado y omitido, y dar la llamada exacta del trozo siguiente. Las advertencias de vigencia (notas de modificación, derogatorias, control constitucional) SHALL calcularse sobre el artículo completo y no sobre el trozo mostrado, para que una nota al final del artículo no se pierda al recortarlo.

#### Scenario: Artículo más largo que el tope
- **WHEN** el usuario pide el artículo 6 de la Ley 1221 de 2008 con `limite_caracteres=300`
- **THEN** el sistema devuelve como máximo 300 caracteres del artículo, informa el total y lo omitido, y ofrece la llamada con `desde` para el trozo siguiente

#### Scenario: Artículo que cabe en el tope
- **WHEN** el usuario pide un artículo cuyo texto es menor que `limite_caracteres`
- **THEN** el sistema lo devuelve entero, sin marcar nada como omitido

#### Scenario: Nota en la cola del artículo recortado
- **WHEN** el trozo mostrado no llega a la nota «Modificado por el Art. 6 de la Ley 1960 de 2019» del final del artículo 31 de la Ley 909 de 2004
- **THEN** la respuesta incluye igualmente la advertencia de que el artículo contiene notas de «Modificado por»

### Requirement: El texto de una página HTML no arrastra los iconos del portal
El texto que se devuelve de documentos servidos como página HTML (CREG, INVIMA, Supersalud) SHALL NOT incluir los nombres de los iconos de la interfaz del portal («download», «search», «developer_guide», «keyboard_backspace», «navigate_next»…) como si fueran texto del documento, y SHALL conservar íntegro el texto del propio documento.

#### Scenario: Resolución de la CREG
- **WHEN** el usuario lee la Resolución CREG 101-44 de 2024
- **THEN** el texto devuelto no contiene «developer_guide» ni «search» como palabras sueltas y sigue conteniendo el encabezado «RESOLUCIÓN 101 044 DE 2024»

#### Scenario: Palabra legítima del documento
- **WHEN** el texto de un documento contiene en su articulado la palabra «búsqueda» o «download» dentro de una frase
- **THEN** el sistema la conserva: solo se retiran los iconos de la interfaz, no las palabras del documento
