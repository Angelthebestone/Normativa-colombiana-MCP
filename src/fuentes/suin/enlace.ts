/**
 * Dirección pública del documento: la clásica de SUIN, con el id que el propio
 * buscador nuevo usa en sus enlaces (`visualizacion`). Hoy sirve la SPA vacía,
 * pero es el identificador con el que el documento se cita y el único enlace
 * público: el del portal nuevo apunta a una dirección privada.
 */
export const enlaceSuin = (id: string | number): string => `https://www.suin-juriscol.gov.co/viewDocument.asp?id=${id}`


/** Lo que se dice cuando haría falta el texto de un documento de SUIN. */
export const TEXTO_NO_PUBLICO =
  'SUIN-Juriscol no sirve hoy el texto de sus documentos fuera de la red del Ministerio de Justicia (medido el ' +
  '2026-09-24: su visor lo pide a una dirección privada y la página queda en blanco), así que el articulado no ' +
  'se puede leer ni aquí ni en el enlace.'

export const claveSuin = (tipo: string, numero: string, anio: string): string =>
  `${tipo.toLowerCase()} ${Number(numero)} ${anio}`

