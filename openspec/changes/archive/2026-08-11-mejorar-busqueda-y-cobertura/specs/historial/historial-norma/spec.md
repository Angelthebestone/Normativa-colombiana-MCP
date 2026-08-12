## Purpose

Expone la cadena de reformas de una norma como resultado navegable (qué norma la modificó/adicionó/derogó y qué artículo afectó cada cambio), estructurando el parser `historial()` que ya extrae los `Cambio[]` desde las notas del Gestor, sin reimplementar el parseo.

## ADDED Requirements

### Requirement: Historial de reformas navegable
El sistema SHALL exponer el historial de una norma como una cadena estructurada: para cada cambio, la acción (`modificado`, `adicionado`, `derogado`, `sustituido`, `subrogado`, `compilado`, `corregido`, `reglamentado`, `declarado`), la norma que lo introdujo (con su año), el artículo afectado cuando la nota lo dice, y la nota literal citable. El sistema SHALL ordenar los cambios de forma estable y SHALL conservar la nota literal palabra por palabra (es lo citable). El historial SHALL obtenerse desde el texto del Gestor vía `historial()` existente, sin reimplementar el parser.

#### Scenario: Norma con reformas anotadas
- **WHEN** el usuario pide el historial de una norma del Gestor (p.ej. la Ley 100 de 1993) con reformas anotadas en el texto
- **THEN** el sistema devuelve la lista de cambios con `acción | norma (año) | artículo afectado | literal`, en orden estable y con la literal palabra por palabra

#### Scenario: Norma sin reformas anotadas
- **WHEN** el texto de la norma no contiene notas de reforma
- **THEN** el sistema devuelve "sin reformas anotadas en el texto" y recuerda que el Gestor no siempre anota las reformas y que la vigencia se consulta con `resolver_cita`, sin afirmar que la norma nunca fue reformada

#### Scenario: Límite de cambios
- **WHEN** la norma tiene más cambios de los que se muestran
- **THEN** el sistema muestra un tope (p.ej. los primeros 20), declara cuántos se omitieron y cómo pedir más

### Requirement: Límite declarado y sin deducción de vigencia
El sistema SHALL declarar que el historial son las notas literales del portal, sin ordenarlas por vigencia ni deducir cuál reforma rige hoy: el estado de vigencia actual es de `resolver_cita`, no de la cadena de reformas.

#### Scenario: No deducir vigencia desde el historial
- **WHEN** el historial muestra "derogado por" y "modificado por" de normas distintas
- **THEN** el sistema no concluye cuál rige: presenta las notas y remite a `resolver_cita` para el estado actual

### Requirement: Verificable sin red
El sistema SHALL probar el historial estructurado contra fixtures de texto del Gestor (notas en las tres formas: pasiva, activa entre paréntesis, control constitucional), de modo que la cadena navegable se verifique sin depender de la red viva.

#### Scenario: Fixture con las tres formas de nota
- **WHEN** se ejecuta el test contra un fixture que contiene notas pasiva, activa y de control constitucional
- **THEN** las tres se estructuran como cambios con su acción, norma, año, artículo y literal correctos
