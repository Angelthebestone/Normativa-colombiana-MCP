/**
 * INVIMA — Instituto Nacional de Vigilancia de Medicamentos y Alimentos.
 *
 * `/normatividad/normograma-invima` no es una página propia del INVIMA: es un
 * `<iframe>` a `normograma.invima.gov.co`, un producto de Avance Jurídico (la
 * misma casa editorial de SUIN-Juriscol). Ese sitio es, a su vez, un libro
 * estático de páginas HTML pre-compiladas —sin tabla ni buscador servido en el
 * propio HTML— salvo por una cosa: su "Herramientas de búsqueda" es una app
 * Angular (`<app-root>`) que sí habla con un backend real.
 *
 * El backend se encontró leyendo `compilacion/main_invima.js`: la app llama a
 * `https://normograma.info/prueba-invima/buscador/Buscar.ashx?&texto=...` y
 * recibe JSON plano, sin sesión ni token. `direccionAPI` está hardcodeada ahí
 * (el `configuracion.txt` que la app intenta leer primero da 404, así que usa
 * el valor por defecto). Se verificó con peticiones reales:
 *
 * - `texto=medicamentos` → 5765 resultados.
 * - Sin resultados, el backend NO da JSON: responde el cuerpo literal
 *   `"No se encontraron resultados."` con 200. Hay que distinguirlo del JSON
 *   antes de parsear.
 * - El motor exige el texto SIN tildes (`vacunación` da 0, `vacunacion` da
 *   671); de ahí `sinTildes`, igual que hace la propia app antes de llamarlo.
 * - Filtrar por año es un clausulado tipo Lucene que la propia app arma:
 *   `(year contains (2024~~2024))`, combinable con AND junto al texto libre.
 *
 * Lo importante para no prometer de más: esta base NO es solo lo que emite el
 * INVIMA. Es la compilación jurídica completa del sector que el INVIMA vigila
 * —leyes, decretos y resoluciones del Ministerio de Salud, conceptos, y hasta
 * sentencias de las altas cortes en la materia—, con 125 entidades distintas
 * en el campo `entidad` de una sola muestra. Filtrar aquí solo por
 * "entidad contains INVIMA" habría dejado fuera las actas de las Salas
 * Especializadas del propio INVIMA, que en el campo `entidad` no dicen
 * "INVIMA" sino el nombre de la sala ("Sala Especializada De Medicamentos"...).
 * Por eso no se filtra por entidad: se advierte del alcance real en vez de
 * fingir un recorte que rompería resultados legítimos.
 *
 * El buscador tampoco da fecha completa: el JSON solo trae `year`. El día y
 * el mes exigirían abrir cada ficha (`docs/...htm`), una petición extra por
 * resultado — se deja así de explícito en vez de aproximarlo.
 */
import { adaptadorNormograma } from './normograma.ts'

export default adaptadorNormograma({
  id: 'invima',
  nombre: 'INVIMA',
  sector: 'Salud — vigilancia sanitaria de medicamentos, alimentos y dispositivos médicos',
  portal: 'https://normograma.invima.gov.co/compilacion/herramientas_busqueda.html',
  dominioPermitido: 'https://normograma.invima.gov.co',
  tiposDocumento: ['Ley', 'Decreto', 'Resolución', 'Concepto', 'Sentencia'],
  advertencia:
    'Esta fuente NO es solo lo que emite el INVIMA: es la compilación jurídica completa del sector salud que ' +
    'el buscador de su normograma indexa (leyes, decretos y resoluciones del Ministerio de Salud, conceptos, ' +
    'jurisprudencia de las altas cortes, y las actas de las salas especializadas del propio INVIMA). El campo ' +
    '"tipo" de cada resultado dice de qué se trata; no asumas que todo es un acto del INVIMA. Los documentos son ' +
    'PDF o HTML sin texto extraíble aquí, y el buscador solo da el AÑO de cada acto, no el día ni el mes — para ' +
    'la fecha completa hay que abrir la ficha. No publica vigencia.',
  apiBase: 'https://normograma.info/prueba-invima/buscador/',
  docsBase: 'https://normograma.invima.gov.co/compilacion/docs/',
  soportaAnio: true,
})
