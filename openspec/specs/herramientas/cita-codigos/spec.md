# herramientas/cita-codigos Specification

## Purpose
Define cómo se rotula un código citado por su nombre («Estatuto Tributario») y cuándo procede avisar de una corrección de tipo, para no atribuir al usuario un tipo que no escribió.

## Requirements
### Requirement: Código rotulado con su tipo oficial
Cuando una cita nombra un código, la línea «se cita aquí como …» SHALL usar el tipo oficial de la norma contenedora tal como lo publica el Gestor. Para el Estatuto Tributario, ese tipo es «Decreto Ley 624 de 1989».

#### Scenario: Estatuto Tributario
- **WHEN** `resolver_cita` recibe `cita: "art. 817 del Estatuto Tributario"`
- **THEN** la respuesta dice que se cita como «Decreto Ley 624 de 1989» y devuelve el artículo 817 de la norma con id 6533

### Requirement: Sin corrección de tipo que el usuario no escribió
El aviso «No existe un «<tipo> <número> de <año>»; el tipo oficial es …» SHALL emitirse solo cuando el tipo lo escribió el usuario en la cita y difiere del oficial. Una cita que nombra un código SHALL NOT producir ese aviso.

#### Scenario: Código citado por nombre
- **WHEN** `resolver_cita` recibe `citas: ["art. 817 del Estatuto Tributario", "art. 818 del Estatuto Tributario"]`
- **THEN** la respuesta no contiene «No existe un»

#### Scenario: Tipo escrito por el usuario
- **WHEN** `resolver_cita` recibe `cita: "Decreto 624 de 1989"`
- **THEN** la respuesta sigue avisando de que el tipo oficial es «Decreto Ley»
