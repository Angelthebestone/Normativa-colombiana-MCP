## Purpose

Fija lo que cada herramienta declara en `tools/list` (anotaciones MCP y contenido mínimo de la descripción), para que un agente sepa sin abrir el esquema qué efectos tiene, cuándo usarla y cómo se combinan sus parámetros.

## ADDED Requirements

### Requirement: Anotaciones MCP en todas las herramientas
Cada herramienta de `tools/list` SHALL declarar `annotations` con `readOnlyHint`, `destructiveHint`, `idempotentHint` y `openWorldHint` explícitos, y los valores SHALL corresponder a su comportamiento real:
- `readOnlyHint: true` solo si ninguna combinación de parámetros escribe en disco ni modifica estado que otra llamada pueda leer.
- `destructiveHint: true` si alguna combinación sobrescribe o borra datos existentes.
- `openWorldHint: true` si la herramienta consulta algún portal externo; `false` si responde solo con índices empaquetados o estado local.
- `idempotentHint: true` si repetir la misma llamada no produce efectos adicionales.

Ninguna herramienta SHALL declararse destructiva mientras no sobrescriba ni borre datos.

#### Scenario: Herramienta de consulta en red
- **WHEN** un cliente lista las herramientas y lee `buscar_jurisprudencia_consejo_estado`
- **THEN** sus anotaciones son `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: true`

#### Scenario: Herramienta sin red
- **WHEN** un cliente lee las anotaciones de `describir_fuentes`
- **THEN** `openWorldHint` es `false` y `readOnlyHint` es `true`

#### Scenario: Herramienta que escribe en disco
- **WHEN** un cliente lee las anotaciones de `obtener_documento` y de `expediente`
- **THEN** ambas declaran `readOnlyHint: false` y `destructiveHint: false`

#### Scenario: Cobertura completa
- **WHEN** un cliente lista las herramientas
- **THEN** las 28 tienen las cuatro anotaciones definidas

### Requirement: Las escrituras a disco no sobrescriben
Cuando `obtener_documento` guarda el texto en disco (`entero` o `ruta_destino`), o `expediente` exporta (`accion: "exportar"`), y ya existe un archivo con el mismo nombre, el sistema SHALL escribir con un sufijo numérico y SHALL informar de la ruta final, en vez de sobrescribir.

#### Scenario: Dos descargas a la misma ruta
- **WHEN** `obtener_documento` guarda dos veces el texto de la misma fuente en la misma `ruta_destino`
- **THEN** existen dos archivos distintos y la segunda respuesta informa del nombre con sufijo

#### Scenario: Exportar sobre un archivo existente
- **WHEN** `expediente` exporta a una `ruta` de archivo que ya existe
- **THEN** el archivo existente queda intacto y la respuesta informa de la ruta con sufijo donde se escribió

### Requirement: Descripción que añade lo que el esquema no dice
La descripción de cada herramienta SHALL declarar, sin repetir lo que ya dice el esquema campo a campo:
- qué devuelve;
- cuándo NO usarla, nombrando la herramienta hermana que corresponde en ese caso;
- las relaciones entre parámetros que el esquema no expresa (un parámetro que solo vale con otro, uno que anula a otro, o qué combinación activa cada modo).

La descripción SHALL NOT contener erratas.

#### Scenario: resolver_cita describe el modo validar
- **WHEN** un cliente lee la descripción de `resolver_cita`
- **THEN** la descripción dice que `validar` cambia la respuesta a un veredicto sobre la cita y que `url` y `formato` solo valen con `validar`

#### Scenario: linea_jurisprudencial nombra sus alternativas
- **WHEN** un cliente lee la descripción de `linea_jurisprudencial`
- **THEN** la descripción dice cuándo usar `buscar_jurisprudencia` o `resolver_cita` en su lugar

#### Scenario: analizar_conflicto sin errata
- **WHEN** un cliente lee la descripción de `analizar_conflicto`
- **THEN** no contiene «mencionanun»
