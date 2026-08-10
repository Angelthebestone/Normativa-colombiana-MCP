## Purpose

Garantiza que el servidor declare en Glama los metadatos de perfil necesarios para completar el checklist de calidad (glama.json y servidores relacionados), y que la documentación interna de calidad refleje el estado real hacia el 100 % de perfil.

## ADDED Requirements

### Requirement: El servidor declara metadatos de perfil Glama (glama.json)
El repositorio SHALL incluir un fichero `glama.json` en la raíz con nombre, descripción, autor, repositorio y categorías del servidor, además de la lista de servidores relacionados. El fichero SHALL estar empaquetado en el `.mcpb` generado por `npm run pack` y NO SHALL depender de consultas en red ni de dependencias nuevas.

#### Scenario: El paquete incluye glama.json
- **WHEN** se ejecuta `npm run pack` sobre el repositorio
- **THEN** el `.mcpb` resultante contiene `glama.json` en su raíz
- **AND** el fichero incluye `related_servers` con al menos un servidor relacionado

#### Scenario: El servidor se registra en Glama sin red
- **WHEN** Glama escanea el repositorio para generar la ficha
- **THEN** puede leer `glama.json` desde el paquete y declarar "Has a Glama release", "Has a permissive license", "Has README" y "Has related servers" sin consultar los portales del Estado

### Requirement: Descripciones de herramientas alineadas con el diagnóstico Glama
Las herramientas identificadas en `CALIDAD_HERRAMIENTAS_GLAMA.md` con puntuación baja (nota global <4.0 o Parameters <4) SHALL tener descripciones y descripciones de parámetros reescritas que cubran Purpose Clarity, Behavioral Transparency, Parameter Semantics y Usage Guidelines, sin cambiar su contrato (nombre, parámetros, tipos, valores devueltos).

#### Scenario: Reescritura de expediente_agregar sin romper contrato
- **WHEN** se invoca `expediente_agregar` tras el cambio
- **THEN** acepta los mismos parámetros (id, campo, texto) y devuelve el mismo formato que antes
- **AND** su descripción ahora declara que el expediente DEBE existir (creado con `expediente_crear`), el almacenamiento en memoria, el vencimiento a las 6 horas y la activación con `EXPEDIENTES=1`

#### Scenario: Reescritura de expediente_leer sin romper contrato
- **WHEN** se invoca `expediente_leer` tras el cambio
- **THEN** acepta el mismo parámetro `id` y devuelve el mismo contenido que antes
- **AND** su descripción aclara el origen del `id` (expediente_crear) y la caducidad/expiración sin mezclar el comportamiento de `expediente_crear`

#### Scenario: Reescritura de herramientas sectoriales sin cambiar entidades
- **WHEN** se consultan `buscar_normativa_anh`, `buscar_resoluciones_creg` o `consultar_perfil` tras el cambio
- **THEN** sus descripciones y `describe()` de parámetros (incluido `limite` donde falte) cubren el cuándo-usar y cuándo-no-usar, con referencias a las herramientas alternativas
- **AND** ninguna cambia sus parámetros, tipos ni respuestas

### Requirement: La documentación de calidad es la referencia única del estado Glama
`CALIDAD_HERRAMIENTAS_GLAMA.md` SHALL reflejar el checklist de perfil de Glama al 100 % cuando `glama.json` esté presente, y SHALL documentar los pasos manuales restantes (sembrado de uso con "Try in Browser") como pendientes explícitos, sin depender de que los portales del Estado estén en línea.

#### Scenario: Actualización del checklist tras añadir glama.json
- **WHEN** `glama.json` con servidores relacionados se añade al repositorio
- **THEN** el checklist en `CALIDAD_HERRAMIENTAS_GLAMA.md` marca como ✅ "Has a Glama release", "Server Coherence", "Tool Definition Quality", "Maintenance", "Has a permissive license", "Has README", "Has glama.json", "Author verified" y "Has related servers"
- **AND** el único ítem pendiente queda explícito como "No recent usage — Try in Browser manual"
