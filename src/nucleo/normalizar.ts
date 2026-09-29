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
 *
 * Arregla también el otro mensaje inútil de zod: cuando falta un campo
 * obligatorio dice «Required» a secas, teniendo la explicación del campo en su
 * propio `.describe()` a un palmo. Se saca de ahí.
 *
 * Eso NO se puede hacer desde el `errorMap` del objeto, y está medido: un
 * `invalid_type` por valor ausente lo levanta el esquema del CAMPO, no el del
 * objeto, así que el mapa del padre nunca lo ve y el mensaje sigue siendo
 * «Required». La vía que funciona es poner el `required_error` en cada campo, y
 * es lo que hace `conAviso` clonando el `_def` —el mismo truco que usa
 * internamente `.describe()` de zod— para no tener que repetirlo a mano en cada
 * uno de los campos obligatorios de las 28 herramientas.
 *
 * Lo mismo vale para el otro «Invalid» sin explicación: un valor que viola un
 * `.regex()` —«04» donde va un año, «01/01/2020» donde va AAAA-MM-DD— se rechaza
 * sin decir el valor ni qué se esperaba. Son 12 campos, y el mensaje sale igual
 * de la descripción del campo.
 */
function conAviso(campo: string, v: z.ZodTypeAny): z.ZodTypeAny {
  const sobre = v.description ? `: ${v.description.replace(/\.$/, '')}` : ''
  const mapa: z.ZodErrorMap = (issue, ctx) => {
    if (issue.code === z.ZodIssueCode.invalid_type && issue.received === z.ZodParsedType.undefined) {
      return { message: `Falta "${campo}", que es obligatorio${sobre}.` }
    }
    if (issue.code === z.ZodIssueCode.invalid_string && issue.validation === 'regex') {
      // `z.coerce.string()` convierte un campo AUSENTE en la cadena "undefined" antes de
      // validar: lo que llega aquí no es un valor mal escrito sino un campo que falta, y
      // decir «Valor «undefined» no válido» afirmaría lo contrario de lo que pasa.
      if (ctx.data === 'undefined') return { message: `Falta "${campo}", que es obligatorio${sobre}.` }
      return { message: `Valor «${String(ctx.data)}» no válido para "${campo}"${sobre}.` }
    }
    return { message: ctx.defaultError }
  }
  return conMapa(v, mapa)
}

/**
 * Pone el `errorMap` en el tipo que de verdad levanta el error: la HOJA. Un
 * `.optional()`, un `.default()` o un `z.preprocess` solo envuelven al tipo
 * real, y el mapa de un envoltorio no llega al esquema que valida por dentro
 * (medido: el `required_error` puesto en el `ZodOptional` no se veía nunca).
 */
function conMapa(v: z.ZodTypeAny, mapa: z.ZodErrorMap): z.ZodTypeAny {
  const def = v._def as { innerType?: z.ZodTypeAny; schema?: z.ZodTypeAny }
  const Tipo = v.constructor as new (def: unknown) => z.ZodTypeAny
  if (def.innerType) return new Tipo({ ...def, innerType: conMapa(def.innerType, mapa) })
  if (def.schema) return new Tipo({ ...def, schema: conMapa(def.schema, mapa) })
  return new Tipo({ ...def, errorMap: mapa })
}

export function estricto<S extends z.ZodRawShape>(shape: S): z.ZodObject<S, 'strict'> {
  const claves = Object.keys(shape).join(', ')
  const avisado = Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, conAviso(k, v)])) as S
  return z
    .object(avisado, {
      errorMap: (issue, ctx) =>
        issue.code === z.ZodIssueCode.unrecognized_keys
          ? { message: `${ctx.defaultError}. Los campos de esta herramienta son: ${claves}.` }
          : { message: ctx.defaultError },
    })
    .strict()
}
