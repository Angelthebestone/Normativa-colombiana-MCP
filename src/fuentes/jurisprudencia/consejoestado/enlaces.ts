export const BASE = 'https://samai.consejodeestado.gov.co'
export const RUTA = '/TitulacionRelatoria/ResultadoBuscadorProvidenciasTituladas.aspx'
/** Código del Consejo de Estado en SAMAI; va fijo en el enlace permanente. */
const CORPORACION = '1100103'
/** El buscador tal como lo abre una persona, para remitir a él. */
export const BUSCADOR = `${BASE}/TitulacionRelatoria/BuscadorProvidenciasTituladas.aspx`

/**
 * El enlace permanente que genera la propia página. Los paréntesis delimitan la
 * consulta en la sintaxis del buscador, así que los del término se quitan: uno
 * suelto la dejaría sin cerrar y SAMAI devolvería otra cosa sin avisar.
 *
 * Con `exacto=true` (default) la frase va ENTRE COMILLAS dentro del modo 'any':
 * medido, SAMAI no soporta `searchMode` 'phrase' ni 'and' (responden una página
 * de error sin el rótulo de paginación), pero sí interpreta las comillas como
 * frase exacta — "nulidad electoral" pasa de 1,1 MB a 449 KB de resultados y
 * conserva el rótulo. Con `false` se deja sin comillas (OR de palabras sueltas).
 */
export function enlaceBusqueda(texto: string, pagina: number, exacto = true): string {
  const consulta = texto.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()
  const dic = JSON.stringify({
    corporacion: CORPORACION,
    modo: '2',
    filtro: '',
    busqueda: exacto ? `("${consulta}")` : `(${consulta})`,
    searchMode: 'any',
    PaginaActual: String(Math.max(0, pagina)),
  })
  return `${BASE}${RUTA}?BusquedaDictionary=${encodeURIComponent(dic)}`
}

/** Página que abre la providencia con el token del buscador. No pide verificación. */
export const enlaceProvidencia = (token: string): string =>
  `${BASE}/PaginasTransversales/VerProvidencia.aspx?tokenDocumento=${token}`
