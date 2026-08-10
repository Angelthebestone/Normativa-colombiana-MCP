## Why

El MCP ya puntúa A en Tool Definition Quality (media 4.3/5) y Server Coherence (A), pero Glama le descuenta el 25 % restante del perfil: no tiene `glama.json`, no declara servidores relacionados, y la puntuación de varias herramientas se hunde por descripciones y parámetros poco claros (el mínimo de 2.6 de `expediente_agregar` pesa el 40 % de la nota global). Los portales del Estado pueden estar caídos estos días, así que el objetivo ahora es consolidar en el repositorio —y en el documento `CALIDAD_HERRAMIENTAS_GLAMA.md`— todo lo necesario para alcanzar el 100 % de perfil en Glama: metadatos, coherencia, descripciones de herramientas y documentación de respaldo.

## What Changes

- **Añadir `glama.json`** con los metadatos del servidor: nombre, descripción, autor, repositorio, categorías y **servidores relacionados** (los que Glama pide para el checklist). Sin dependencias nuevas; el fichero es estático y se empaqueta en el `.mcpb`.
- **Reescribir las descripciones de las herramientas peor puntuadas** en `src/index.ts` (y sus `describe()` de parámetros), siguiendo el diagnóstico de `CALIDAD_HERRAMIENTAS_GLAMA.md`: `expediente_agregar` (2.6, arrastra el mínimo), `expediente_leer` (3.2), `buscar_normativa_anh` (3.7), `buscar_resoluciones_creg` (3.7), `buscar_jurisprudencia` (3.9), `consultar_perfil` (4.0), `consultar_por_jerarquia` (4.0), y las de Params 2-3 (`expediente_agregar`, `expediente_leer`, `consultar_perfil`, `buscar_conceptos_fp`).
- **Completar el checklist de perfil de Glama**: `glama.json` con `related_servers`, descripción coherente de servidor, y actualizar `CALIDAD_HERRAMIENTAS_GLAMA.md` para que sea la referencia única del estado de calidad (incluye el plan para "Try in Browser" y sembrado de uso, sin tocar los portales).
- **Sin cambios de contrato**: no se renombran ni consolidan herramientas (se mantienen las 25+); el alcance es no destructivo.

## Capabilities

### New Capabilities
- `perfil/glama-100`: el servidor pasa a declarar metadatos de perfil Glama (glama.json + servidores relacionados) y a documentar su checklist de calidad, sin romper el contrato de herramientas existentes.

### Modified Capabilities
- `herramientas/definiciones`: se reescriben las descripciones y `describe()` de parámetros de las herramientas señaladas por Glama, para subir Purpose Clarity, Behavioral Transparency, Parameter Semantics y Usage Guidelines sin cambiar sus contratos de entrada ni salida.

## Impact

- **Código:** `src/index.ts` (descripciones y `describe()` de parámetros de ~8 herramientas), nuevo `glama.json` en la raíz, `scripts/construir.ts` para que el fichero viaje en el bundle si aplica, y `CALIDAD_HERRAMIENTAS_GLAMA.md` actualizado como referencia de trazabilidad.
- **Bundle:** +0–1 KB (solo texto estático; `glama.json` es un fichero aparte). Se mantiene `zero-deps` y `audit 0 vulns`.
- **Compatibilidad:** ninguna herramienta cambia de nombre, parámetros, tipos ni respuestas; solo cambia el texto que el agente lee para elegir. Los clients MCP existentes siguen funcionando.
- **Riesgos:** Glama recalcula la nota al siguiente escaneo; si los portales están caídos no afecta a esto (no se consulta red para el perfil, excepto el sembrado de uso que queda documentado como paso manual opcional).
