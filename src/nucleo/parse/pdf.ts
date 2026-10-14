// --- documentos sin texto extraíble --------------------------------------

/**
 * Un PDF sin fuentes incrustadas cuyas páginas son imágenes es un escaneo: no
 * hay texto que extraer, por mucho que el documento diga cosas.
 *
 * ponytail: se decide por marcadores, sin decodificar los flujos. El techo es
 * un PDF que use solo las 14 fuentes estándar sin incrustarlas; si aparece uno,
 * el salto siguiente es OCR, no un parser mejor.
 */
export function pdfEsEscaneo(pdf: string): boolean {
  if (!pdf.includes('%PDF')) return false
  return !/\/FontFile\d?\b/.test(pdf) && /\/(DCTDecode|CCITTFaxDecode|JPXDecode|JBIG2Decode)\b/.test(pdf)
}

/**
 * Ningún documento vacío se devuelve a secas. "No hay texto" y "el documento no
 * dice nada" son cosas distintas, y confundirlas es el error caro: quien
 * pregunta por una sentencia escaneada no puede concluir que no resolvió nada.
 */
export function avisoSinTexto(caracteres: number, url: string, escaneo = false): string {
  return escaneo
    ? 'Este documento es un ESCANEO: sus páginas son imágenes, no texto. Esta extensión no hace OCR, así que ' +
        `no se puede leer su contenido aquí — pero eso NO significa que el documento no diga nada. Consúltalo en ${url}`
    : `El documento está registrado pero no trae texto publicado (se recibieron ${caracteres} caracteres). ` +
        `NO significa que no diga nada: consúltalo en ${url}`
}
