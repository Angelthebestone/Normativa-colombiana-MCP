## Context

Ver proposal.md (Why). Estado actual que condiciona el enfoque:

- `resolverUnaCita()` (`src/herramientas/resolver_cita.ts`) devuelve un **string ya compuesto** en cada rama (radicado, código del Senado, sentencia, Gestor sin resultados, ambigua, resuelta), y cada rama mete su propia línea `alcance(...)`. El lote (`escribir` con `citas`) concatena esos strings. Para agrupar por norma y emitir un solo alcance hay que dejar de componer el texto dentro de cada rama.
- Ya existe deduplicación por respuesta del extracto (`yaConExtracto`), sin estado entre llamadas. El CHANGELOG descartó a propósito una caché de 5 minutos por reproducibilidad, y este diseño mantiene ese criterio.
- `bloqueArticulo()` añade `URL:` por artículo. Su comentario justifica esa línea y además está mal colocado: documenta `bloqueArticulo` pero está encima de `citaOficial`.
- `buscar_jurisprudencia_consejo_estado.ts` arma el listado ítem a ítem. `memoriaCE.paginas` recuerda en qué página salió cada radicado y solo marca las repeticiones **entre** páginas.
- `parse.ts`: `articulo()`, `RE_ENCABEZADO` e `indiceArticulos()` exigen `\s+` entre «ARTÍCULO» y el número.
- `codigos.ts` guarda el tipo de búsqueda (`'decreto'` para el ET y otros). `refCodigo()` arma la etiqueta «se cita aquí como …» desde la tabla, y `buscarCorrigiendoTipo()` compara el tipo de la tabla con el que devuelve el Gestor, como si lo hubiera escrito el usuario.
- `registrarHerramienta()` (`src/index.ts`) registra las 28 herramientas con `{ title, description, inputSchema }`. El SDK 1.30.0 admite `annotations` en esa misma configuración.
- `obtener_documento` (rama `entero`/`ruta_destino`) escribe `texto-<fuente>.txt` con `writeFile` sin comprobar colisión. `expediente` (`exportar`) hace lo mismo con `ruta` o con `<ruta>/<id>.md`. `nucleo/descargas.ts` ya tiene `sinColision()`.

## Goals / Non-Goals

**Goals:**
- Que cada dato salga una sola vez por respuesta, sin introducir estado entre llamadas.
- Que el texto de las respuestas sea determinista: la misma llamada da el mismo texto.
- Objetivo externo, no verificable en CI: que ninguna herramienta baje de 4,0 en TDQS y que la media de Parámetros pase de 3,43 a ≥ 4. Se mide en Glama tras publicar.

**Non-Goals:**
- Cambiar parámetros de entrada o su semántica.
- Deduplicar entre llamadas distintas (p. ej. el mismo radicado en dos búsquedas con textos distintos).
- Tocar `conOrigen` de `obtener_documento` (`URL:` por párrafo en textos troceados): es otra decisión, sobre otra herramienta.

## Decisions

**D1. `resolverUnaCita` devuelve una estructura, no texto.** El tipo de retorno pasa a `{ clave: string | null; usos: UsoFuente[]; ficha: string; articulos: string[]; aviso?: string }`:
- `clave` es la identidad de la norma resuelta: `gestor:<id>`, `senado:<archivo>`, `corte:<sentencia>`, o `null` si no resolvió.
- `usos` son las entradas que hoy recibe `alcance()`.
- `ficha` es todo lo que no es artículo.

Un único compositor arma la respuesta: primero `alcance(unión de usos)`, después un bloque por `clave` en orden de primera aparición (ficha una vez + artículos en orden), y las citas con `clave: null` cada una en su propio bloque. La ruta individual usa el mismo compositor con un solo elemento, así ambas vías siguen siendo idénticas.

*Alternativa descartada:* postprocesar los strings con expresiones regulares (quitar `Alcance:` repetidos, fundir fichas por `id:`). Es frágil frente a cualquier cambio de redacción y vuelve a parsear lo que el propio código acaba de escribir.

**D2. Unión de alcance.** `alcance()` recibe la lista de usos de todas las citas, deduplicada por `clave` de fuente. El detalle de cada fuente se acumula (p. ej. `Gestor Normativo (3 normas resueltas)`). Si una cita no consultó SUIN y otra sí, SUIN cuenta como consultada: la línea describe la respuesta entera, no cada cita.

**D3. Encabezado del bloque agrupado.** `### <título oficial de la norma>` seguido de `Citas: <cita 1>; <cita 2>…` cuando el lote trae más de una cita para esa norma, para que quien pidió «art. 817 del Estatuto Tributario» reconozca su cita. Con una sola cita, el encabezado sigue siendo `### <cita>` como hoy.

**D4. Fuera la `URL:` por artículo y la nota de `contexto=false`.** Se borra la línea de `bloqueArticulo()` y su comentario (y el comentario huérfano se reubica o se elimina). La nota de `contexto=false` desaparece. El test `test/lote-resolver.ts` que fija «omitido con contexto=false» se reescribe para comprobar que el extracto no aparece y que la respuesta es más corta. Esto revierte una justificación del CHANGELOG, así que la entrada nueva lo dice expresamente.

**D5. Consejo de Estado: token una vez y agrupación por radicado.**
- Cada documento lleva `  token: <jwt>`. El pie añade una vez: `Para leer una: obtener_documento con fuente="consejo" y token=<token de la entrada>; en el navegador, ${consejo.enlaceProvidencia('<token>')}`.
- Antes de componer, los ítems de la página se agrupan por `radicado` conservando el orden de primera aparición. La cabecera sale del primer ítem; debajo, cada documento con su token y sus tesis.
- La línea de conteo pasa a `se muestran N documento(s) de M radicado(s)` cuando N ≠ M.
- `memoriaCE` sigue funcionando por radicado y página, sin cambios.

*Alternativa descartada (elegida por el usuario):* manejador corto radicado→token con `obtener_documento radicado=…`. Añade estado y un camino nuevo en `obtener_documento`.

**D6. Encabezado de artículo con `\s*`.** En `articulo()`, `RE_ENCABEZADO` e `indiceArticulos()`, `(?:ART[IÍ]CULO|Art[ií]culo)\s+` pasa a `\s*`. `NUM_ARTICULO` empieza por dígito, así que «Artículos» no casa (la `s` no es dígito). Antes y después se miden todos los artículos del índice de las cinco normas del spec. El script de medición es desechable y no se versiona; el resultado va al CHANGELOG, como en la medición de 2026-09-28.

**D7. Códigos: rotular con el título resuelto y no corregir lo que no escribió el usuario.**
- La línea «se cita aquí como …» se compone **después** de resolver, con el título oficial del Gestor (`n.titulo` sin el emisor; p. ej. «Decreto Ley 624 de 1989»).
- En los códigos del Senado (Código Civil) sigue saliendo de la tabla, que ya es correcta (`ley 84 de 1873`).
- `tipoCorregido` se emite solo si `!c.codigo`.
- La tabla `CODIGOS` no cambia: su `tipo` sigue siendo la clave de búsqueda.

*Alternativa descartada:* cambiar `tipo: 'decreto'` por `'decreto ley'` en la tabla. Habría que auditar a mano los diez códigos contra el Gestor, `referencia()` capitaliza solo la primera letra y la búsqueda por tipo podría dejar de casar.

**D8. Anotaciones junto a cada módulo.** Cada módulo de herramienta exporta `ANOTACIONES: ToolAnnotations` al lado de `TITULO` y `DESCRIPCION`. `HerramientaV2` lo exige y `registrarHerramienta()` lo pasa en `annotations`. Así, que falten es un error de tipos y no un olvido en `index.ts`.

Valores, que se confirman leyendo el código de cada módulo durante la implementación:
- **Consulta en red:** `resolver_cita`, todas las `buscar_*` menos `buscar_por_tema`, `listar_catalogos`, `consultar_*`, `historial_norma`, `comparar_articulos`, `analizar_conflicto`, `cambios_desde`, `linea_jurisprudencial` y `listar_normativa_ambiental_anla`. Valores: `readOnly: true, destructive: false, idempotent: true, openWorld: true`.
- **Sin red:** `describir_fuentes`, `buscar_por_tema` y cualquier otra que el código confirme sin red (p. ej. `explicar_relacion_tema` si solo lee el índice empaquetado): `openWorld: false`.
- **`obtener_documento`:** `readOnly: false` (escribe en disco con `entero`/`ruta_destino`), `destructive: false` (tras D9), `idempotent: false` (cada escritura crea un archivo nuevo), `openWorld: true`.
- **`expediente`:** `readOnly: false`, `destructive: false` (tras D9), `idempotent: false`, `openWorld: false`.

`readOnlyHint: false` puede hacer que algunos clientes pidan confirmación en cada llamada a `obtener_documento`. Se acepta: es lo honesto, y el modo normal (sin `entero`) no escribe nada.

**D9. Escrituras sin sobrescribir.** `obtener_documento` (`texto-<fuente>.txt`) y `expediente` (`exportar`) pasan la ruta final por `sinColision()`, que se exporta desde `nucleo/descargas.ts` si hoy no lo está. Las dos respuestas ya informan de la ruta, así que basta con que sea la final. En `expediente`, una `ruta` que apunta a un archivo existente deja de reemplazarlo: es un cambio visible y va al CHANGELOG.

**D10. Descripciones.** Para cada una de las 28, se parte de la justificación de Glama en `calificaciones-glama.md` y se corrige lo que señala:
- relaciones entre parámetros (Parámetros = 3 en 16 herramientas);
- la alternativa hermana con nombre (guía de uso);
- efectos y modo de solo lectura cuando no los declaran (comportamiento).

Reglas de redacción:
- no copiar en la descripción lo que ya dice el `describe()` de un campo, porque Concisión penaliza la repetición;
- reescribir `consultar_vigencia` como frases cortas y sin la cadena de paréntesis;
- en `resolver_cita`, añadir el modo `validar`.

Los tests de contrato que fijan frases (`listar_catalogos` debe nombrar `buscar_normativa_tributaria`) se mantienen: comprueban el enrutado, no la redacción.

## Risks / Trade-offs

- [Un cliente parsea `Leerla:`, `Texto completo:` o `URL:` por artículo] → No hay parsers conocidos en el repo (los tests sí, y se actualizan). Se anota en el CHANGELOG como cambio de formato de salida.
- [El modelo deja de encontrar la URL al citar un artículo concreto] → La ficha queda inmediatamente encima, en el mismo bloque `###`. En lote, la agrupación hace que cada artículo esté bajo la ficha de su norma.
- [`\s*` hace casar un encabezado falso del tipo «ARTÍCULO1 de la Ley…» en prosa] → Sigue exigiendo inicio de renglón, y la medición antes/después de D6 lo detectaría.
- [Las anotaciones son pistas: un cliente puede ignorarlas o tratarlas distinto] → El valor es declarativo. No se usan para nada de seguridad dentro del servidor.
- [Glama no vuelve a puntuar enseguida, o su modelo puntúa distinto] → El objetivo TDQS no es criterio de aceptación de las tareas. Lo son los specs; la puntuación se comprueba después de publicar.
- [El refactor de D1 toca todas las ramas de `resolver_cita`] → Las pruebas herméticas existentes (`test/lote-resolver.ts`, `test/e2e.ts`) cubren las ramas, y se añade un caso de lote con dos normas intercaladas.

## Migration Plan

Sin migración de datos. Se publica como versión menor con una entrada en el CHANGELOG que enumera los cambios de formato de salida. Para revertir basta con volver a la versión anterior del paquete: no hay estado persistido nuevo.
