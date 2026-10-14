/**
 * Consejo de Estado — SAMAI, buscador de providencias tituladas.
 *
 * Es la tercera alta corte y la única que no tiene API. Su buscador es ASP.NET
 * WebForms, así que la primera versión enviaba el formulario con su
 * `__VIEWSTATE` y el `__EVENTTARGET` del LinkButton de búsqueda. Funcionaba,
 * pero solo daba la primera página: avanzar exigía otro postback encadenado.
 *
 * La propia página ofrece la salida, en su botón «Copiar Link Permanente de
 * Búsqueda»: un GET a `ResultadoBuscadorProvidenciasTituladas.aspx` con la
 * consulta y el número de página en un JSON. Sin `__VIEWSTATE`, sin cookie y
 * sin POST. Se comprobó que devuelve exactamente las mismas providencias y en
 * el mismo orden que el postback —tres consultas distintas, radicado por
 * radicado— y que `PaginaActual` avanza de verdad, así que reemplaza a la
 * maquinaria anterior en vez de convivir con ella.
 *
 * SAMAI pagina en bloques de ~10 y no acepta un desplazamiento libre; por eso
 * esto se pide por página y no con el `desde` del resto de herramientas. Los
 * bloques no siempre traen 10 filas legibles, así que un `desde` exacto sería
 * un número inventado.
 *
 * ponytail: el canario cuenta radicados y lee el rótulo de paginación, nunca el
 * código HTTP. Aquí un 200 no significa nada —la página de error responde 200
 * con HTML—, y devolver vacío en silencio se leería como "no existe esa
 * sentencia".
 */
export { BUSCADOR, enlaceBusqueda, enlaceProvidencia } from './enlaces.ts'
export { contienenTodas, type Providencia, type Titulacion } from './providencia.ts'
export { buscar, porRadicado } from './busqueda.ts'
export { obtenerTexto, type TextoProvidencia } from './texto.ts'
