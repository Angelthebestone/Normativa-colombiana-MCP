## Purpose

Provee un comando único de salud (`verificar`) que ejecuta la cadena completa de validación (build, typecheck, tests, red de regresión contra el bundle, smoke), garantiza que cada herramienta publicada tenga casos de prueba y detecta regresiones de portales (términos que antes rendían y ahora dan vacío), de modo que no haya que probar el MCP manualmente a cada rato.


## Requirements

### Requirement: Comando único de verificación
El sistema SHALL exponer un comando `verificar` (npm script) que ejecute en orden: build del bundle → typecheck → tests unitarios → red de regresión contra el bundle recién construido → smoke contra red viva, y SHALL terminar con un veredicto agregado (todo verde, o la lista de herramientas/dominios que fallaron con su input y salida cruda). Si un paso falla, el comando SHALL detenerse con el paso fallido identificado y su causa.

#### Scenario: Todo verde
- **WHEN** se ejecuta `npm run verificar` y todos los pasos pasan
- **THEN** el comando termina con código 0 y un resumen de pasos ejecutados y herramientas cubiertas

#### Scenario: Un paso falla
- **WHEN** la red de regresión falla en la herramienta `buscar_normativa_upme`
- **THEN** el comando detiene la cadena, reporta el paso (`red`), la herramienta, el input que falló y el texto crudo devuelto, y termina con código distinto de 0


### Requirement: Garantía de cobertura por herramienta
El sistema SHALL mantener un mapa tool→casos de prueba y SHALL verificar en `verificar` que cada herramienta publicada en `tools/list` tenga al menos un caso en la red de regresión; una herramienta publicada sin caso SHALL romper la verificación con el nombre de la tool y el archivo de pruebas esperado.

#### Scenario: Tool nueva sin casos
- **WHEN** se publica una herramienta nueva (p.ej. `consultar_vigencia`) sin añadirle casos a la red
- **THEN** `verificar` falla indicando que `consultar_vigencia` no tiene casos y dónde añadirlos

#### Scenario: Tool con casos
- **WHEN** toda tool publicada tiene al menos un caso en la red
- **THEN** la verificación de cobertura pasa y el resumen lista las tools cubiertas


### Requirement: Tests deterministas con fixtures congelados
El sistema SHALL probar los parsers de cada fuente contra fixtures congelados (HTML/JSON real medido, guardado como snapshot en `test/fixtures/`), de modo que los tests unitarios no dependan de la red viva ni de cambios de los portales. Un cambio de marcado del portal NO rompe los tests de fixtures; solo el smoke (red viva) puede fallar por causas ajenas, y debe distinguirse en el reporte.

#### Scenario: Parser sin red
- **WHEN** se ejecuta la suite unitaria sin conexión
- **THEN** los parsers de todas las fuentes se prueban contra fixtures y pasan, sin peticiones a portales

#### Scenario: Portal cambió de marcado
- **WHEN** el HTML de un portal cambia pero el fixture sigue siendo el antiguo
- **THEN** los tests de fixture siguen verdes (prueban el parser contra el fixture), y solo el smoke/red viva reporta el posible cambio de marcado como candidato a actualizar el fixture


### Requirement: Detección de regresión de portales por barrido de términos
El sistema SHALL mantener un registro de términos de prueba por fuente con sus resultados esperados (al menos un término conocido que rinde resultados), y SHALL ofrecer un barrido que ejecute esos términos contra la fuente viva y alerte cuando un término que antes rendía ahora devuelve vacío, señalando el posible cambio de portal o de índice (p.ej. el caso UPME: término en PDF que el REST no indexa). El barrido SHALL reportar por fuente qué términos rindieron, cuáles quedaron vacíos y cuáles fallaron por red.

#### Scenario: Término que antes rendía ahora vacío
- **WHEN** el barrido ejecuta un término conocido de la UPME y devuelve 0
- **THEN** el reporte marca la UPME como posible regresión de portal, distinguiéndola de un fallo de red

#### Scenario: Fuente caída
- **WHEN** una fuente responde con error de red durante el barrido
- **THEN** el reporte la marca como `red`, no como `vacío`, y no la confunde con una regresión de contenido


### Requirement: Sin dependencias nuevas y sin sobre-ingeniería
El sistema SHALL implementar la verificación reutilizando `node:test`, `node:assert`, `spawn` y los scripts existentes (`scripts/probar-tools.ts`, `scripts/medir.ts`, `scripts/barrido-disruptivo.ts`), sin añadir frameworks de CI ni dependencias de runtime.

#### Scenario: Cero dependencias nuevas
- **WHEN** se implementa `verificar`
- **THEN** no se añaden `dependencies` ni `devDependencies` nuevas; se usa lo ya presente en el proyecto
