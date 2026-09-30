## Context

Motivación y lista de hallazgos: ver `proposal.md`. Los specs de este cambio fijan el comportamiento; aquí va el «cómo», siempre la corrección más pequeña en el sitio donde nace el defecto.

Cada hallazgo se verificó contra el código de la 1.15.0 (`origin/main`, commit 38db743, que ya contiene la rama `optimizacion`), no contra el 1.14.0 con que se probó. Uno se descarta por estar ya corregido: `entero`/`ruta_destino` (`obtener_documento.ts:83-96` añade el objeto `archivo` a la unión), que la tercera serie confirmó contra la 1.15.0 publicada.

La tercera serie (las 28 tools contra la 1.15.0 publicada, `v1.15.0` = 2434e9a, cuyo árbol contiene 875fbde) **reabrió el otro descarte**: el «undefined» de `explicar_relacion_tema` se había dado por corregido leyendo `estricto()` (`normalizar.ts:72-79`), pero esa rama solo se activa con `issue.validation === 'regex'`; el campo `temsubid` no tiene regex y por eso el mensaje sigue saliendo. Se corrige en D11. La lección es la de siempre: un descarte se comprueba ejecutándolo, no leyendo el arreglo.

Convenciones del repo que rigen todas las decisiones (CLAUDE.md): borrar el camino viejo en vez de envolverlo, reutilizar lo instalado (`pedir`, `cargar`, `trocear`, `articulo()`), un módulo por responsabilidad, y marcar con `ponytail:` los atajos deliberados con su techo y su salto siguiente. Los tests se registran a mano en el script `test` de `package.json` (un fichero no registrado no corre; ya pasó con 12).

## Goals / Non-Goals

**Goals:**
- Que cada respuesta que hoy se lee como «no existe», «no fue reformado» o «error del portal» sin serlo, diga la verdad.
- Cambios de pocas líneas por hallazgo, con un test que falle antes y pase después.

**Non-Goals:**
- Sin parámetros nuevos ni campos nuevos en el JSON público (`Cambio` conserva sus cinco campos).
- Sin subir versión ni publicar.
- No se reabre lo descartado en `proposal.md` (Impact → Fuera de alcance).

## Decisions

**D1. `historial_norma` filtra por el texto del artículo, como ya hace `obtener_documento`.**
`Cambio.articulo` es, por diseño, el artículo de la norma *modificadora* (`parse.ts:452`); `acotar()` lo comparaba contra el número pedido. `obtener_documento historial=true articulo=N` (`obtener_documento.ts:449-455`) y `comparar_articulos` ya hacen lo correcto: `articulo(texto, N)` y `historial()` sobre ese trozo. Se hace lo mismo en `escribir()` de `historial_norma.ts`: `ambito = articulo ? extraerArticulo(n.texto, articulo) : n.texto`; si el artículo no existe, mensaje con `indiceArticulos()` (idéntico al de `obtener_documento`). Se borra el filtro por `c.articulo` de `acotar()`; el parámetro `articulo` queda solo para la redacción («sobre el artículo N»).
*Alternativa descartada:* añadir un campo `afecta` (artículo de esta norma) calculado por posición. Cambia el contrato JSON y duplica lo que `articulo()` ya resuelve.

**D2. La prosa modificatoria no es nota.** En `historial()` (`parse.ts`), la forma pasiva descarta las coincidencias cuyo texto contiene «quedará así» / «queda así». Es la frase con que una ley transcribe un artículo ya modificado; ninguna nota del portal la lleva. `// ponytail: heurística por frase; el techo es otra redacción de la misma prosa; el salto sería aceptar la pasiva solo entre paréntesis, a costa de perder notas del portal que no los llevan.`
En `analizar_conflicto.ts` el rótulo «reformas anotadas en el texto (primeras 5)» pasa a «notas de reforma del texto (de cualquier artículo de la norma; las 5 primeras del documento)». Solo texto: `historial().slice(0, 5)` no cambia.

**D3. El artículo de `obtener_documento` pasa por `trocear`.** En la rama `p.articulo` de `gestorDocumento()`: `const t = trocear(art, p.desde, tope)`, `cuerpo = t.texto` y el mismo `avisoTexto` que el modo documento entero, con `reanudar(p, …)`, que ya incluye `articulo` (`obtener_documento.ts:297`: estaba previsto y no se usaba). Las advertencias de vigencia se calculan sobre el artículo completo (`advertenciasVigencia(art)`), no sobre el trozo: una nota «Modificado por» al final se perdería al recortar. `mencionesDe` sigue sobre el trozo mostrado.
Cambio de comportamiento: con el tope por defecto (8.000) un artículo de hasta 20.000 caracteres deja de salir entero. Es lo que el spec vigente de `obtener-documento` ya exigía («respetando `limite_caracteres`»).
*Alternativa descartada:* cortar con `slice(0, tope)`. Sin `desde` ni «trozo siguiente» el resto del artículo sería inalcanzable.

**D4. La Constitución se resuelve en `parsearCita`, no en la tabla de códigos.** La entrada en `CODIGOS` haría que `resolver_cita` la rotulara «se cita aquí como Constitucion politica 1 de 1991, que es su norma contenedora» (`referencia()` capitaliza solo la primera letra y la Constitución no está contenida en nada). En `citas.ts`, tras el bloque de códigos, una expresión reconoce «Constitución», «Constitución Política», «… de Colombia» y «… de 1991» —no «Constitucional», no «inconstitucional»— y devuelve `{tipo:'constitucion politica', numero:'1', anio:'1991', articulo}`. Regla de precedencia idéntica a la de los códigos: gana lo que aparece antes en el texto. `TIPOS` ya tiene `'constitucion politica': 8` y el Gestor la titula «Constitución Política 1 de 1991» (id 4125; `obtener_documento id=4125 articulo=53` ya funciona).
*Alternativa descartada:* alias en `CODIGOS`. Rotula mal y mezcla dos cosas distintas. Tampoco se añade «CP» como sigla: el propio `codigos.ts` la excluye por chocar con Código Penal.

**D5. `consultar_por_jerarquia`: tipo correcto y refuerzo compartido.**
(a) `porGestor` llamaba `tipoANivel(nivel)` con un *nivel* —una vuelta inútil que para `'constitucion'` cae en `'resolucion'` (la clave del mapa es «constitucion politica»). Se sustituye por una tabla `TIPO_GESTOR` junto a `NIVELES` en `nucleo/jerarquia.ts` (constitucion → «Constitución Política», ley → «Ley», decreto → «Decreto», resolucion → «Resolución», concepto → «Concepto»).
(b) El aviso «el Gestor no cataloga la Constitución» se borra (es falso: `listar_catalogos` la lista) y se cambia por la remisión a `resolver_cita` con «art. N de la Constitución Política».
(c) El refuerzo por subtema vive hoy en línea en `buscar_normas.escribir` (líneas 85-114). Se extrae a una función exportada de ese mismo módulo, `buscarConRefuerzo(params)`, que devuelve el resultado y la nota; `buscar_normas` la llama en lugar del bloque en línea (camino viejo borrado) y `porGestor` la llama con el tipo del nivel. `formatear()` recibe la nota como cuarto parámetro opcional (los tests actuales de `formatear` siguen valiendo). Precedente de una herramienta que importa de otra: `resolver_cita` ↔ `validar_cita`.
*Alternativa descartada:* mover la función a `fuentes/gestor.ts`; arrastraría al módulo de fuente el índice temático y la redacción de la nota.

**D6. Cero resultados en SAMAI.** En `consejoestado.buscar`, la ausencia del rótulo de paginación deja de ser, por sí sola, `CanarioError`: se lanza solo si tampoco está el armazón `ResultadoBusqueda1` o si hay filas sin leer; con armazón y sin filas, `res.paginas = 0` y el flujo sigue a la ampliación a OR ya existente. Es el mismo criterio que `porRadicado` aplica desde la medición del 2026-09-28 (su comentario: «un vacío con armazón NO es un fallo»). El perfil de contratación hereda el arreglo porque llama a la misma `buscar`.

**D7. Perfil ambiental.** `consultarAmbiental` deja de bajar solo `leyes` y recorre la primera página de cada clave de `anla.SECCIONES` (7 peticiones en paralelo), une sin repetir por URL y filtra con `anla.filtrar`. La advertencia del perfil pasa a decir qué se revisó y que un vacío no prueba ausencia. `// ponytail: solo la primera página de cada sección; el techo es lo que Eureka pone en las siguientes; el salto, paginar con el «desde» que cada sección declara.` Los rótulos de sector de contratación (`Consejo de Estado`) y energía (`CREG`) se corrigen: son dos cadenas.

**D8. Fechas.** Consejo de Estado: `LblFECHAPROC` es la fecha del proceso; la tool imprime «Fecha del proceso:» y el pie recuerda que la de la providencia está en su texto. Corroboración medida: el resultado 11001032400020130045400 figura con «2 de octubre de 2013» y su sentencia cita fallos de 2023 y 2024. Suprema: el campo es `fechaCreacion` del índice (`cortesuprema.ts:146`); se imprime «registrada el …». Corte Constitucional no se toca. Se busca con `grep` cualquier otro sitio que imprima `Providencia.fecha` (p.ej. la resolución por radicado) y se rotula igual.

**D9. Sectorial.**
- SIC: el conjunto exacto `TIPOS_EXCLUIDOS` se sustituye por un único predicado sobre la etiqueta (subcadenas «nombramiento», «proyecto de resolución/circular», «tablas de retención») y sobre el epígrafe (empieza por «Proyecto de»). Se usa una sola vez en `extraer`; se borra el segundo filtro duplicado de `buscar` (`sic.ts:145`).
- Portal roto: `numeroDelArchivo` decodifica el nombre (`decodeURIComponent`, con `try/catch` que deja el nombre crudo). La causa del «201227» es que `%20` + `1227` forman `201227` para `\b\d{3,6}\b`. Mintrabajo compara contra `${tipo} ${norma}` (la celda con el número propio) en vez del epígrafe, que en un acto modificatorio cita al modificado (1072). Parques sigue comparando su título.
- ANH: en `fuentes/anh.ts`, una categoría «None» (texto del portal) se guarda como cadena vacía; la línea de resultado ya omite el sufijo cuando la categoría está vacía.

**D10. Menores.**
- Diario: `buscar()` devuelve `salida.slice(0, limite)`; hoy sirve páginas de 10 y nunca recorta.
- SUIN: tras `conAlternativas`, si se usó una variante, se filtran los documentos que no contengan todos los términos significativos de esa variante (`terminosSignificativos`, ya exportada por `fuentes/gestor.ts` y usada por Consejo de Estado). Si no queda ninguno, el vacío existente, con el aviso de huecos y la remisión a `buscar_por_tema`.
- Iconos: `cargar()` en `parse.ts` quita los elementos `.material-symbols-outlined` (medido en las páginas de CREG e INVIMA: `<span class="material-symbols-outlined …">developer_guide</span>`). Lo usan todas las fuentes HTML; ningún selector de scraping depende de esos iconos.
- Descripciones: `listar_catalogos` sin recuentos; `invima.ts` y `supersalud.ts` dicen que el HTML se lee con `obtener_documento`.

**D11. `temsubid` obligatorio de verdad.** En `explicar_relacion_tema.ts:21`, `temsubid: z.coerce.string()` pasa a `z.string()`. `coerce` no aporta nada: el valor lleva prefijo («ts-38872») y un número suelto se rechaza igual en `sinPrefijo`. Con `z.string()` la ausencia la levanta el esquema del campo y `conAviso` (`normalizar.ts:72`) la redacta como «Falta "temsubid", que es obligatorio: …»; y `isOptional()` deja de aceptarla, con lo que el esquema JSON que se publica lo lista en `required` (hoy solo lista `normid`, porque `z.coerce.string()` acepta «undefined»). Se comprueba de paso que ningún otro campo obligatorio de las 28 herramientas sea `z.coerce.string()` sin regex (medido: solo este; `id` de `obtener_documento` es opcional y ya lo trata `obtener_documento.ts:206`).
*Alternativa descartada:* añadir en `conAviso` un caso `ctx.data === 'undefined'` para cualquier tipo. Parchea el síntoma y deja el esquema publicado mintiendo.

**D12. El aviso de OR sale de la nota de la fuente, no de la herramienta.** `consejoestado.buscar` ya devuelve `nota` según el modo (`consejoestado.ts:269-276`: filtro AND en exacto con ≥2 términos, «Modo ampliado (OR)» en `exacto=false`). La herramienta añade además, sin condición, «El buscador une los términos con OR…» (`buscar_jurisprudencia_consejo_estado.ts:82-83`). Se borra esa frase incondicional y la herramienta imprime `r.nota`. Cuando una frase exacta sin resultados se amplía (`ampliada: true`), la fuente ya antepone su aviso; se comprueba que la respuesta declare el modo OR en ese caso también.

**D13. «Temas asociados (N de M)».** En `obtener_documento.ts:535`, `Math.min(10, ordenados.length)` pasa a `Math.min(cuantosTemas, ordenados.length)`, con `cuantosTemas` ya calculado en la línea 526 (3 si el tope es menor de 2000, 10 si no). Un solo número, el que se muestra.

**D14. Filas sin número (sectorial) y duplicados de salud.**
- `buscar_normativa_sectorial.ts:92`: la clave de repetidas ignora las filas sin número (`if (!d.numero) continue`); la línea de resultado (`:111`) omite el número y el «de» cuando faltan y rotula por tipo y epígrafe. El aviso de repetidas solo nombra actos con número y año.
- `buscar_unificado.ts`: tras reunir los resultados, dos ítems de `invima` y `supersalud` con el mismo nombre de archivo (último segmento de la URL) se fusionan en el primero, con «también en Supersalud» en el detalle, y el límite se completa con lo siguiente. Precedente: la deduplicación que la búsqueda federada ya aplica entre fuentes (spec `busqueda/deduplicacion-resultados`). `// ponytail: la clave es el nombre de archivo; el techo es un acto que las dos entidades publiquen con nombres distintos; el salto sería comparar epígrafes normalizados.`

**D15. Perfiles de contratación y energía.**
- Contratación (`perfiles.ts:82-85`): en vez de `[p.radicado, p.url]`, cada resultado lleva el radicado con su clase, la fecha del proceso rotulada como en D8, la sala y las partes si existen, y el enlace de la ficha. Los campos ya vienen en `p` (los usa la herramienta del Consejo de Estado); solo se dejan de tirar.
- Energía (`perfiles.ts:87-92`): `creg.buscar('vigentes', texto, limite, undefined)` sin año mira solo el año en curso (así lo declara `buscar_resoluciones_creg`). No se recorren todos los años (consultas de más para una fuente que ya tiene herramienta propia): la advertencia del perfil dice que solo se revisó el año en curso y remite a `buscar_resoluciones_creg` con `anio`. Mismo criterio que D7: declarar el alcance, no ampliarlo.

**D16. Fuente degradada: la causa y la verdad.** `Breaker` (`http.ts:163`) gana `ultimo: string`, la causa del último fallo. `anotarFallo(host)` pasa a `anotarFallo(host, causa)`; los tres sitios que lo llaman (`http.ts:493`, `:578`, `:584`) ya tienen a mano el estado HTTP o el mensaje del error de red. `errorDegradado(host, ms, causa)` redacta dos formas: recién armada («La fuente X no respondió: <causa>. No se reintenta sola; las llamadas a X se cortan 60 s y pasado ese plazo se vuelve a llamar») y en pausa («X sigue en pausa por <causa>; quedan N s y esta llamada no salió a la red»). Se conserva el `test` `/degradada/` que usa `http.ts:584` para no contar la excepción del propio breaker como fallo. La causa raíz del fallo de Superfinanciera NO se decide aquí: primero se mide (tarea 6.5) con `MEDIR_RED` y `pedir`, porque puede ser el certificado, un 5xx real o un cambio del portal, y cada uno pide otra corrección.
*Evidencia de por qué:* tres intentos de la tercera serie, el segundo y el tercero pasado más de un minuto, respondieron los tres «reintentando en 60 s»; una pausa heredada habría mostrado una cifra menor, así que cada llamada tocó la red, falló y rearmó los 60 s.

## Risks / Trade-offs

- **[Riesgo] El criterio del armazón en D6 se apoya en la medición documentada de `porRadicado`, no en una medición propia de «frase exacta sin resultados».** Una sonda con `curl` no vale: SAMAI responde «ENLACE DE CONSULTA INCOMPLETO O CORRUPTO» a peticiones que no son las de la extensión. → La tarea 4.1 captura esa página con el cliente real (`pedir`) antes de tocar código. **Si no trae el armazón, se detiene el trabajo y se elige otro discriminador con el usuario**; no se adivina.
- **[Riesgo] La Constitución pasa por la rama de vigencia de SUIN**, que no tiene ficha de ese tipo y puede imprimir «no consta… constitucion politica 1 de 1991» en minúsculas y sin tildes. → La tarea 3.3 lo comprueba en vivo; si sale así, se omite la consulta de SUIN para ese tipo (una condición) en vez de rotularla mal.
- **[Riesgo] D3 corta artículos largos que antes salían enteros.** → Cambio declarado en `proposal.md`; el «trozo siguiente» se entrega ya calculado.
- **[Riesgo] D2 es una heurística de frase.** → Marcada con `ponytail:`; un test fija el caso de la Ley 2466 y otro fija una nota genuina.
- **[Trade-off] D7 sigue mirando solo la primera página de cada sección.** Mejora de 1 sección a 7 y declara su alcance; paginar todo sería más código para una fuente que el propio MCP describe como mapa, no como corpus.

## Fuera de alcance, con motivo

| Hallazgo | Motivo |
|---|---|
| `entero` / `ruta_destino` rechazados | Ya corregido en 1.15.0 (`obtener_documento.ts:83-96`). |
| Entidades «0» y «ACTA» en `listar_catalogos entidades` | Datos del propio Gestor; filtrarlos por heurística arriesga borrar una entidad real. |
| Epígrafe cortado a mitad de palabra en `consultar_perfil energia` («solares foto») | Tope de longitud deliberado del perfil; sin daño para la cita, que va en el enlace. |
| Campo «Publicación:» vacío en `resolver_cita` de una sentencia | Cosmético; la relatoría no publica la fecha de esa ficha. |
| UPME: la Res. 692/2025 sale en las páginas 1 y 2 | Probable orden inestable por empate de fecha de publicación del portal; sin verificar. |
| Causa del fallo de Superfinanciera (6 intentos en dos series, siempre «reintentando en 60 s») | Se mide antes de decidir (tarea 6.5). Lo que sí se corrige es el mensaje, que esconde la causa (D16). |
| Filtro `SU` de `buscar_jurisprudencia` | Coherente: «discapacidad» con SU da 0 y la SU-049/17, sobre la misma materia, no contiene esa palabra en su tema ni su síntesis; «tutela» con SU devuelve SU. Sin defecto. |
| `expediente` desactivado | Configuración (`EXPEDIENTES=1`), no defecto. |
| `URL:` tras cada párrafo | Decisión deliberada (`conOrigen`: un párrafo sin origen se cita como de otro documento). La tercera serie midió su coste: con `consejo`, un tope de 600 caracteres devolvió el token de unos 700 caracteres tres veces. Reducirlo (p. ej. el origen solo al cambiar de sección) cambia una garantía de citación: es decisión de Angel, no de este cambio. |
| «Remite a un documento externo» sobre el título de la Res. 1403 | Heurística de `documentosRemitidos`; falso positivo menor, sin arreglo pequeño y seguro. |
| Circular 2/2000 de INVIMA con 360.982 caracteres | Sin verificar qué contiene el resto; requiere medir primero. |
| Constitución sin tildes | Así la publica el Gestor; el texto se transcribe literal a propósito. |
| Res. 232 de ANH enlaza el fichero 0235 | Dato del portal; el aviso de portal roto no está cableado a ANH y hacerlo sería una fuente nueva de avisos. |
| Esquema de `tipos` en `buscar_jurisprudencia` (solo letras) | El servidor acepta los nombres deliberadamente (commit d175ad2); ningún cliente probado lo rechazó. |
