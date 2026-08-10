/**
 * Supersalud — Superintendencia Nacional de Salud.
 *
 * La página de normatividad del portal (SharePoint) no publica un listado
 * parseable: enlaza a un normograma externo de Avance Jurídico
 * (normograma.supersalud.gov.co), la misma casa editorial de SUIN-Juriscol y
 * del normograma del INVIMA. Ese normograma es, como el del INVIMA, un libro
 * de páginas HTML estáticas con una app Angular de búsqueda (`<app-root>`).
 *
 * El backend se encontró leyendo `compilacion/main_sns.js`: la app llama a
 * `https://normograma.info/prueba-sns/buscador/Buscar.ashx?&texto=...` y
 * recibe JSON plano, sin sesión ni token. `direccionAPI` está hardcodeada ahí
 * (el `configuracion.txt` que la app intenta leer primero da 404, así que usa
 * el valor por defecto `prueba-sns`). Se verificó con una petición real:
 *
 * - `texto=habilitacion` → JSON con `nombre`, `texto`, `link`, `entidad`,
 *   `epigrafe`, `tipo`, `year`, `numero`.
 * - La codificación es latin1/ISO-8859-1; `decodificar` de `http.ts` ya lo
 *   resuelve.
 *
 * Lo importante para no prometer de más: esta base NO es solo lo que emite la
 * Supersalud. Es la compilación jurídica del sector salud que su normograma
 * indexa —leyes, decretos y resoluciones del Ministerio de Salud, conceptos y
 * hasta sentencias—, con varias entidades en el campo `entidad`. Por eso no se
 * filtra por entidad: se advierte del alcance real en vez de fingir un recorte.
 */
import { adaptadorNormograma } from './normograma.ts'

export default adaptadorNormograma({
  id: 'supersalud',
  nombre: 'Superintendencia Nacional de Salud',
  sector: 'Salud: aseguramiento, prestación de servicios y protección al usuario',
  portal: 'https://normograma.supersalud.gov.co/compilacion/herramientas_busqueda.html',
  dominioPermitido: 'https://normograma.supersalud.gov.co',
  tiposDocumento: ['Ley', 'Decreto', 'Resolución', 'Circular', 'Concepto'],
  advertencia:
    'Esta fuente NO es solo lo que emite la Supersalud: es la compilación jurídica del sector salud que el ' +
    'normograma de la entidad indexa (leyes, decretos y resoluciones del Ministerio de Salud, conceptos y ' +
    'jurisprudencia de las altas cortes), con varias entidades en el campo "entidad" de cada resultado. El ' +
    'campo "tipo" dice de qué se trata; no asumas que todo es un acto de la Supersalud. Los documentos son ' +
    'PDF o HTML sin texto extraíble aquí, y el buscador solo da el AÑO de cada acto, no el día ni el mes. ' +
    'No publica vigencia.',
  apiBase: 'https://normograma.info/prueba-sns/buscador/',
  docsBase: 'https://normograma.supersalud.gov.co/compilacion/docs/',
  soportaAnio: false,
})
