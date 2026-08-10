## Purpose

Incorpora dos entidades de alta demanda al buscador sectorial: la Agencia Nacional de Tierras (ANT) y la Unidad Administrativa Especial para la Atención y Reparación Integral a las Víctimas (UARIV), con el contrato `Adaptador` ya existente y sin añadir herramientas nuevas.

## Requirements

### Requirement: Adaptador ANT
El sistema SHALL registrar un adaptador `ant` para la normativa de la Agencia Nacional de Tierras publicada en `/normativa`, con `dominioPermitido`, `tiposDocumento` (Resolución, Decreto, Ley, Circular, Concepto, Sentencia, Directiva, Manual), `soportaTexto=false`, `soportaVigencia=false`, `pruebasMinimas` y `advertencia` que explique que los enlaces son PDF sin texto extraíble y que no publica vigencia.

#### Scenario: Búsqueda por texto en ANT
- **WHEN** `buscar_normativa_sectorial` con `entidad="ant"` y `texto="Sembrando Vida"`
- **THEN** el sistema devuelve `ActoSectorial[]` con `tipo|numero|anio|fecha|epigrafe|url` del portal `ant.gov.co`, con el PDF como URL y el epígrafe recuperado del título cuando el portal no publica el objeto

#### Scenario: Paginación Drupal
- **WHEN** se pide `pagina=2` en ANT
- **THEN** el sistema consulta `?page=1` (el paginador de Drupal empieza en 0) y devuelve el segundo tramo

#### Scenario: Hueco sectorial
- **WHEN** la ANT devuelve vacío para un texto
- **THEN** la respuesta incluye `advertencia` completa de la fuente y no concluye que la norma no exista

### Requirement: Adaptador Unidad para las Víctimas
El sistema SHALL registrar un adaptador `unidadvictimas` para la biblioteca de documentos de la UARIV en `/documentos_bibliotec/`, con `dominioPermitido`, `tiposDocumento` (Informes, Planeación, Presupuesto, Documento), `soportaTexto=false`, `soportaVigencia=false`, `pruebasMinimas` y `advertencia` que aclare que son documentos de gestión, no actos con fuerza normativa.

#### Scenario: Listado de documentos
- **WHEN** `buscar_normativa_sectorial` con `entidad="unidadvictimas"` sin filtros
- **THEN** el sistema devuelve documentos con categoría como tipo, título como epígrafe, fecha de publicación y enlace a la página del documento

#### Scenario: Paginación WordPress
- **WHEN** se pide `pagina=2` en Unidad de Víctimas
- **THEN** el sistema consulta `/documentos_bibliotec/page/2/` (WordPress pagina desde /page/2/) y devuelve el segundo tramo

#### Scenario: Hueco documental
- **WHEN** la búsqueda por texto no coincide con ningún documento
- **THEN** la respuesta incluye `advertencia` completa y explica que el filtro actúa sobre título y categoría

### Requirement: Registro y validación
El sistema SHALL registrar ambos adaptadores en `src/fuentes/sectorial/registro.ts` y SHALL validar su contrato en `sectorial.registrar()` (https, tipos no vacío, pruebasMinimas no vacía); un adaptador inválido no contamina el `REGISTRO`.

#### Scenario: Dominio no https
- **WHEN** un adaptador declara `dominioPermitido` sin https
- **THEN** `validar()` lanza `El adaptador "..." declara un dominioPermitido que no es https`

### Requirement: Cobertura de pruebas
El sistema SHALL cubrir cada adaptador nuevo con un caso en `test/sectorial-sdk.ts` (shape de `ActoSectorial` y contrato completo) y con un smoke contra el portal real; el e2e no toca la red viva.

#### Scenario: Contrato completo
- **WHEN** se importa el registro real
- **THEN** los adaptadores `ant` y `unidadvictimas` están dados de alta con `dominioPermitido` https, `soportaTexto=false`, `soportaVigencia=false` y `advertencia` de más de 40 caracteres
