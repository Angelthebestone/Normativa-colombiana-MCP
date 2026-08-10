## MODIFIED Requirements

### Requirement: Herramienta buscar_unificado
El sistema SHALL exponer `buscar_unificado` con `texto` (requerido), `perfil` opcional (`laboral|tributario|ambiental|contratacion|energia`), `fuentes` opcional (subset de `gestor|corte|suin|dian`), y `limite` (default 15, max 30). El federado SHALL heredar la semántica de términos de los buscadores subyacentes (todos los términos / frase exacta / OR declarado) y SHALL aplicar el descarte de palabras comunes.

#### Scenario: Consulta sin perfil
- **WHEN** el usuario llama `buscar_unificado` con `texto="teletrabajo"` sin perfil ni fuentes
- **THEN** el sistema consulta en paralelo Gestor (vía `buscar_por_tema` + fallback `buscar_normas`), Corte Constitucional y SUIN, devuelve una lista unificada con `fuente` y `url` por item y respeta `limite_caracteres` del transporte, aplicando la semántica de términos del buscador subyacente

#### Scenario: Término con palabras comunes
- **WHEN** el usuario consulta un término poco distintivo con muchas palabras vacías
- **THEN** el sistema descarta las palabras vacías (o declara que el buscador subyacente no lo hace) y devuelve resultados acotados, sin presentar decenas de miles como útiles

#### Scenario: Consulta con perfil tributario
- **WHEN** `perfil="tributario"` y `texto="retención en la fuente"`
- **THEN** el sistema incluye DIAN en el fan-out y prioriza sus resultados, además de los del Gestor

#### Scenario: Fuente explícita
- **WHEN** `fuentes=["corte"]`
- **THEN** solo se consulta la Corte Constitucional
