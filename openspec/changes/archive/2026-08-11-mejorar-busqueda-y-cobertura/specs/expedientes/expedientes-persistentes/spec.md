## MODIFIED Requirements

### Requirement: Expedientes
El sistema SHALL exponer la herramienta `expediente(accion: crear|agregar|leer)` para agrupar consultas, citas y observaciones de una investigación. La capacidad SHALL poder activarse (no estar desactivada por defecto en instalaciones que la necesiten) y SHALL poder persistir en disco (JSON en un directorio configurable), de modo que los expedientes no se pierdan al reiniciar el servidor ni caduquen por un TTL fijo de 6 horas. El sistema SHALL comunicar claramente el estado de la capacidad: cuando está desactivada (sin `EXPEDIENTES=1`), la respuesta SHALL explicar que existe y cómo activarla, en lugar de un error seco — el `AVISO_DESACTIVADO` existente ya cumple esto y se conserva. El sistema SHALL además documentar el opt-in en la descripción de la herramienta y en `describir_fuentes`, para que el operador sepa que la capacidad existe aunque esté desactivada.

#### Scenario: Habilitación
- **WHEN** la instalación activa expedientes (p.ej. `EXPEDIENTES=1` o por configuración)
- **THEN** `expediente` con `accion="crear"` crea un expediente persistente o en memoria según la configuración, y `agregar`/`leer` funcionan

#### Scenario: Persistencia entre reinicios
- **WHEN** se activa la persistencia en disco y el servidor se reinicia
- **THEN** los expedientes creados antes del reinicio siguen accesibles con `accion="leer"`

#### Scenario: Sin TTL fijo
- **WHEN** un expediente se crea sin expiración configurada
- **THEN** no se borra por el TTL de 6 horas; solo se elimina si la configuración lo pide o si se elimina explícitamente

#### Scenario: Desactivación explicada
- **WHEN** la instalación no tiene `EXPEDIENTES=1` y el usuario llama `expediente`
- **THEN** la respuesta indica que la capacidad existe, que está desactivada por configuración, cómo activarla (`EXPEDIENTES=1`) y que sin persistencia (`EXPEDIENTES_DIR`) los datos se pierden al reiniciar (comportamiento actual del `AVISO_DESACTIVADO`, se mantiene)

#### Scenario: Descubrimiento sin invocar la herramienta
- **WHEN** el operador consulta `describir_fuentes` o la descripción de `expediente` en una instalación sin `EXPEDIENTES=1`
- **THEN** la descripción menciona que la capacidad existe, cómo se activa y qué gana con `EXPEDIENTES_DIR`, sin necesidad de llamar a la herramienta
