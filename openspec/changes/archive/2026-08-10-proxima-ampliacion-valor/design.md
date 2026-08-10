## Context

Ver `proposal.md` para el porqué. El MCP ya está en `v1.10.0` con 34 herramientas, a consolidar en 24, `bundle 2,24 MB / .mcpb 1,46 MB`, `zero dependencies` (solo `devDependencies` + `esbuild`), ritmo `1/s` por dominio con cola serial por host en `src/nucleo/http.ts`, y parsers resistentes pero atados al HTML vivo (`parse.ts`, `gestor.ts`). Los límites que motivan este cambio son estructurales: el índice SUIN es casi solo leyes (sitemaps de decretos 404), el texto sectorial vive en PDF (`soportaTexto=false` en 13/14 sectoriales), y el enrutador real son las `INSTRUCCIONES` de 60 líneas en `src/index.ts`. A eso se suma que 34 tools es superficie cara: seis obtenedores comparten esquema y cuerpo de handler (buscar_en_texto/desde/max_pasajes/limite_caracteres + fragmentos/trocear/advertenciasVigencia), y un feature desactivado por defecto (expedientes) ocupa tres entradas.

## Goals / Non-Goals

**Goals:**
- Traer vigencia para decretos sin reindexar SUIN (3 h) y sin inventar estados.
- Hacer legible el ~40% de PDFs sectoriales que son texto, manteniendo el aviso de escaneo para el resto.
- Ofrecer un `buscar_unificado` federado que reduzca la tasa de "herramienta equivocada".
- Añadir SIC y Supersalud vía adaptador sin nueva tool.
- Dejar normado lo ya hecho en `comparar_articulos` (Dice editorial) y el hueco para semántica lazy fuera de esta change.
- Reducir la superficie de tools de 34 a ~24 consolidando obtenedores, expedientes, validación y catálogos, sin perder capacidad ni contratos de búsqueda.

**Non-Goals:**
- Reindexar SUIN completo, OCR para escaneos, embeddings en bundle, ni bitácora de novedades automática (fuera de alcance declarado).
- Nuevo sistema de búsqueda propio ni reranking LLM: el federado es fan-out + `conAlternativas`.
- Unificar los buscadores (`buscar_jurisprudencia*` siguen separados por tribunal: esquemas distintos y anti-confusión deliberada).

## Decisions

**1. Vigencia decretos = ficha directa + fallback, no índice nuevo.**
`src/fuentes/suin.ts::vigencia()` intenta primero el índice empaquetado (leyes); si la clave `tipo|numero|anio` no existe y `tipo` es decreto, resuelve `id` vía `buscar()` Azure filtrado `titulo eq` y luego `viewDocument.asp?id=…` → `fichaSuin()`. Se cachea en memoria con `Map` + `ultimo` y TTL 30 min (reutiliza `cubos`/`colas` de `http.ts` para ritmo).
*Alternativa descartada:* regenerar `datos/indice-suin.json` para decretos — los sitemaps de decretos devuelven 404, así que el crawl no los trae; y reindexar 56k docs por Azure es 3 h y desborda el paquete.
*Razón:* mínimo delta, máximo cierre del hueco "todo decreto = no consta".

**2. PDF-texto sectorial = `unpdf` ya instalado, gated por `pdfEsEscaneo`.**
`pedirBytes(url)` → `pdfEsEscaneo()` → si falso, `unpdf` extrae y `textoDe`/`fragmentos`/`trocear` reutilizan límites; si verdadero, `avisoSinTexto(escaneo=true)`. Validación de dominio contra `Adaptador.dominioPermitido` antes de descargar.
*Alternativa descartada:* nuevo `obtener_documento_sectorial` con `dependencies` extra — sería otra tool que duplica `obtener_documento_dian`/`obtener_resolucion_creg`; el sectorial ya tiene el patrón de descarga.
*Razón:* desbloquea lectura sin romper el contrato sectorial ni añadir peso ( `unpdf` ya está en `devDependencies` y se bundela solo si se importa).

**3. Federado = orquestador en `src/herramientas/buscar_unificado.ts`.**
`Promise.allSettled` sobre `gestor.tematica/buscar`, `corte.buscar`, `suin.buscar`, `dian.buscar` según `fuentes`/`perfil`. Ranking trivial: DIAN primero si `perfil=tributario`, si no Gestor→Corte→SUIN, y `conAlternativas` por fuente cuando rinde 0.
*Alternativa descartada:* router LLM o query-planning — viola `GOAL.md` (no inventar certeza) y la regla "ninguna prueba verifica el enrutado".
*Razón:* 60 líneas de INSTRUCCIONES no sonRouter; un fan-out explícito sí es testeable.

**4. SIC y Supersalud como adaptadores, no como tools.**
Siguen `src/fuentes/sectorial/*.ts` + alta en `sectorial/registro.ts`. Requieren `dominioPermitido https`, `tiposDocumento`, `soportaVigencia`, `pruebasMinimas`, `advertencia`. Paginado HTML con `__VIEWSTATE`-less (validado en otros adaptadores).

**5. Léxica vendoreada en `src/herramientas/diff.ts` (ya hecho) fuera de dependencias.**
`normalizarLexico + bigramas + Dice + UMBRAL_EDITORIAL=0,92 + agruparEditoriales`. Cero `dependencies`, `+1 KB` bundle.
*Semántica lazy* (`@huggingface/transformers` + `paraphrase-multilingual-MiniLM` quantized ~120 MB) queda documentada en `IDEAS_V2_ADICIONALES.md` y fuera de esta change para no multiplicar `.mcpb` por 83×.

**6. Consolidación de herramientas: 34 → ~24, una sola tool por operación.**
- **Obtenedores → `obtener_documento(fuente, …)`.** Seis handlers (gestor, corte, suprema, consejo, dian, creg) comparten el MISMO esquema (buscar_en_texto/desde/max_pasajes/limite_caracteres) y el mismo cuerpo (fragmentos + trocear + advertenciasVigencia + avisoSinTexto). Se colapsan en una tool con `fuente` como discriminador y los extras que cada fuente exige: `seccion` (corte), `historial` (gestor), `sala` (suprema), `token` (consejo, caduca en 1 h), `link` (dian), `ruta` (creg). El modelo ya sabe qué fuente usar porque la búsqueda que devolvió el id lo dice en su texto.
*Alternativa descartada:* `obtener_documento_sectorial` como tool nueva (duplicaría el patrón) y liteparse/opendataloader como motor de extracción (liteparse orquesta OCR+layout en Python; opendataloader-pdf envuelve un CLI de Java: ambos rompen `Node puro / zero-deps / 2,24 MB`). `unpdf` ya está en `devDependencies` y es bundable con esbuild.
*Razón:* −5 tools y ~200 líneas duplicadas; el enrutado mejora porque hay un solo contrato de lectura con `fuente`.
- **Expedientes → `expediente(accion: crear|agregar|leer)`.** Mismo dominio, misma entidad, uso secuencial obligado y feature desactivado por defecto (`EXPEDIENTES=1`): tres entradas de contexto para una capacidad ausente en casi todas las instalaciones. −2 tools.
- **Validación → `resolver_cita(validar: true)`.** `validar_cita` ya hace lo que `resolver_cita`: parsea, consulta el Gestor, comprueba número/año, verifica dominio y detecta ambigüedad. La única diferencia es la salida (lista ✓/✗). Un flag devuelve esa salida. −1 tool.
- **Catálogos → `listar_catalogos` ampliado.** `listar_subtemas` pasa a `catalogo="subtemas"` (con `tema_id` como filtro); `buscar_conceptos_fp` a `catalogo="conceptos_fp"` (número/año); `listar_normas_fp` a `catalogo="normas_fp"`. El prefijo de ids (`sub-`, `tema-`) ya resuelve la colisión de taxonomías del portal. −3 tools.
*Alternativa descartada:* unificar los buscadores (`buscar_jurisprudencia*`): sus esquemas (sala, pagina, tipos) son genuinamente distintos y las descripciones ya insisten en que el modelo confunde los tres tribunales; separarlos es anti-confusión deliberada.
*Razón:* menos superficie = menos contexto y menos enrutado equivocado; `describir_fuentes` se queda como el corrector de falsos negativos. Conteo final: 34 − 11 consolidados + 1 federado = 24 herramientas.

**7. Red de pruebas de regresión (10+ casos por tool) sobre el servidor real.**
Ya existe `test/e2e.ts`: un `Cliente` que hace `spawn` del servidor compilado y le habla por stdio con JSON-RPC crudo, leyendo `content[0].text` e `isError`. La red lo reutiliza como helper (`test/red.ts`) y añade suites por dominio (gestor, tribunales, sectorial, V2, meta), cada una con **≥10 casos** por herramienta, incluyendo adversariales (numéricos vs texto, límites fuera de rango, ids cruzados, vacíos como texto, troceo). Si la suite crece, se reparte en **subprocesos/subagentes** por dominio que reutilizan el helper. Todo con `node:test`/`node:assert`/`spawn` ya presentes: cero dependencias nuevas, soluciones mínimas, sin código muerto.
*Alternativa descartada:* un framework de test (Vitest/Jest) o fixtures HTML pesados — violan zero-deps y el patrón `node --test` ya establecido; la red lee respuestas crudas reales, no mocks.
*Razón:* la consolidación es BREAKING en nombres; una red que ejerce cada tool final con ≥10 casos caza regresiones antes de publicar.

## Risks / Trade-offs

- **SUIN ficha directa 404/caída → confusión vigencia.** Mitigación: mensaje tripartito (índice ausente / ficha caída / no consta) ya usado para leyes; nunca se traduce "Vigencia en Estudio" a booleano.
- **PDF sectorial grande/timeout.** Mitigación: `pedirBytes` con `90s`, `limite_caracteres 40k`, `trocear`; 429/503 con backoff ya en `http.ts`.
- **Renombres rompen clientes.** Mitigación: `avisoVersion()` y descripciones con mapeo viejo→nuevo (`obtener_norma → obtener_documento con fuente="gestor"`); `manifest.json` sincronizado refleja el cambio. La consolidación neta −11 tools compensa el +6–10 KB de las demás piezas.
- **La red contra la red viva es lenta/flaky.** Mitigación: `LENTO`/`CONTRATO` con timeout y `SIN_RED=1` para offline ya en `e2e.ts`; suites por dominio en subprocesos con reintento; los casos adversariales no dependen de la red.
- **Federado ruidoso (SUIN Azure devuelve mucho OR).** Mitigación: `limite` por fuente bajo (15) y aviso "buscador une con OR, no mide pertinencia" ya usado en Corte Suprema/SUIN.
- **Adaptadores SIC/Supersalud cambian HTML.** Mitigación: `CanarioError` si no aparecen enlaces esperados, como en `parseResultados`.
- **Peso:** federado + 2 adaptadores + pdf-texto lazy = `+6–10 KB` bundle si se importa `unpdf`; si queda lazy, `+2–6 KB`. `.mcpb` sigue ~1,46 MB. Sin riesgo de `audit vulns`.

## Migration Plan

1. `suin.ts` vigencia decretos (ficha directa + cache + tests con fixture HTML SUIN + test de TTL).
2. `buscar_unificado.ts` + registro en `index.ts` + `INSTRUCCIONES` (añadir ruta "consulta abierta → buscar_unificado").
3. `sic.ts` / `supersalud.ts` + `registro.ts` + `test/sectorial-sdk.ts` + smoke fixtures.
4. `sectorial/pdf-texto` gated (import dinámico `unpdf` si se quiere lazy) + `parse.ts` reutilizado + tests `pdfEsEscaneo`.
5. **Consolidación:** `obtener_documento.ts` (un handler, 6 fuentes), `expediente(accion)`, flag `validar` en `resolver_cita`, `listar_catalogos` ampliado; borrado de los viejos en `index.ts` + `INSTRUCCIONES` reescritas con mapeo viejo→nuevo + `avisoVersion()`.
6. **Red de regresión:** helper `test/red.ts` (reutiliza el `Cliente` de `e2e.ts`), suites por dominio con ≥10 casos por tool, adversariales y subprocesos por dominio; verde antes y después de la consolidación.
7. `npm run check` (typecheck+lint+test) + `npm run build && npm run medir` (peso delta: consolidación −tools, resto +2–10 KB), `manifest.json` auto-sync vía `scripts/construir.ts` (34→~24 tools).
Rollback: cada pieza es behind-flag o degradación a "no consta"/epígrafe; revertir el commit de la pieza sin tocar las demás. La consolidación es el único paso BREAKING: se revierte como una pieza más.

## Open Questions

- ¿El id de la ficha directa de decreto viene mejor por `buscar()` Azure filtrado por `titulo eq "Decreto N de A"` o por construcción `viewDocument.asp?id=` directo si SUIN expone ids secuenciales? Spike de 30 min contra 3 decretos reales decide; el contrato no cambia.
- ¿Debe `buscar_unificado` exponer `limite_por_fuente` además de `limite` global? Se deja para post-uso real; hoy basta con `limite` global.
