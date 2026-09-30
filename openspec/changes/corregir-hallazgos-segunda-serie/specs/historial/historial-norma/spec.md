## MODIFIED Requirements

### Requirement: Historial de reformas navegable
El sistema SHALL exponer el historial de una norma como una cadena estructurada: para cada cambio, la acción (`modificado`, `adicionado`, `derogado`, `sustituido`, `subrogado`, `compilado`, `corregido`, `reglamentado`, `declarado`), la norma que lo introdujo (con su año), el artículo de la norma que lo introdujo cuando la nota lo dice (en «Modificado por el Art. 6 de la Ley 1960 de 2019» es el artículo 6 de la Ley 1960, no un artículo de la norma consultada), y la nota literal citable. El sistema SHALL ordenar los cambios de forma estable y SHALL conservar la nota literal palabra por palabra (es lo citable). El historial SHALL obtenerse desde el texto del Gestor vía `historial()` existente, sin reimplementar el parser.

#### Scenario: Norma con reformas anotadas
- **WHEN** el usuario pide el historial de una norma del Gestor (p.ej. la Ley 100 de 1993) con reformas anotadas en el texto
- **THEN** el sistema devuelve la lista de cambios con `acción | norma (año) | artículo de la norma que lo introdujo | literal`, en orden estable y con la literal palabra por palabra

#### Scenario: Norma sin reformas anotadas
- **WHEN** el texto de la norma no contiene notas de reforma
- **THEN** el sistema devuelve "sin reformas anotadas en el texto" y recuerda que el Gestor no siempre anota las reformas y que la vigencia se consulta con `resolver_cita`, sin afirmar que la norma nunca fue reformada

#### Scenario: Límite de cambios
- **WHEN** la norma tiene más cambios de los que se muestran
- **THEN** el sistema muestra un tope (p.ej. los primeros 20), declara cuántos se omitieron y cómo pedir más

## ADDED Requirements

### Requirement: El filtro por artículo es el de la propia norma
Cuando se pide el historial de una norma con un número de artículo, el sistema SHALL devolver las notas de reforma que el Gestor incrusta en el texto de ESE artículo de la norma consultada, y SHALL NOT devolver las que solo coinciden porque el artículo de su norma modificadora lleva el mismo número. El resultado SHALL ser el mismo que da la lectura de ese artículo con su historial (misma norma, mismo artículo).

#### Scenario: Artículo reformado por otra ley
- **WHEN** el usuario pide el historial de la Ley 909 de 2004 con artículo 31
- **THEN** el sistema devuelve al menos «MODIFICADO por Ley 1960 de 2019, artículo 6» con su nota literal, en vez de «ninguno sobre el artículo 31»

#### Scenario: Notas de control constitucional y de leyes adicionantes dentro del artículo
- **WHEN** el usuario pide el historial de la Ley 1221 de 2008 con artículo 6, cuyo texto lleva la nota de la Sentencia C-337 de 2011 y «(Adiciona Art 54 numerales 13, 14,15 de la Ley 2466 de 2025)»
- **THEN** el sistema devuelve al menos esas dos notas, en vez de «ninguno sobre el artículo 6»

#### Scenario: Un número que coincide con el de otra norma
- **WHEN** el usuario pide el artículo 6 de la Ley 909 de 2004
- **THEN** el sistema no incluye notas de otros artículos de la Ley 909 solo porque su norma modificadora tenga un «artículo 6»

#### Scenario: Artículo que no existe
- **WHEN** el artículo pedido no existe en la norma
- **THEN** el sistema lo dice y lista los artículos detectados, sin responder «ninguno anotado» (que se leería como «intacto»)

#### Scenario: Artículo sin notas
- **WHEN** el artículo existe y su texto no trae notas de reforma
- **THEN** el sistema dice que el Gestor no anota cambios sobre ese artículo, aclara que eso no equivale a que siga intacto y remite a `resolver_cita` para la vigencia

### Requirement: La prosa de una ley modificatoria no es una nota de reforma
El sistema SHALL NOT contar como reforma de una norma las frases con que una ley modificatoria transcribe el artículo que sustituye («…modificado por la Ley 2101 de 2021, el cual quedará así:»), porque describen a otra norma. Las notas que el propio portal incrusta («(Modificado por el Art. 3 de la Ley 2418 de 2024)») SHALL seguir contándose.

#### Scenario: Ley modificatoria que transcribe un artículo ya modificado
- **WHEN** se consulta el historial, o el análisis de conflicto, de la Ley 2466 de 2025, cuyo texto transcribe «modificado por la Ley 2101 de 2021, el cual quedará así:»
- **THEN** esa frase no aparece como una reforma de la Ley 2466 de 2025

#### Scenario: Nota genuina del portal
- **WHEN** el texto de una norma trae «(Modificado por el Art. 3 de la Ley 2418 de 2024)»
- **THEN** el sistema la sigue registrando como cambio anotado

### Requirement: Las notas del análisis de conflicto se rotulan por su alcance
El análisis de conflicto SHALL rotular las reformas que lista como notas de cualquier artículo de la norma (las primeras del documento), y SHALL NOT presentarlas como reformas de la norma entera.

#### Scenario: Norma con una derogatoria parcial
- **WHEN** el análisis de la Ley 909 de 2004 lista «DEROGADO por Ley 1033 de 2006», que deroga un inciso
- **THEN** el encabezado del bloque dice que son notas de cualquier artículo de la norma, no de la ley entera
