## 1. Extracción de artículos (spec `herramientas/extraccion-articulos`)

- [x] 1.1 Con un script desechable (no versionado), guardar el texto de cada artículo del índice de Ley 769/2002, Decreto Ley 624/1989, Ley 1437/2011, Ley 488/1998 y Ley 789/2002 con el `parse.ts` actual, como línea base; verificar que se generó un archivo por norma
- [x] 1.2 En `src/nucleo/parse.ts`, cambiar `\s+` por `\s*` entre «ARTÍCULO/Artículo» y el número en `articulo()`, `RE_ENCABEZADO` e `indiceArticulos()` (D6); añadir a `test/articulo-sustitucion.ts` casos con «ARTÍCULO3°.» (cierra el anterior, se puede pedir el 3) y con «Artículos 1 y 2» (no es encabezado); verificar con `node --test test/articulo-sustitucion.ts`
- [x] 1.3 Repetir el script de 1.1 y comparar: solo cambian artículos seguidos de un encabezado sin espacio y ninguno pierde texto propio; anotar las cifras para el CHANGELOG y borrar el script

## 2. Códigos citados por nombre (spec `herramientas/cita-codigos`)

- [x] 2.1 En `src/herramientas/resolver_cita.ts`, componer la línea «se cita aquí como …» después de resolver, con el título oficial del Gestor en los códigos del Gestor (D7); la de los códigos del Senado sigue saliendo de la tabla
- [x] 2.2 Emitir `tipoCorregido` solo cuando `!c.codigo`; añadir a `test/codigos.ts` (o a `test/lote-citas.ts`, con `buscar` inyectado) un caso donde «art. 817 del Estatuto Tributario» no produce «No existe un» y «Decreto 624 de 1989» escrito por el usuario sí; verificar con `node --test` sobre ese archivo

## 3. resolver_cita compacta (spec `herramientas/resolver-cita-compacta`)

- [x] 3.1 Refactorizar `resolverUnaCita()` para que devuelva `{ clave, usos, ficha, articulos, aviso? }` en todas sus ramas (radicado, Senado, sentencia, sin resultados, ambigua, resuelta), según D1; verificar con `npm run typecheck`
- [x] 3.2 Escribir el compositor único: `alcance()` con la unión de usos (D2), bloques por `clave` en orden de primera aparición, encabezado según D3, y las citas sin `clave` en su propio bloque; las rutas individual y de lote lo usan. Verificar con un caso hermético en `test/lote-citas.ts` (Gestor inyectado): Ley 488 art. 140, Ley 788 art. 59, Ley 488 art. 143 → una línea `Alcance:`, dos `id:` y artículos 140 y 143 bajo la Ley 488
- [x] 3.3 Quitar la línea `URL:` de `bloqueArticulo()` y su comentario, y mover o borrar el comentario huérfano sobre `citaOficial` (D4); verificar que en el caso de 3.2 cada URL de norma aparece una sola vez
- [x] 3.4 Quitar la nota de `contexto=false`; reescribir la prueba de `test/lote-resolver.ts` para que compruebe que el extracto no aparece y que la respuesta es más corta, sin fijar redacción; verificar con `npm run test:red` (red)

## 4. Listado del Consejo de Estado (spec `busqueda/listado-consejo-estado`)

- [x] 4.1 En `src/herramientas/buscar_jurisprudencia_consejo_estado.ts`, sustituir `Leerla:` y `Texto completo:` por una línea `token:` por documento, y poner en el pie la explicación única de lectura (D5); verificar con `test/consejoestado.ts` que con una búsqueda inyectada cada token aparece exactamente una vez
- [x] 4.2 Agrupar los documentos de la página por radicado (cabecera única, cada documento con su token y sus tesis) y ajustar la línea de conteo a documentos/radicados; añadir a `test/consejoestado.ts` el caso de dos documentos del mismo radicado con tokens distintos
- [x] 4.3 Quitar del pie la lista de radicados y emitir el aviso de repetidas solo cuando las haya; verificar en `test/consejoestado.ts` que una página sin repetidas no contiene «UNA PROVIDENCIA PUEDE REPETIRSE» y que la segunda página de la misma búsqueda marca la repetida

## 5. Escrituras sin sobrescribir (spec `herramientas/definicion-herramientas`)

- [x] 5.1 Exportar `sinColision()` desde `src/nucleo/descargas.ts` y usarla en `obtener_documento` para `texto-<fuente>.txt` (D9); verificar con un caso en `test/red-v3.ts` (descarga inyectada, directorio temporal) que dos guardados dejan dos archivos y que la segunda respuesta nombra el sufijo
- [x] 5.2 Usarla también en `expediente` `exportar`; verificar en `test/expedientes-herramientas.ts` que exportar sobre un archivo existente lo deja intacto y escribe con sufijo

## 6. Anotaciones y descripciones (spec `herramientas/definicion-herramientas`)

- [x] 6.1 Añadir `ANOTACIONES` a `HerramientaV2` y pasarlas en `registrarHerramienta()` (`src/index.ts`, D8); verificar con `npm run typecheck`, que debe fallar mientras falte algún módulo
- [x] 6.2 Exportar `ANOTACIONES` en los 28 módulos con los valores de D8, confirmando en el código de cada uno si consulta la red y si escribe en disco; verificar con `npm run typecheck`
- [x] 6.3 Añadir a la prueba de `tools/list` de `test/e2e.ts` que las 28 declaran las cuatro anotaciones como booleanos, que `describir_fuentes` tiene `openWorldHint: false` y que `obtener_documento`/`expediente` tienen `readOnlyHint: false` y `destructiveHint: false`; verificar con `npm run test:e2e`
- [x] 6.4 Reescribir las descripciones de las 16 herramientas con Parámetros = 3 (ver `calificaciones-glama.md`) para que expliquen las relaciones entre parámetros que el esquema no expresa, sin repetir los `describe()` (D10); verificar leyendo cada una contra su justificación de Glama y comprobar que `npm run test:e2e` sigue en verde
- [x] 6.5 Corregir las puntuales: `resolver_cita` (modo `validar` y que `url`/`formato` solo valen con él), `linea_jurisprudencial` (cuándo usar `buscar_jurisprudencia`/`resolver_cita`), `consultar_vigencia` (frases cortas, sin cadena de paréntesis) y la errata «mencionanun» de `analizar_conflicto`; verificar con `npm run test:e2e` y buscando «mencionanun» en `src/` sin resultados
- [x] 6.6 Revisar en el resto de herramientas que cada descripción nombre la hermana alternativa y declare efectos donde Glama lo echa en falta; verificar contrastando con `calificaciones-glama.md`

## 7. Cierre

- [x] 7.1 Reproducir las ocho llamadas de la sesión de referencia (los lotes de `resolver_cita`, las dos búsquedas del Consejo de Estado y `articulos` del Decreto Ley 624) contra el servidor construido y medir el tamaño de la salida frente a los ≈100 KB originales; anotar el resultado
- [x] 7.2 Entrada en `CHANGELOG.md`: cambios de formato de salida (token, `URL:` por artículo, nota de `contexto`, lote agrupado, alcance único), la reversión explícita de la decisión sobre la URL por artículo, el arreglo de «ARTÍCULO3°» con sus cifras, el del Estatuto Tributario, la no sobrescritura de `expediente` y las anotaciones; verificar que la entrada existe
- [x] 7.3 Ejecutar `npm run check` en verde y `graphify update .`
