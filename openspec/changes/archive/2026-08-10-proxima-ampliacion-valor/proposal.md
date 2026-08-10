## Why

El MCP ya cubre el 80% de lo que alguien pide en una conversación jurídica real (leyes/decretos del Gestor, las 3 altas cortes, DIAN y SUIN para vigencia de leyes), pero deja tres huecos caros que los propios portales sí pueden cerrar: (1) la vigencia de **decretos** no consta porque el índice SUIN empaquetado son casi solo leyes —el `resolver_cita` dice “no consta” para todo decreto—, (2) 13 de 14 fuentes sectoriales devuelven solo epígrafe porque el texto vive en PDF y hoy no se extrae aunque sea texto, y (3) el enrutado “elige tú la herramienta” (INSTRUCCIONES de 60 líneas) es la única cosa que ninguna prueba verifica y donde más falla Claude. Los tres se resuelven sin inventar datos y sin romper `zero-deps / 2,24 MB bundle`.

## What Changes

- **Reducción de superficie de herramientas (34 → 24):** hoy el MCP expone 34 tools y el coste es doble: contexto (cada tool ocupa espacio en el sistema) y enrutado (6 obtenedores con esquema idéntico repetidos, 3 expedientes de un feature apagado, `validar_cita` = `resolver_cita` con otra salida). Se consolidan en 5 movimientos: (1) `obtener_norma` + `obtener_sentencia` + `obtener_providencia_suprema` + `obtener_providencia_consejo_estado` + `obtener_documento_dian` + `obtener_resolucion_creg` → **`obtener_documento(fuente, …)`**; (2) `expediente_crear` + `expediente_agregar` + `expediente_leer` → **`expediente(accion)`**; (3) `validar_cita` → **flag `validar` en `resolver_cita`**; (4) `listar_subtemas` + `buscar_conceptos_fp` + `listar_normas_fp` → **catálogos de `listar_catalogos`**; (5) `describir_fuentes` se queda (corrige falsos negativos). Los buscadores NO se unifican: son motores con esquemas distintos y el design los mantiene separados a propósito anti-confusión de tribunales.
- **Vigencia para decretos bajo demanda (sin índice):** `resolver_cita` y `analizar_conflicto` intentan SUIN ficha directa (`viewDocument.asp` / Azure Search) cuando la norma es decreto y no está en el índice empaquetado. Si la ficha responde, devuelve `Estado de vigencia según SUIN (ficha directa DD/MM)` con URL; si no, mantiene el “no consta” actual. No se reindexa SUIN (3 h), no se inventa vigencia.
- **Texto sectorial cuando el PDF es texto:** `buscar_normativa_sectorial` + `obtener_documento_sectorial` (reusando `unpdf` ya en `devDependencies` + `pdfEsEscaneo` de `parse.ts`) intentan extraer el PDF si es texto; si es escaneo, devuelven el aviso existente. Desbloquea ~40% de PDFs sectoriales hoy mudos.
- **Buscador federado `buscar_unificado`:** una sola herramienta que hace fan-out a Gestor + Corte Constitucional + SUIN + DIAN según la consulta y perfila el resultado por `perfil` (`tributario`, `laboral`…). Usa `conAlternativas` y los adaptadores existentes; no añade scrapers.
- **Dos adaptadores sectoriales de alta demanda con buscador limpio:** SIC (protección al consumidor / datos personales) y Supersalud, ambos con buscador HTML paginado ya validado en `sectorial/registro.ts` con `__VIEWSTATE`-less. Se registran vía `Adaptador` SDK, con canario y `pruebasMinimas`.
- **Comparar artículos: cierre léxico ya entregado + flag semántico futuro:** `src/herramientas/diff.ts` ya trae Dice ≥0,92 → `EDITORIAL`. Se deja el hueco para `SEMANTICO=1` lazy (`@huggingface/transformers` + `paraphrase-multilingual-MiniLM` quantized) documentado pero **fuera de este cambio** para no cruzar `+120 MB` en el `.mcpb`.

## Capabilities

### New Capabilities
- `vigencia/vigencia-decretos`: vigencia SUIN para decretos por ficha directa, con cache en memoria y distinción de errores (índice ausente vs ficha caída vs no consta).
- `sectorial/pdf-texto`: extracción de texto de PDFs sectoriales textuales, con detección de escaneo y límites `trocear`/`fragmentos` reutilizados.
- `busqueda/busqueda-federada`: herramienta `buscar_unificado` que agrega resultados de fuentes ya existentes con ranking simple y atribución por fuente.
- `sectorial/sic-supersalud`: adaptadores SIC y Supersalud como nuevas entidades de `buscar_normativa_sectorial`.

### Modified Capabilities
- `comparar-articulos`: ya modificado en esta rama (Dice editorial). Se documenta el contrato léxico y se deja explícito que `multa→sanción pecuniaria` no es editorial (requiere semántica).
- `herramientas`: los 6 obtenedores pasan a `obtener_documento(fuente, …)`; los 3 expedientes a `expediente(accion)`; `validar_cita` a flag `validar` de `resolver_cita`; y `listar_subtemas`/`buscar_conceptos_fp`/`listar_normas_fp` a catálogos de `listar_catalogos`. Los contratos de búsqueda no cambian.

## Impact

- **Código:** `src/fuentes/suin.ts` (nueva ruta ficha directa), `src/fuentes/sectorial/*` (2 adaptadores), `src/nucleo/parse.ts`/`src/nucleo/http.ts` reutilizados, `src/herramientas/buscar_unificado.ts` nuevo, `src/herramientas/diff.ts` ya tocado. `src/index.ts` suma 1 herramienta (`buscar_unificado`) + 2 entidades; `manifest.json` se sincroniza solo vía `scripts/construir.ts`.
- **Bundle:** `+2–6 KB` (vigencia decretos + federado + pdf-texto es `unpdf` ya bundelado si se activa; si queda lazy, `+0 KB`), cada adaptador `+~3 KB`. `.mcpb` sigue en ~1,46 MB; `audit 0 vulns` se preserva (cero `dependencies` nuevas).
- **Compatibilidad:** la consolidación es BREAKING en nombres (los viejos `obtener_*`, `expediente_*`, `validar_cita`, `listar_subtemas` desaparecen); se mitiga con descripciones que mapean viejo→nuevo y `avisoVersion`. Ninguna herramienta de búsqueda cambia de contrato; `resolver_cita` solo añade la línea de vigencia cuando consta, que ya existe para leyes.
- **Riesgos:** SUIN ficha directa puede caer (se degrada a “no consta” con aviso, nunca a “vigente”); PDFs sectoriales escaneados siguen mudos a propósito.
