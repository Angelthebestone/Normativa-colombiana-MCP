## Purpose

Incorpora dos reguladores de alta demanda (SIC y Supersalud) al buscador sectorial con el contrato Adaptador ya existente, sin añadir herramientas nuevas.

## ADDED Requirements

### Requirement: Adaptador SIC
El sistema SHALL registrar un adaptador `sic2` o ampliar el existente para cubrir el buscador de actos administrativos de la SIC (resoluciones/circulares de protección al consumidor y datos personales) vía HTML paginado, con `dominioPermitido`, `tiposDocumento`, `soportaTexto=false`, `soportaVigencia=false`, `pruebasMinimas` y `advertencia` que explique que no cubre leyes/decretos nacionales.

#### Scenario: Búsqueda por texto en SIC
- **WHEN** `buscar_normativa_sectorial` con `entidad="sic"` y `texto="datos personales"`
- **THEN** el sistema devuelve `ActoSectorial[]` con `tipo|numero|anio|fecha|epigrafe|url` del portal `sic.gov.co` y nota sobre paginación

#### Scenario: Hueco sectorial
- **WHEN** la SIC devuelve vacío
- **THEN** la respuesta incluye `advertencia` completa de la fuente y sugiere `resolver_cita`/`buscar_por_tema` para leyes/decretos

### Requirement: Adaptador Supersalud
El sistema SHALL registrar un adaptador `supersalud` para actos administrativos de la Superintendencia Nacional de Salud (circulares externas, resoluciones sancionatorias) con paginado HTML y el mismo contrato de metadatos.

#### Scenario: Búsqueda Supersalud
- **WHEN** `buscar_normativa_sectorial` con `entidad="supersalud"` y `texto="habilitación"`
- **THEN** el sistema devuelve actos de `supersalud.gov.co` con paginación y nota de filtros ignorados si aplica

### Requirement: Registro y validación
El sistema SHALL registrar ambos adaptadores en `src/fuentes/sectorial/registro.ts` y SHALL validar su contrato en `sectorial.registrar()` ( https, tipos no vacío, pruebasMinimas no vacía); un adaptador inválido no contamina el `REGISTRO`.

#### Scenario: Dominio no https
- **WHEN** un adaptador declara `dominioPermitido` sin https
- **THEN** `validar()` lanza `El adaptador "..." declara un dominioPermitido que no es https`

### Requirement: Cobertura de pruebas
El sistema SHALL cubrir cada adaptador nuevo con un caso en `test/sectorial-sdk.ts` (shape de `ActoSectorial`) y con un smoke offline con fixture; el e2e no toca la red viva.

#### Scenario: Prueba mínima faltante
- **WHEN** falta `pruebasMinimas`
- **THEN** `validar()` rechaza el alta
