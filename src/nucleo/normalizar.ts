/**
 * Lo que hay que enderezar de una llamada ANTES de validarla, en un solo sitio.
 *
 * Quien invoca estas herramientas es un modelo de lenguaje, y se equivoca
 * siempre de las mismas maneras. La peor no es mandar algo que el esquema
 * rechaza —eso se ve y se corrige—, sino mandar algo que el esquema ACEPTA y
 * que significa otra cosa: `articulo: "Art. 6º"` pasa como texto, viaja tal cual
 * al portal y no encuentra nada, sin que nadie avise de por qué.
 *
 * Medido con el corpus de `test/llamadas-torcidas.ts`: de 54 llamadas torcidas,
 * 11 se aceptaban mal, y 4 de ellas eran exactamente esto.
 */

/**
 * El número de artículo tal y como lo escribe un abogado → el que entiende el
 * portal. Quita el rótulo («art.», «artículo», con o sin tilde y en cualquier
 * caja) y el ordinal pegado al número («6º», «6°»).
 *
 * Lo que NO toca, porque son números de artículo legítimos: los compuestos con
 * puntos («2.4.1.2.44», los decretos únicos), los que llevan guion («771-5») y
 * los que acaban en letra («13A»). Y si lo que llega no es texto, se devuelve
 * intacto para que el esquema dé su propio error en vez de uno inventado aquí.
 */
export function numeroDeArticulo(v: unknown): unknown {
  if (typeof v !== 'string') return v
  const limpio = v
    .trim()
    .replace(/^art[íi]?c?u?l?o?s?\s*\.?\s*/i, '')
    .replace(/[º°]\s*$/, '')
    .trim()
  // Si quitar el rótulo lo deja vacío, no era un rótulo: se devuelve lo que vino
  // y que sea el esquema quien lo rechace con su mensaje.
  return limpio === '' ? v : limpio
}
