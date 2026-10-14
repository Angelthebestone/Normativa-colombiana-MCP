export const LEXIS = 'https://lexis.minjusticia.gov.co'

/**
 * Dirección pública del documento: el visor del portal nuevo, que sí pinta el
 * texto. La clásica `www.suin-juriscol.gov.co/viewDocument.asp?id=` (la que
 * aún devuelve el propio API en `url`) sirve la SPA vacía. El id es el clásico
 * de SUIN: el de `visualizacion` en el índice y el del índice empaquetado.
 */
export const enlaceSuin = (id: string | number): string => `${LEXIS}/minjusticia/viewDocument/${id}`

export const claveSuin = (tipo: string, numero: string, anio: string): string =>
  `${tipo.toLowerCase()} ${Number(numero)} ${anio}`
