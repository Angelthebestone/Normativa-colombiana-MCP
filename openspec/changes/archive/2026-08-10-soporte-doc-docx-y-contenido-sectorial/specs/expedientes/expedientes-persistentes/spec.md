## ADDED Requirements

### Requirement: Expedientes
El sistema SHALL exponer la herramienta `expediente(accion: crear|agregar|leer)` para agrupar consultas, citas y observaciones de una investigación. La capacidad SHALL poder activarse (no estar desactivada por defecto en instalaciones que la necesiten) y SHALL poder persistir en disco (JSON en un directorio configurable), de modo que los expedientes no se pierdan al reiniciar el servidor ni caduquen por un TTL fijo de 6 horas.

#### Scenario: Habilitación
- **WHEN** la instalación activa expedientes (p.ej. `EXPEDIENTES=1` o por configuración)
- **THEN** `expediente` con `accion="crear"` crea un expediente persistente o en memoria según la configuración, y `agregar`/`leer` funcionan

#### Scenario: Persistencia entre reinicios
- **WHEN** se activa la persistencia en disco y el servidor se reinicia
- **THEN** los expedientes creados antes del reinicio siguen accesibles con `accion="leer"`

#### Scenario: Sin TTL fijo
- **WHEN** un expediente se crea sin expiración configurada
- **THEN** no se borra por el TTL de 6 horas; solo se elimina si la configuración lo pide o si se elimina explícitamente
