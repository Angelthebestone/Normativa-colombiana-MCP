## Purpose

Amplía los patrones de clasificación léxica de `comparar_articulos` (hoy `plazo`, `sancion`, `excepcion`, `sujeto` en `diff.ts`) para cubrir obligaciones de cumplimiento ("queda prohibido", "el responsable deberá", plazos concretos), sin modelo semántico y declarando el límite.


## Requirements

### Requirement: Ampliación de patrones de cumplimiento
El sistema SHALL ampliar `clasificarDiferencia` con patrones léxicos adicionales a los existentes (`plazo`, `sancion`, `excepcion`, `sujeto`) que capturen obligaciones de cumplimiento: prohibiciones ("queda prohibido", "no podrá"), obligaciones de hacer ("el responsable deberá", "estará obligado a", "debe"), y plazos concretos de cumplimiento ("dentro de los X días hábiles", "a más tardar", "en un término no mayor a"). Los patrones SHALL evaluarse en el mismo orden declarado (gana la primera coincidencia) y el resultado SHALL seguir devolviendo una de las clasificaciones conocidas, ampliando `no clasificado` solo cuando ningún patrón aplica.

#### Scenario: Prohibición detectada
- **WHEN** una línea añade "Queda prohibido el cobro de sumas no autorizadas"
- **THEN** la línea se clasifica con la categoría de cumplimiento correspondiente (p.ej. `prohibicion` u `obligacion`), no como `no clasificado`

#### Scenario: Obligación de hacer detectada
- **WHEN** una línea añade "El responsable deberá presentar el informe dentro de los 10 días hábiles"
- **THEN** la línea se clasifica (por el patrón que gane primero, p.ej. plazo u obligación) y se declara el patrón

#### Scenario: Sin patrón
- **WHEN** una línea no coincide con ningún patrón conocido
- **THEN** se clasifica como `no clasificado`, sin inventar una categoría


### Requirement: Límite léxico declarado
El sistema SHALL declarar en la descripción de `comparar_articulos` y en su cierre que la clasificación ampliada sigue siendo léxica (regex, sin modelo semántico), que la sinonimia real ("multa"→"sanción pecuniaria", "queda prohibido"→"se prohíbe") puede no detectarse y queda en `no clasificado` para revisión manual.

#### Scenario: Sinonimia no cubierta
- **WHEN** una línea reformula una obligación con sinónimos no cubiertos por los patrones
- **THEN** el sistema la deja en `no clasificado` y el cierre recuerda el límite léxico


### Requirement: Verificable sin red y sin dependencias nuevas
El sistema SHALL probar los patrones ampliados con casos de texto directos (sin red) y SHALL no añadir dependencias: los patrones se implementan en `diff.ts` con regex, preservando el bundle y el audit.

#### Scenario: Casos directos
- **WHEN** se ejecutan los tests de `clasificarDiferencia` con fragmentos que contienen prohibiciones, obligaciones y plazos
- **THEN** cada fragmento se clasifica según el patrón esperado, y los que no aplican quedan en `no clasificado`

#### Scenario: Cero dependencias nuevas
- **WHEN** se implementa la ampliación
- **THEN** no se añaden `dependencies` ni `devDependencies`; solo cambia `diff.ts` y sus tests
