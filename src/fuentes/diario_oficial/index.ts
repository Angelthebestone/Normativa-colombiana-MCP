/**
 * Diario Oficial — Imprenta Nacional de Colombia (consulta pública).
 *
 * Es la fuente que dice QUÉ SE PUBLICÓ y CUÁNDO, y sirve para el hueco que deja
 * el Gestor Normativo: entre la publicación y su catalogación pasan días. El
 * Gestor tarda; esto está publicado el mismo día. Medido el 2026-09-28: el
 * diario 53.640, del 27/09/2026, ya estaba listado el 28/09.
 *
 * El portal es JSF + PrimeFaces sobre GlassFish 4.1.1 (Java 8), y la búsqueda
 * es un POST normal al `action` del formulario `frmConDiario`, no un ajax. Hay
 * que enviar el `javax.faces.ViewState` de la página y la cookie `JSESSIONID`,
 * así que cada llamada abre su propia sesión (GET + POST) y no guarda estado
 * entre llamadas: la primera versión reutilizaba el ViewState entre búsquedas y
 * el bean del portal arrastraba los filtros de la consulta anterior dentro de
 * la misma sesión (medido: un filtro por número de diario «contaminaba» las dos
 * búsquedas siguientes).
 *
 * Lo que se midió el 2026-09-28, y por qué el código es como es:
 *
 * - **Solo viaja el botón que se pulsa.** El formulario trae un botón por fila
 *   (`dtbDiariosOficiales:N:j_idt34`, «Ver Diario»). Si se envían todos —como
 *   haría quien copie los campos del formulario— el portal no busca: abre el
 *   detalle de la ÚLTIMA fila enviada. Se comprobó: la respuesta de 15.700 bytes
 *   era el detalle del diario 53.631, no la tabla. Por eso `leerFormulario`
 *   descarta los botones y `buscar` añade exactamente uno.
 * - **Filtran**: el número de diario (`numeroDiarioOf`), el rango de fechas
 *   (`fechaInicial_input`/`fechaFinal_input`, dd/MM/yyyy) y el tipo de norma
 *   JUNTO con el número (`tipoNorma_input` + `numeroNorma`) — es decir, «el
 *   diario que publicó la Ley 2466 de 2025» se resuelve y devuelve el 53.160
 *   (25/06/2025). Medido: LEY son 2.167 diarios, DECRETO 13.848, y
 *   DECRETO+1077 son 49.
 * - **No filtran**: `numeroNorma` sin tipo (medido: 2466 sin tipo devuelve los
 *   mismos 100 de la consulta sin filtro) ni `entidad_input` sin el id que
 *   resuelve su autocompletar (medido: «ZZZZQQQ» devuelve los mismos 100 que la
 *   consulta vacía). Los dos se descartan en vez de ofrecerse y no filtrar.
 * - **Sin filtro la tabla trae los últimos 100 diarios; con filtro busca en todo
 *   el archivo** (de ahí que LEY dé 2.167 filas).
 * - **La tabla es de 10 filas por página** y un POST normal devuelve siempre la
 *   primera (`dtbDiariosOficiales_rppDD` no cambia nada por esa vía, medido).
 *   Las siguientes se piden con el postback ajax del propio paginador, que SÍ
 *   respeta el filtro: la página 2 de LEY trae 53.444…53.254, la continuación
 *   de la página 1 (53.605…53.496).
 * - **El detalle de cada diario no se ofrece aquí.** «Ver Diario» es otro POST
 *   con la sesión, y el PDF del diario va en una URL de contenido dinámico de
 *   PrimeFaces (`dynamiccontent.properties.xhtml?pfdrid=…`) que SIN la cookie
 *   responde 404 (medido): no es un enlace citable, y para bajarlo haría falta
 *   mandar la cookie por `pedirBytes`, que hoy no admite cabeceras. Además pesa:
 *   2,8 MB el del 26/09 y 15 MB el del 23/09 (155 s de descarga, medido).
 *
 * ponytail: se reintenta UNA vez cuando el portal corta la conexión —pasó en ~1
 * de cada 10 peticiones medidas—, porque con dos peticiones por consulta la
 * probabilidad de fallo se dobla. El techo es que corte dos veces seguidas; el
 * salto, si eso importa, es reintentar en `http.ts` para todas las fuentes.
 */
export { BASE, MAXIMO, TIPOS, type Diario, type Opciones, type Resultado, type TipoNorma } from './portal.ts'
export { leerFormulario } from './formulario.ts'
export { leerPagina, leerParcial } from './tabla.ts'
export { fechaPortal } from './fecha_portal.ts'
export { buscar } from './busqueda.ts'
