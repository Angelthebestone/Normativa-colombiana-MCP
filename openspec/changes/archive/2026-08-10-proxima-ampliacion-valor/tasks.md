## 1. Vigencia decretos — ficha directa SUIN

- [x] 1.1 Extender `src/fuentes/suin.ts` con ruta ficha directa: resolver `id` por `buscar()` Azure filtrado por título cuando `tipo` es decreto y no hay clave en `indice-suin.json`, pedir `viewDocument.asp?id=…`, parsear con `fichaSuin()` y cache en memoria `Map<clave, {estado,url,generado,ts}>` TTL 30 min (reusa ritmo/cola de `http.ts`)
- [x] 1.2 Integrar en `resolver_cita` y `src/herramientas/analizar_conflicto.ts:evidenciaDe()` — antes de devolver "no consta", intentar ficha directa para decretos; distinguir tres mensajes: índice ausente / ficha caída / no consta
- [x] 1.3 Tests `test/suin-vigencia-decretos.ts` y fixtures: HTML SUIN con `estado_documento` → vigencia directa, 404 → no consta, `coberturaIndice()==null` → instalación sin índice, segunda llamada <30 min → sin fetch (cache)

## 2. Sectorial PDF-texto (best-effort, sin nueva tool)

- [x] 2.1 Añadir helper de extracción en capa sectorial (`src/fuentes/sectorial/pdf.ts` o inline en el handler de lectura): `pedirBytes` + `pdfEsEscaneo()` + import dinámico `unpdf` + `trocear`/`fragmentos`/`advertenciasVigencia`/`textoDe`; validar `url` contra `Adaptador.dominioPermitido` antes de descargar
- [x] 2.2 Tests con fixtures binarios: PDF textual (con `FontFile`) → texto troceado, PDF escaneado (DCTDecode sin FontFile) → `avisoSinTexto(escaneo=true)`, dominio no permitido → aviso, `limite_caracteres` y `buscar_en_texto` respetados

## 3. Búsqueda federada `buscar_unificado`

- [x] 3.1 Crear `src/herramientas/buscar_unificado.ts` — schema `texto*`, `perfil?` (laboral|tributario|ambiental|contratacion|energia), `fuentes?` (subset gestor|corte|suin|dian), `limite?` (default 15, max 30); fan-out `Promise.allSettled` a `gestor.tematica/buscar`, `corte.buscar`, `suin.buscar`, `dian.buscar` según perfil/fuentes; ranking trivial (tributario prioriza DIAN); `conAlternativas` por fuente cuando rinde 0; cada item con `fuente`+`url` y vigencia rotulada `SEGÚN EL BUSCADOR` cuando aplica
- [x] 3.2 Registrar `buscar_unificado` en `src/index.ts` vía `registrarHerramienta`, dejar que `scripts/construir.ts` sincronice `manifest.json` (24 herramientas tras la consolidación + 1 = 25), y añadir en `INSTRUCCIONES` la ruta "consulta abierta/por materia sin herramienta obvia → buscar_unificado"
- [x] 3.3 Tests con mocks de fuentes: federado sin perfil, con `perfil=tributario`, con `fuentes=[corte]`, con SUIN en 0 (hueco → sugerencia buscar_por_tema), y con Gestor 503 (degrada sin tumbar el resto)

## 4. Adaptadores SIC y Supersalud

- [x] 4.1 Implementar `src/fuentes/sectorial/sic.ts` y `src/fuentes/sectorial/supersalud.ts` — paginado HTML, `dominioPermitido` https, `tiposDocumento`, `soportaTexto=false`, `soportaVigencia=false`, `pruebasMinimas`, `advertencia` (no cubre leyes/decretos nacionales). La SIC ya existía en el registro; Supersalud se creó explorando su normograma real (Avance Jurídico): el backend `Buscar.ashx` de `normograma.info/prueba-sns/buscador/` se descubrió leyendo `main_sns.js`, igual que Invima
- [x] 4.2 Dar de alta en `src/fuentes/sectorial/registro.ts` y validar contrato en `sectorial.registrar()` (https, tipos no vacío, pruebasMinimas no vacía; alta inválida no contamina `REGISTRO`)
- [x] 4.3 Tests `test/sectorial-sdk.ts` (shape `ActoSectorial`) + smoke fixtures offline por adaptador (paginación, nota de filtros), y canario si no aparecen enlaces esperados

## 5. Comparar artículos — contrato léxico (consolidar lo ya hecho)

- [x] 5.1 Formalizar en `src/herramientas/diff.ts` el contrato vendoreado: `normalizarLexico`/`bigramas`/`similitudLexica` Dice, `UMBRAL_EDITORIAL=0.92`, `esCambioEditorial`, `agruparEditoriales`; y en `comparar_articulos.ts` el `CIERRE` léxico ("Dice ≥0,92, sin modelo; sinonimia queda en no clasificado")
- [x] 5.2 Tests `test/diff.ts` / `test/comparar_articulos.ts`: editorial por tildes → 1.00, `multa→sanción pecuniaria` no es editorial, umbral 0.92 exacto, `formatear` con `EDITORIAL` vs `AÑADIDO/ELIMINADO`

## 7. Consolidación de herramientas (34 → ~24)

- [x] 7.1 Crear `src/herramientas/obtener_documento.ts` — un handler con `fuente` (gestor|corte|suprema|consejo|dian|creg) y extras por fuente: `id`/`buscar_en_texto`/`articulo`/`historial` (gestor), `ruta`/`seccion` (corte), `ruta`+`sala` (suprema), `token` (consejo), `link` (dian), `ruta` (creg); el esquema común (buscar_en_texto/desde/max_pasajes/limite_caracteres) se define una vez; borrar los 6 `obtener_*` de `src/index.ts`
- [x] 7.2 Colapsar `expediente_crear`/`expediente_agregar`/`expediente_leer` en `expediente(accion: crear|agregar|leer)` reutilizando `src/herramientas/expedientes.ts` + `src/nucleo/expediente.ts`
- [x] 7.3 Añadir flag `validar: boolean` a `resolver_cita` que devuelva la salida ✓/✗ de `validar_cita` (reusando `src/herramientas/validar_cita.ts`); borrar `validar_cita`
- [x] 7.4 Ampliar `listar_catalogos`: `catalogo="subtemas"` (con `tema_id`), `catalogo="conceptos_fp"` (número/año), `catalogo="normas_fp"`; borrar `listar_subtemas`/`buscar_conceptos_fp`/`listar_normas_fp`
- [x] 7.5 Reescribir `INSTRUCCIONES` en `src/index.ts` con el mapeo viejo→nuevo y avisar con `avisoVersion()` del cambio de nombres
- [x] 7.6 Tests de enrutado y regresión: `obtener_documento` con cada fuente, `expediente(accion)` completo, `resolver_cita(validar:true)`, catálogos ampliados, y que `describir_fuentes` siga declarando las fuentes
- [x] 7.7 `npm run check` + `npm run build && npm run medir` — la consolidación resta tools y peso (neta −10 tools; compensa el +2–10 KB de las demás piezas), `manifest.json` auto-sync 34→~24

## 8. Red de pruebas de regresión (10+ casos por tool)

- [x] 8.1 Reutilizar el `Cliente` MCP de `test/e2e.ts` (spawn del servidor + JSON-RPC crudo) en un helper compartido `test/red.ts`; sin duplicar el cliente ni añadir dependencias
- [x] 8.2 Escribir suites por dominio (gestor, tribunales, sectorial, V2, meta) cada una con **≥10 casos** por herramienta, leyendo siempre `content[0].text` crudo e `isError`
- [x] 8.3 Incluir casos adversariales: argumentos numéricos vs texto, límites fuera de rango (ajuste, no crash), ids cruzados de taxonomías (rechazo), vacíos como texto (no `isError`), fecha+descargo en toda respuesta, troceo de documentos grandes (`limite_caracteres`/`max_pasajes` respetados)
- [x] 8.4 Migrar los casos a los nombres finales de la consolidación (`obtener_documento(fuente,…)`, `expediente(accion)`, `resolver_cita(validar)`, catálogos ampliados) y verificar `tools/list` ~24 + `buscar_unificado` = 25
- [x] 8.5 Ejecutar las suites como subprocesos por dominio (patrón `node:test` + `spawn`); si una suite es larga, repartirla en subagentes que reutilicen el helper
- [x] 8.6 `npm run check` + `npm run build` verde, sin `dependencies` nuevas, sin código muerto ni pruebas huérfanas

## 9. Integración, build y verificación

- [x] 9.1 Correr `npm run typecheck && npm run lint && npm test` y `npm run build && node scripts/medir.ts` — verificar delta `server/index.js` +6–10 KB (si `unpdf` queda lazy, +2–6 KB), `.mcpb` ~1,46 MB, `npm audit` 0 vulns (cero `dependencies` nuevas)
- [x] 9.2 Spike previo (30 min): validar contra 3 decretos reales si la ficha directa rinde mejor por `buscar()` filtrado o por `viewDocument.asp` directo, y dejar anotado el hallazgo en `design.md` Open Questions
