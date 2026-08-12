## Purpose

Amplía los perfiles de `buscar_unificado` con `salud` (INVIMA, Supersalud) y `mineria` (ANM), de modo que una llamada agregada cubra sectores que hoy solo funcionan por separado, sin exigir saber de antemano en qué herramienta sectorial buscar.


## Requirements

### Requirement: Perfiles salud y mineria
El sistema SHALL aceptar los perfiles `salud` y `mineria` en `buscar_unificado` además de los existentes (`laboral|tributario|ambiental|contratacion|energia`), y SHALL incluir en el fan-out las fuentes sectoriales correspondientes (INVIMA y Supersalud para salud; ANM para minería), junto con las fuentes base del federado.

#### Scenario: Perfil salud
- **WHEN** el usuario llama `buscar_unificado` con `perfil="salud"` y `texto="habilitación"`
- **THEN** el sistema incluye INVIMA y Supersalud en el fan-out y etiqueta cada resultado con su fuente, además de las fuentes base

#### Scenario: Perfil mineria
- **WHEN** el usuario llama `buscar_unificado` con `perfil="mineria"` y `texto="títulos mineros"`
- **THEN** el sistema incluye la ANM y etiqueta cada resultado con su fuente

#### Scenario: Perfil desconocido
- **WHEN** `perfil` no coincide con ninguno de los admitidos
- **THEN** el sistema rechaza el perfil con un mensaje que lista los admitidos, sin ejecutar el fan-out


### Requirement: Atribución y vacíos por fuente ampliada
El sistema SHALL etiquetar cada resultado de los nuevos perfiles con su fuente y URL, y SHALL explicar el vacío por fuente (p.ej. INVIMA sin resultados) sin concluir que la norma no existe, igual que con los perfiles existentes.

#### Scenario: Fuente ampliada sin resultados
- **WHEN** dentro del perfil salud, Supersalud no rinde para el texto
- **THEN** la sección Supersalud del federado declara que no rinde y sugiere consultar la fuente directamente, sin afirmar que no exista norma
