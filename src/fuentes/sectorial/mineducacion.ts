/**
 * MEN — Ministerio de Educación Nacional.
 *
 * El normograma del MEN (`normograma.info/men/compilacion/index.html`) es otro
 * libro de Avance Jurídico, como los del INVIMA y la Supersalud: páginas HTML
 * estáticas y una app Angular de búsqueda en
 * `compilacion/compilacion/herramientas_busqueda.html`.
 *
 * El backend se encontró leyendo `compilacion/compilacion/main_MEN.js`
 * (medido el 2026-10-14): `direccionAPI="https://normograma.info/prueba-men/buscador/"`
 * y `direccionArchivos="docs/"`, relativo a la página del buscador. Se verificó
 * con peticiones reales:
 *
 * - `texto=educacion` → JSON con `nombre`, `link`, `entidad`, `epigrafe`,
 *   `tipo`, `year`, `numero`; el motor corta en 10.000 resultados.
 * - `texto=zzqqxx` → el literal `No se encontraron resultados.`.
 * - El clausulado de año `(year contains (2024~~2024))` funciona, como en el INVIMA.
 * - Los documentos viven en `normograma.info/men/compilacion/compilacion/docs/`
 *   (`decreto_1075_2015.htm` da 200); `.../men/compilacion/docs/` y
 *   `.../men/docs/` dan 404.
 *
 * Lo importante para no prometer de más: esta base NO es solo lo que emite el
 * MEN. En la muestra de `educacion` hay leyes y decretos de la Presidencia y el
 * Congreso, resoluciones del Ministerio de Salud, del ICETEX y del ICFES,
 * acuerdos de universidades públicas y jurisprudencia de las tres altas cortes.
 * Por eso no se filtra por entidad: se advierte del alcance real. Los tipos van
 * en plural porque así los nombra este normograma («Resoluciones», «Circulares»),
 * y `solo_entidad` compara contra ellos tal cual.
 */
import { adaptadorNormograma } from './normograma.ts'

export default adaptadorNormograma({
  id: 'mineducacion',
  nombre: 'Ministerio de Educación Nacional',
  sector: 'Educación: preescolar, básica, media y superior',
  portal: 'https://normograma.info/men/compilacion/index.html',
  dominioPermitido: 'https://normograma.info',
  tiposDocumento: ['Resoluciones', 'Circulares', 'Directivas', 'Conceptos'],
  advertencia:
    'Esta fuente NO es solo lo que emite el Ministerio de Educación: es la compilación jurídica del sector ' +
    'educación que su normograma indexa (leyes, decretos de la Presidencia, resoluciones de otros ministerios, ' +
    'del ICETEX y del ICFES, acuerdos de universidades públicas, conceptos y jurisprudencia de las altas ' +
    'cortes). Los campos "tipo" y el epígrafe dicen de qué se trata; no asumas que todo es un acto del MEN. El ' +
    'buscador devuelve como mucho 10.000 resultados por consulta: afina el texto o el año si la consulta es ' +
    'amplia. Los documentos son páginas HTML: su texto se lee con obtener_documento y fuente="sectorial". El ' +
    'buscador solo da el AÑO de cada acto, no el día ni el mes. No publica vigencia como dato.',
  apiBase: 'https://normograma.info/prueba-men/buscador/',
  docsBase: 'https://normograma.info/men/compilacion/compilacion/docs/',
  soportaAnio: true,
})
