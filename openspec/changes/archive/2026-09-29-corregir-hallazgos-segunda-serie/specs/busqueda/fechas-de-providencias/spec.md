## Purpose

Evita que una fecha administrativa del índice de un tribunal se cite como la fecha de la providencia, rotulando cada fecha mostrada por lo que realmente es.

## ADDED Requirements

### Requirement: La fecha de un resultado se rotula por lo que es
Cada fecha que se muestre junto a una providencia SHALL identificar de qué es fecha y SHALL NOT presentarse como la fecha de la providencia cuando no lo es. En el Consejo de Estado es la fecha del proceso; en la Corte Suprema, la de registro de la providencia en el índice. La respuesta SHALL recordar que la fecha de la providencia está en su texto. La fecha de las sentencias de la Corte Constitucional, que sí es la de la providencia, SHALL quedar como está.

#### Scenario: Resultado del Consejo de Estado
- **WHEN** el usuario busca jurisprudencia del Consejo de Estado
- **THEN** cada resultado rotula la fecha como «Fecha del proceso» y no como «Fecha» a secas

#### Scenario: Resultado de la Corte Suprema
- **WHEN** el usuario busca jurisprudencia de la Corte Suprema
- **THEN** cada resultado rotula su fecha como registro en el índice (p.ej. «registrada el 2017-12-15») y no como la fecha de la sentencia

#### Scenario: Aviso de citación
- **WHEN** la respuesta lista providencias del Consejo de Estado o de la Corte Suprema con su fecha
- **THEN** advierte que la fecha de la providencia se lee en su texto y que para citar se usa el radicado o la referencia

#### Scenario: Corte Constitucional
- **WHEN** el usuario busca jurisprudencia de la Corte Constitucional
- **THEN** la fecha se presenta como hasta ahora, porque es la de la providencia
