## Purpose

Consolida el contrato ya implementado de comparación léxica de artículos para que la clasificación editorial quede normada y el límite semántico sea explícito.

## ADDED Requirements

### Requirement: Detección editorial por similitud Dice
El sistema SHALL emparejar líneas eliminadas/añadidas por Dice de bigramas con normalización sin tildes, y SHALL marcar `EDITORIAL` cuando `sim >= 0,92` (umbral `UMBRAL_EDITORIAL`).

#### Scenario: Cambio solo de tildes
- **WHEN** `comparar_articulos` compara dos artículos cuya única diferencia es puntuación/tildes
- **THEN** la línea sale como `EDITORIAL — "…A…" → "…B…" (sim. 1.00, cambio menor)` en vez de `AÑADIDO/ELIMINADO`

#### Scenario: Cambio sustantivo con patrón sanción
- **WHEN** una línea añade `sanción pecuniaria de 5 smmlv`
- **THEN** sale como `AÑADIDO — sancion: "…"` clasificada por `clasificarDiferencia`, no como editorial

#### Scenario: Umbral exacto
- **WHEN** `sim == 0,92`
- **THEN** es editorial (>=); con `0,919` no lo es

### Requirement: Límite léxico declarado
El sistema SHALL documentar en `comparar_articulos.DESCRIPCION` y en el `CIERRE` que el editorial es léxico (Dice, sin modelo) y que la sinonimia real (`multa→sanción pecuniaria`, `salvo→exceptúase`) queda en `no clasificado` para revisión manual.

#### Scenario: Sinonimia no detectada
- **WHEN** A tiene `multa` y B tiene `sanción pecuniaria`
- **THEN** no se emparejan como editorial; se reportan como `ELIMINADO/AÑADIDO — sancion` o `no clasificado` según patrón

### Requirement: Sin dependencias nuevas
El sistema SHALL mantener `similitudLexica`/`esCambioEditorial`/`agruparEditoriales` vendoreadas en `src/herramientas/diff.ts` sin añadir `dependencies`, preservando `bundle ~2,24 MB` y `audit 0`.

#### Scenario: Build
- **WHEN** se corre `npm run build`
- **THEN** `server/index.js` crece `+1–2 KB` frente a `2,24 MB` y `manifest.json` mantiene 24 herramientas (34 − 11 de la consolidación + 1 de `buscar_unificado`)
