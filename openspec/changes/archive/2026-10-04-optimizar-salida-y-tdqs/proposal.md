## Why

Una sesión real de 8 llamadas (≈100 KB de salida) mostró que cerca de una cuarta parte del texto que el MCP mete en el contexto del LLM es repetición: el mismo JWT dos veces por providencia del Consejo de Estado, la ficha de una norma repetida por cada artículo pedido en un lote, la línea de alcance en cada bloque y la URL de la norma en cada artículo. Además salieron dos defectos de contenido: un artículo que se come al siguiente cuando el encabezado no lleva espacio («ARTÍCULO3°») y una corrección de tipo falsa en cada cita del Estatuto Tributario. Por su parte, Glama califica las 28 herramientas con un TDQS medio de 4,35/5. Parámetros es la dimensión más floja (3,43; 16 herramientas con 3), y en las 28 la justificación de Comportamiento empieza por «no annotations». El detalle está en `calificaciones-glama.md`.

## What Changes

- `resolver_cita` en lote (`citas`): las citas que resuelven a la misma norma se agrupan bajo una sola ficha (título, id, vigencia, siguiente paso, URL) seguida de sus artículos en el orden pedido; la línea `Alcance:` sale una vez por respuesta.
- `resolver_cita`: cada bloque de artículo deja de repetir `URL:`, que ya está en la ficha justo encima. **Revierte** una decisión documentada en el CHANGELOG (la URL pegada al encabezado del artículo), por decisión explícita del usuario.
- `resolver_cita` con `contexto: false`: desaparece la nota «(Extracto de tema asociado omitido…)»; el que llama ya pidió omitirlo.
- `buscar_jurisprudencia_consejo_estado`: el token sale **una vez** por documento; el pie explica una sola vez cómo leerlo (`obtener_documento` o el enlace del navegador). Las entradas de un mismo radicado en la misma página comparten cabecera y cada documento conserva su token y sus tesis. El párrafo «UNA PROVIDENCIA PUEDE REPETIRSE…» solo sale cuando hay repetidas, y la lista final de radicados desaparece.
- Extracción de artículos: un encabezado sin espacio entre «ARTÍCULO» y el número («ARTÍCULO3°») cierra el artículo anterior.
- Códigos citados por su nombre: el Estatuto Tributario se rotula como «Decreto Ley 624 de 1989» y la respuesta deja de afirmar «No existe un «decreto 624 de 1989»» cuando el usuario no escribió ningún tipo.
- Definición de herramientas (Glama/TDQS): las 28 declaran anotaciones MCP (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Las descripciones de las 16 con Parámetros = 3 explican las relaciones entre parámetros que el esquema no transmite. `resolver_cita` menciona el modo `validar`, `linea_jurisprudencial` nombra sus alternativas, `consultar_vigencia` se vuelve más fácil de leer y `analizar_conflicto` pierde la errata «mencionanun».
- Escrituras a disco: `obtener_documento` (`entero`/`ruta_destino`, archivo `texto-<fuente>.txt`) y `expediente` (`exportar`) dejan de sobrescribir en silencio un archivo existente; escriben con sufijo, como ya exige `descargas/descarga-ruta` para las descargas. Es condición para declarar ambas herramientas como no destructivas.

## Capabilities

### New Capabilities
- `herramientas/resolver-cita-compacta`: forma de la respuesta de `resolver_cita` (lote agrupado por norma, alcance único, artículos sin URL repetida, sin nota de `contexto=false`).
- `busqueda/listado-consejo-estado`: forma del listado del Consejo de Estado (token único, agrupación por radicado en la página, pie sin repeticiones).
- `herramientas/extraccion-articulos`: dónde empieza y dónde termina un artículo extraído del texto de una norma.
- `herramientas/cita-codigos`: cómo se rotula un código citado por su nombre y cuándo procede corregir el tipo.
- `herramientas/definicion-herramientas`: anotaciones MCP y contenido mínimo de la descripción de cada herramienta en `tools/list`.

### Modified Capabilities
<!-- Ninguna: `descargas/descarga-ruta` ya exige no sobrescribir en silencio; aquí solo se cumple. -->

## Impact

- **Código:** `src/herramientas/resolver_cita.ts`, `src/herramientas/buscar_jurisprudencia_consejo_estado.ts`, `src/nucleo/parse.ts` (`articulo`, `indiceArticulos`), `src/nucleo/codigos.ts`, `src/herramientas/codigo_senado.ts`, `src/index.ts` (`registrarHerramienta`), los módulos de las 28 herramientas (`TITULO`/`DESCRIPCION`/anotaciones), `src/herramientas/obtener_documento.ts`.
- **Pruebas:** `test/lote-resolver.ts` (hoy fija la nota de `contexto=false`), pruebas de contrato de `tools/list` en `test/e2e.ts` y `test/red-v2.ts`.
- **API pública:** sin parámetros nuevos ni retirados. Cambia el texto de las respuestas: un cliente que parseara `Leerla:`, `Texto completo:` o la `URL:` por artículo deja de encontrarlos. `tools/list` gana el campo `annotations`.
- **Dependencias:** ninguna (`@modelcontextprotocol/sdk` 1.30.0 ya admite `annotations` en `registerTool`).
- **Fuera de alcance:** tope de longitud por artículo (el art. 2 de la Ley 769 mide unos 22 KB legítimos); manejador corto radicado→token (descartado en favor de token único); deduplicar entre llamadas distintas; subir versión o publicar.
