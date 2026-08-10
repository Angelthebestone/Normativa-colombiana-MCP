## Purpose

Ofrece una única herramienta de búsqueda federada que agrega las fuentes ya existentes (Gestor, Corte Constitucional, SUIN, DIAN) para que el enrutado no dependa solo de las INSTRUCCIONES de 60 líneas.

## Requirements

### Requirement: Herramienta buscar_unificado
El sistema SHALL exponer `buscar_unificado` con `texto` (requerido), `perfil` opcional (`laboral|tributario|ambiental|contratacion|energia`), `fuentes` opcional (subset de `gestor|corte|suin|dian`), y `limite` (default 15, max 30).

#### Scenario: Consulta sin perfil
- **WHEN** el usuario llama `buscar_unificado` con `texto="teletrabajo"` sin perfil ni fuentes
- **THEN** el sistema consulta en paralelo Gestor (vía `buscar_por_tema` + fallback `buscar_normas`), Corte Constitucional y SUIN, devuelve una lista unificada con `fuente` y `url` por item y respeta `limite_caracteres` del transporte

#### Scenario: Consulta con perfil tributario
- **WHEN** `perfil="tributario"` y `texto="retención en la fuente"`
- **THEN** el sistema incluye DIAN en el fan-out y prioriza sus resultados, además de los del Gestor

#### Scenario: Fuente explícita
- **WHEN** `fuentes=["corte"]`
- **THEN** solo se consulta la Corte Constitucional

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
