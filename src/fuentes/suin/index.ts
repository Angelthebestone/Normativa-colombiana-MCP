/**
 * SUIN-Juriscol (Ministerio de Justicia).
 *
 * Existe por una sola razón: es la única fuente oficial del país que publica el
 * ESTADO DE VIGENCIA como dato. Ni el Gestor Normativo ni la relatoría lo
 * tienen, y por eso hasta ahora ninguna respuesta podía decir si una norma
 * sigue vigente.
 *
 * El portal se rehízo en septiembre de 2026 y volvió a cambiar en octubre
 * (medido el 2026-10-14). `www.suin-juriscol.gov.co` sigue siendo una SPA que
 * sirve la misma página vacía a cualquier ruta; lo vivo está en
 * `lexis.minjusticia.gov.co`, cuyo front (`buscador/Detallado/{1,2,3}`:
 * reglamentos técnicos, jurisprudencia y normas) habla con dos backends
 * públicos y sin clave:
 *
 * - El índice de Elasticsearch `documents_pdn` (antes `documents_stg`, que
 *   sigue respondiendo con una carga vieja de 82.445 documentos que se cortaba
 *   en 2020). `documents_pdn` tiene 103.326 documentos cargados el 2026-10-02 y
 *   llega a 2026 (1.078 normas de ese año): la Ley 2124 de 2021 y la 2281 de
 *   2023 ya están. `configid` separa las colecciones: 30 normas (89.879: leyes,
 *   decretos, resoluciones, circulares, directivas…), 200 Corte Constitucional
 *   (7.609), 100 Consejo de Estado (3.483) y 300 Corte Suprema (2.355). Su
 *   `estado` ES el campo de la ficha: la Ley 74 de 1923 da "Derogado" y la Ley
 *   1541 de 2012 "Vigencia en Estudio". Los reglamentos técnicos no son otra
 *   colección: el front los filtra por `materia` dentro de las normas.
 * - `suin-search/api/documentos/{id}`, que devuelve el documento entero en
 *   `textoHtml` (la Ley 909 de 2004: 175.015 caracteres) con el articulado, el
 *   resumen de modificaciones por artículo, el de jurisprudencia y el estado
 *   de vigencia. Un id inexistente da 204 sin cuerpo. Es lo que pinta el visor
 *   `lexis.minjusticia.gov.co/minjusticia/viewDocument/{id}` (medido con un
 *   navegador: 97.221 caracteres en su iframe), así que el TEXTO de SUIN vuelve
 *   a leerse; hasta el 2026-09-24 el visor lo pedía a una dirección privada.
 */
export { enlaceSuin, claveSuin } from './enlace.ts'
export { COLECCIONES, type Coleccion, type RespuestaFichas } from './elasticsearch.ts'
export { fichasDe, esLaPedida, ficha, type Ficha, type EstadoFicha } from './ficha.ts'
export { buscar, consultaBusqueda, resultadosDe, type ResultadoSuin } from './buscador.ts'
export { documento, documentoDe, type Afectacion, type DocumentoSuin } from './documento.ts'
export { coberturaIndice, buscarEnIndice } from './indice.ts'
export { buscarEnSuin } from './busqueda.ts'
