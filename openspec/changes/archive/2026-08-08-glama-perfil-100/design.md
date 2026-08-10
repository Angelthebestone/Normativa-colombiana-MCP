## Context

See proposal.md — Why. El servidor es un único bundle esbuild (`server/index.js`, 2,24 MB, cero `dependencies`) con 25 herramientas definidas en `src/index.ts` y 4 prompts. Glama puntúa la *descripción* (Tool Definition Quality, 70 % de la nota) y la coherencia (30 %). El documento `CALIDAD_HERRAMIENTAS_GLAMA.md` ya recoge el diagnóstico de las 34 herramientas con su puntuación por dimensión. Los portales del Estado pueden estar caídos, así que este cambio no consulta red: todo es texto estático en el repo.

## Goals / Non-Goals

**Goals:**
- Que `glama.json` (con `related_servers`) exista, se empaquete en el `.mcpb` y complete el checklist de perfil.
- Subir la nota de las herramientas peor puntuadas reescribiendo solo `description` y `describe()` en `src/index.ts`.
- Dejar `CALIDAD_HERRAMIENTAS_GLAMA.md` como la referencia única del estado Glama, con los pasos manuales restantes explícitos.

**Non-Goals:**
- NO consolidar, renombrar ni eliminar herramientas (se mantienen las 25+; Tool Count 2/5 queda como está, decidido con el usuario).
- NO tocar el contrato (nombres, parámetros, tipos, respuestas) de ninguna herramienta.
- NO sembrar uso real en Glama ("Try in Browser") ni consultar portales; solo se documenta como paso manual pendiente.

## Decisions

- **`glama.json` como fichero estático en la raíz, no generado.** Formato sencillo y conocido por Glama (nombre, descripción, autor, repositorio, categorías, `related_servers`). Se incluye en `package.json` `files` y en el `.mcpb` (vía `scripts/construir.ts` si el pack no lo copia solo). *Alternativa descartada:* generarlo en el build — añade lógica sin beneficio, el fichero es declarativo.
- **Reescritura dirigida por el mínimo, no por media.** La fórmula de Glama es 60 % media + 40 % mínimo: la prioridad son las herramientas con nota <4.0 y las de Params ≤3, no las que ya están en 4.8. Orden de trabajo: `expediente_agregar` (2.6), `expediente_leer` (3.2), `buscar_normativa_anh` (3.7), `buscar_resoluciones_creg` (3.7), `buscar_jurisprudencia` (3.9), `consultar_perfil` (4.0), `consultar_por_jerarquia` (4.0), y rellenar `describe()` de `limite`/`max_pasajes` donde Glama lo señale. *Alternativa descartada:* reescribir las 34 — riesgo de degradar las que ya puntúan bien y más tokens de revisión.
- **Preservar el estilo de las descripciones actuales.** El repo ya usa frases front-loaded, advertencias en MAYÚSCULAS y referencias cruzadas entre herramientas (el patrón que Glama puntúa 5/5 en `buscar_en_suin` o `describir_fuentes`). Las reescritas siguen ese mismo patrón, no un estilo nuevo.
- **La documentación se actualiza como parte del cambio, no después.** `CALIDAD_HERRAMIENTAS_GLAMA.md` es el documento de trazabilidad que declara el estado del checklist; se edita junto con el código para que el repo y la ficha no se desincronicen.

## Risks / Trade-offs

- [Glama recalculca al siguiente escaneo y puede tardar] → La mejora es textual y permanente en el repo; se documenta que la nota visible se actualiza tras el próximo escaneo.
- [Reescritura que sin querer degrade una dimensión ya buena (p. ej. Conciseness 5 → texto más largo)] → Se reescribe con la ficha por dimensión delante y se mantiene el patrón front-loaded; el texto nuevo no supera la densidad del actual.
- [`glama.json` con `related_servers` que Glama no reconozca si el formato cambia] → Se sigue el formato documentado de Glama; si el escaneo no lo ve, el checklist lo refleja como pendiente en `CALIDAD_HERRAMIENTAS_GLAMA.md` y se ajusta el fichero sin tocar código.
- [Las pruebas de humo/e2e no validan texto de descripciones] → Se añade una verificación de esquemas idénticos (nombres/tipos/defaults) en el smoke para garantizar el no-cambio de contrato.
