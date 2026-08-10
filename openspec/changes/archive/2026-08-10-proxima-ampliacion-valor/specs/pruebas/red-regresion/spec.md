## Purpose

Red de pruebas de regresión que arranca el servidor compilado, le habla por stdio con JSON-RPC crudo (como Claude Desktop) y ejerce cada herramienta con al menos 10 casos para cazar roturas de las nuevas versiones antes de publicar.

## ADDED Requirements

### Requirement: Red de pruebas por herramienta sobre el servidor real
El sistema SHALL proveer una suite de regresión que arranque `server/index.js` compilado, hable por stdio con JSON-RPC (métodos `tools/list`, `tools/call`, `prompts/list`) y ejerza **cada herramienta publicada** con al menos 10 casos distintos, leyendo la respuesta cruda (`content[0].text` y `isError`).

#### Scenario: Ejercicio de cada herramienta
- **WHEN** se ejecuta la red de regresión
- **THEN** para cada herramienta del `tools/list` hay al menos 10 casos que la llaman con argumentos crudos y verifican el texto crudo devuelto

#### Scenario: Cobertura por tool tras la consolidación
- **WHEN** la consolidación de herramientas (34→24) renombra `obtener_norma`→`obtener_documento`, expedientes→`expediente(accion)`, `validar_cita`→flag, y catálogos ampliados
- **THEN** la red ejerce cada una de las ~24 herramientas finales con sus nombres y esquemas nuevos, y las 10+ pruebas por tool migran al nuevo contrato

### Requirement: Pruebas que rompan las nuevas versiones
El sistema SHALL incluir casos adversariales que detecten regresiones típicas de refactor: argumentos numéricos vs texto, límites fuera de rango, ids cruzados de taxonomías, vacíos que deben ser texto (no `isError`), respuestas sin fecha/descargo, y troceo de documentos grandes.

#### Scenario: Argumentos numéricos aceptados
- **WHEN** una tool espera `id`/`numero`/`anio` y se le envían números crudos (no strings)
- **THEN** la tool responde sin `-32602` ni `isError`

#### Scenario: Límite fuera de rango se ajusta
- **WHEN** `limite_caracteres` se envía en 400 (fuera de 200–40.000)
- **THEN** la respuesta lo ajusta al rango y no revienta con un error de validación crudo

#### Scenario: Vacío es texto, no fallo
- **WHEN** una búsqueda no encuentra resultados
- **THEN** `isError` es falso y el texto explica el vacío, sin concluir que la norma no existe

### Requirement: Análisis de outputs crudos
El sistema SHALL permitir inspeccionar y verificar los outputs crudos de cada herramienta: `content[0].text` íntegro, `isError`, y metadatos, sin formateo intermedio.

#### Scenario: Lectura del texto crudo
- **WHEN** la red invoca una tool
- **THEN** lee `content[0].text` tal cual y verifica sobre él (fecha, descargo, rótulos, avisos), igual que hace hoy `test/e2e.ts`

### Requirement: Subagentes para suites largas
El sistema SHALL permitir dividir la red en suites por herramienta o dominio y ejecutarlas como **subagentes/subprocesos** independientes (patrón `node:test` + `spawn` ya usado en `test/e2e.ts`) cuando la implementación sea larga, sin duplicar el cliente MCP.

#### Scenario: Suites por dominio
- **WHEN** la red crece
- **THEN** se reparte en subprocesos por dominio (gestor, tribunales, sectorial, V2) y cada uno reutiliza el mismo cliente MCP, sin duplicación

### Requirement: Sin sobre-ingeniería y sin código muerto
El sistema SHALL implementar la red con soluciones mínimas: reutilizar el cliente y helpers existentes, no añadir frameworks ni dependencias, y no dejar pruebas huérfanas ni código muerto.

#### Scenario: Cero dependencias nuevas
- **WHEN** se implementa la red
- **THEN** no se añaden `dependencies` ni `devDependencies` nuevas; se usa `node:test`, `node:assert` y `spawn` ya presentes

### Requirement: Compatibilidad con la consolidación
El sistema SHALL mantener la red verde durante y después de la consolidación de herramientas: los casos que referencian tools renombradas se actualizan, y el conteo de tools en `tools/list` refleja el final (~24 + 1 federado).

#### Scenario: Conteo y nombres tras consolidar
- **WHEN** se corre la red tras la consolidación
- **THEN** `tools/list` declara ~24 herramientas con los nombres nuevos, y cada tool tiene sus 10+ casos
