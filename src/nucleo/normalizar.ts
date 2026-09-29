/**
 * La puerta de entrada: lo que hay que enderezar de una llamada antes de
 * validarla, y cómo se rechaza lo que no tiene arreglo. Todo en un solo sitio.
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
import { z } from 'zod'

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

/**
 * El esquema de una herramienta, cerrado a campos que no existen y con un error
 * que dice las dos cosas que hacen falta para corregirlo: cuál sobra y cuáles
 * hay.
 *
 * Zod descarta en silencio lo que no reconoce, y ese silencio es el peor de los
 * fallos posibles aquí: quien manda `limit` en vez de `limite` cree que puso un
 * tope, recibe el de por defecto y no se entera. Medido en el corpus: cuatro de
 * las llamadas torcidas se aceptaban así.
 *
 * El `errorMap` conserva el mensaje de zod —que nombra la clave sobrante— y le
 * añade la lista de campos válidos. Con `.strict()` a secas solo se tiene lo
 * primero; con un mensaje propio, solo lo segundo.
 */
export function estricto<S extends z.ZodRawShape>(shape: S): z.ZodObject<S, 'strict'> {
  const claves = Object.keys(shape).join(', ')
  return z
    .object(shape, {
      errorMap: (issue, ctx) =>
        issue.code === z.ZodIssueCode.unrecognized_keys
          ? { message: `${ctx.defaultError}. Los campos de esta herramienta son: ${claves}.` }
          : { message: ctx.defaultError },
    })
    .strict()
}
