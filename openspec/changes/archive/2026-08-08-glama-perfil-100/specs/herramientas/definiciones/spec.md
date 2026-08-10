## Purpose

Define el contrato observable de las descripciones de las herramientas del servidor: qué debe declarar cada descripción reescrita y cómo se mantiene la compatibilidad sin cambios de contrato.

## ADDED Requirements

### Requirement: Las descripciones de herramientas reescritas cubren las seis dimensiones Glama
Toda descripción reescrita de una herramienta SHALL declarar, en un texto conciso y front-loaded: (1) propósito específico con verbo y recurso, (2) comportamiento transparente (efectos, límites, errores), (3) cuándo usarla y cuándo no, con alternativas nombradas, (4) semántica de parámetros más allá del esquema (interacciones, rangos, defaults), y (5) qué devuelve. El texto SHALL ser conciso y sin redundancia.

#### Scenario: Descripción de expediente_agregar cubre propósito y prerrequisito
- **WHEN** un agente lee la descripción de `expediente_agregar`
- **THEN** entiende que agrega una entrada a un expediente ya creado con `expediente_crear`
- **AND** entiende que el expediente es en memoria, vence a las 6 horas y requiere `EXPEDIENTES=1`

#### Scenario: Descripción de expediente_leer no mezcla el comportamiento de expediente_crear
- **WHEN** un agente lee la descripción de `expediente_leer`
- **THEN** entiende que lee el contenido de un expediente por `id` y que el id se obtiene de `expediente_crear`
- **AND** no aparece la cláusula "crea un expediente EN MEMORIA" (propia de `expediente_crear`)

### Requirement: Las descripciones de parámetros compensan huecos del esquema
Para todo parámetro que Glama señale sin descripción en el esquema (p. ej. `limite` en `consultar_perfil`, `max_pasajes` donde falte), el `describe()` SHALL añadir semántica de rango, interacción o default, o la descripción principal SHALL compensarlo.

#### Scenario: Parámetros sin describe() quedan explicados
- **WHEN** se consulta el esquema de `consultar_perfil` (o de otra herramienta con huecos señalados)
- **THEN** el parámetro `limite` tiene descripción de rango/default o la descripción principal lo menciona explícitamente

### Requirement: Sin cambios de contrato en las herramientas reescritas
Ninguna herramienta reescrita SHALL cambiar su nombre, sus parámetros, sus tipos, sus valores por defecto ni el formato de sus respuestas. Los cambios SHALL limitarse al texto de `description` y `describe()`.

#### Scenario: El esquema de entrada es idéntico
- **WHEN** se compara el inputSchema de una herramienta reescrita antes y después
- **THEN** los nombres, tipos, required/optional y defaults son los mismos
- **AND** las pruebas existentes (`npm test`, `npm run test:e2e`) pasan sin modificación

### Requirement: Nombres de herramientas y fuentes no cambian
Los nombres públicos de las herramientas y las claves de las fuentes (`entidad` en `buscar_normativa_sectorial`, claves de `describir_fuentes`) SHALL permanecer idénticos; el cambio se limita al texto descriptivo.

#### Scenario: Claves de describir_fuentes intactas
- **WHEN** se invoca `describir_fuentes` tras el cambio
- **THEN** las claves (`gestor`, `corte-constitucional`, `suin`, `sic`, etc.) y las entidades son las mismas de antes
