/**
 * SUIN-Juriscol (Ministerio de Justicia).
 *
 * Existe por una sola razón: es la única fuente oficial del país que publica el
 * ESTADO DE VIGENCIA como dato. Ni el Gestor Normativo ni la relatoría lo
 * tienen, y por eso hasta ahora ninguna respuesta podía decir si una norma
 * sigue vigente.
 *
 * El portal se rehízo entre el 2026-09-16 y el 2026-09-24 (medido): hasta el 16
 * respondía 301 a todo; desde entonces `www.suin-juriscol.gov.co` es una SPA de
 * Angular que sirve la MISMA página vacía de 4.758 bytes a cualquier ruta,
 * `viewDocument.asp?id=` incluida, así que la ficha HTML con sus
 * `<span field="…">` ya no existe. Lo que hay ahora:
 *
 * - La FICHA sale del índice de Elasticsearch que consulta el buscador nuevo
 *   (`lexis.minjusticia.gov.co/elasticsearch/documents_stg`), público y sin
 *   clave: 64.792 decretos y 11.094 leyes con `tipo`, `subtipo`, `numero`,
 *   `anio`, `epigrafe` y `estado`. Ese `estado` ES el campo de la ficha vieja:
 *   la Ley 74 de 1923 da "Derogado" (la ficha decía DEROGADO; el índice de Azure
 *   dice "Vigencia en Estudio") y la Ley 1541 de 2012 "Vigencia en Estudio" (el
 *   campo de la ficha, no la prosa "Vigente"). Y trae decretos, que el índice
 *   empaquetado casi no tenía: la vigencia de un decreto deja de ser "no consta".
 * - Ese índice LLEGA HASTA 2020: el año más alto con documentos es 2020 (737), y
 *   la Ley 2124 de 2021 o la 2281 de 2023 no están. Una norma posterior sale
 *   "no consta" diciendo por qué; no se corta por año en el código, para que el
 *   día que carguen lo reciente se lea sin tocar nada.
 * - El TEXTO no se puede leer desde fuera: el visor nuevo lo pide a
 *   `http://192.168.8.64:10015` y los enlaces del buscador apuntan a
 *   `http://192.168.8.145/viewDocument.asp`, direcciones de red privada. Medido
 *   con un navegador: la página carga, la petición del texto no termina y el
 *   cuerpo queda con 0 caracteres. Se devuelve la ficha y se dice que el texto
 *   no está al alcance.
 */
export { enlaceSuin, claveSuin, TEXTO_NO_PUBLICO } from './enlace.ts'
export { fichasDe, esLaPedida, ficha, type Ficha, type RespuestaFichas, type EstadoFicha } from './ficha.ts'
export { buscar, type ResultadoSuin } from './buscador.ts'
export { coberturaIndice, buscarEnIndice } from './indice.ts'
export { buscarEnSuin } from './busqueda.ts'
