## Purpose

Permite citar la Constitución Política por su nombre («art. 53 de la Constitución Política»), como ya se citan los códigos, para que la pregunta jurídica más frecuente tenga una vía exacta y no obligue a conocer el id del Gestor.

## ADDED Requirements

### Requirement: La Constitución Política se cita por su nombre
El sistema SHALL resolver «Constitución Política», «Constitución Política de Colombia», «Constitución de 1991» y «la Constitución» a la Constitución Política de 1991 del Gestor Normativo, y SHALL devolver el texto del artículo cuando la cita lo indica («art. 53 de la Constitución Política») o de varios artículos cuando se piden con la lista de artículos. La respuesta SHALL identificar la norma resuelta (Constitución Política de 1991) con su enlace, y SHALL NOT presentarla como «norma contenedora» de nada, que es como se rotulan los códigos.

#### Scenario: Artículo por nombre
- **WHEN** el usuario resuelve «art. 53 de la Constitución Política»
- **THEN** el sistema devuelve el texto del artículo 53 con su enlace al Gestor e identifica la norma como la Constitución Política de 1991

#### Scenario: Varios artículos de la Constitución
- **WHEN** el usuario resuelve «Constitución Política» con los artículos 53 y 83
- **THEN** el sistema descarga la norma una vez y devuelve los dos artículos

#### Scenario: Otra norma citada antes
- **WHEN** la cita es «art. 6 de la Ley 1221 de 2008, conforme a la Constitución»
- **THEN** el sistema resuelve la Ley 1221 de 2008, porque es la norma que aparece primero en la cita

#### Scenario: La Corte Constitucional no es la Constitución
- **WHEN** el texto de la cita solo dice «Corte Constitucional»
- **THEN** el sistema no lo interpreta como una cita de la Constitución Política
