## Purpose

Ofrece una única herramienta de búsqueda federada que agrega las fuentes ya existentes (Gestor, Corte Constitucional, SUIN, DIAN y sectoriales por perfil) para que el enrutado no dependa solo de las INSTRUCCIONES de 60 líneas.

## Requirements

### Requirement: Herramienta buscar_unificado
El sistema SHALL exponer `buscar_unificado` con `texto` (requerido), `perfil` opcional (`laboral|tributario|ambiental|contratacion|energia|salud|mineria`), `fuentes` opcional (subset de `gestor|corte|suin|dian|invima|supersalud|anm`), y `limite` (default 15, max 30). El federado SHALL heredar la semántica de términos de los buscadores subyacentes (todos los términos / frase exacta / OR declarado) y SHALL aplicar el descarte de palabras comunes. Los perfiles `salud` y `mineria` SHALL incluir en el fan-out las fuentes sectoriales correspondientes (INVIMA y Supersalud para salud; ANM para minería), etiquetando cada resultado con su fuente.

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

#### Scenario: Perfil salud
- **WHEN** `perfil="salud"` y `texto="habilitación"`
- **THEN** el sistema incluye INVIMA y Supersalud en el fan-out, etiqueta cada resultado con su fuente y explica el vacío por fuente sin concluir que la norma no exista

#### Scenario: Perfil mineria
- **WHEN** `perfil="mineria"` y `texto="títulos mineros"`
- **THEN** el sistema incluye la ANM en el fan-out, etiqueta cada resultado con su fuente y explica el vacío por fuente sin concluir que la norma no exista

#### Scenario: Perfil desconocido
- **WHEN** `perfil` no coincide con ninguno de los admitidos
- **THEN** el sistema rechaza el perfil con un mensaje que lista los admitidos, sin ejecutar el fan-out

### Requirement: Agregación con atribución
El sistema SHALL etiquetar cada resultado con su fuente (`gestor|dian|corte-constitucional|suin|creg|...`), su URL citable y, cuando exista, su señal de vigencia/estado sin reinterpretarla.

#### Scenario: Resultado con vigencia SUIN del buscador
- **WHEN** un resultado SUIN trae `vigencia` del índice Azure
- **THEN** se rotula `Vigencia SEGÚN EL BUSCADOR` y se remite a `resolver_cita` para la ficha, igual que hoy en `buscar_en_suin`

### Requirement: Alternativas y vacíos explicados
El sistema SHALL aplicar `conAlternativas` (sin tildes + tesauro) cuando una fuente rinde 0 y SHALL explicar el vacío por fuente, sin concluir que la norma no existe.

#### Scenario: Término con hueco en SUIN
- **WHEN** `texto="teletrabajo"` rinde 0 en SUIN
- **THEN** la sección SUIN del federado dice que no rinde para ese texto por hueco del índice y sugiere `buscar_por_tema`/`resolver_cita`

### Requirement: No duplicar contratos existentes
El sistema SHALL reutilizar los módulos de búsqueda ya existentes y no replicar parsers; el federado es orquestación, no nuevo scraper.

#### Scenario: Gestor caído
- **WHEN** el Gestor responde 503
- **THEN** el federado devuelve las demás fuentes y marca la sección Gestor como no disponible con el error tras reintento

### Requirement: Advertencia de snapshot antiguo
El sistema SHALL mostrar, junto a los resultados que provienen de un índice empaquetado (temático, SUIN), una advertencia cuando la fecha de generación del snapshot supere un umbral configurable (default 30 días), indicando la fecha del índice y que puede no reflejar normas recientes.

#### Scenario: Índice reciente
- **WHEN** un resultado proviene de un snapshot generado hace menos de 30 días
- **THEN** el sistema no añade la advertencia de antigüedad

#### Scenario: Índice antiguo
- **WHEN** un resultado proviene de un snapshot generado hace más de 30 días
- **THEN** el sistema añade `Índice del <fecha> (puede no incluir normas recientes)` junto al resultado
