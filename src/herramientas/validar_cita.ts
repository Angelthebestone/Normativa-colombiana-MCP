import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { fechaBogota } from '../nucleo/fecha.ts'
import type * as gestor from '../fuentes/gestor/index.ts'
import { calcularDatos, textoDeDatos, type DatosCita } from './validar_cita/datos.ts'

export const TITULO = 'Validar una cita y su enlace'

/**
 * Tope del lote de citas, aquí y en resolver_cita. Cada cita es al menos una
 * consulta al Gestor, en serie y al ritmo por dominio de `pedir`: sin tope, un
 * lote arbitrario ocupa la herramienta y la fuente todo lo que quiera quien
 * llama. Veinte cubren las citas de un escrito corriente; uno más largo se
 * parte en varias llamadas.
 */
export const MAX_LOTE = 20

/** El lote: no vacío y con tope. Lo comparten validar_cita y resolver_cita. */
export const loteDeCitas = z
  .array(z.string())
  .min(1, 'El lote citas está vacío: pasa al menos una cita, o usa cita para una sola.')
  .max(MAX_LOTE, `El lote citas admite como mucho ${MAX_LOTE} citas: parte el lote en varias llamadas.`)

/**
 * Una cita o un lote, no las dos. Antes se aceptaban las dos y el lote
 * descartaba la cita suelta: la llamada parecía validar ambas y solo validaba
 * el lote. Se comprueba en el handler y no con un `superRefine` en el esquema
 * porque el SDK publica como `inputSchema` vacío todo lo que no sea un
 * `ZodObject` (medido con `tools/list`): el cliente perdería los campos. El
 * error sale igual antes de tocar la red, con el mismo mensaje.
 */
export function unaViaDeCita(p: { cita?: string | undefined; citas?: string[] | undefined }): void {
  if (p.cita !== undefined && p.citas !== undefined) {
    throw new Error('Usa cita (una) o citas (un lote), no las dos: mete la cita suelta dentro de citas.')
  }
}

export const DESCRIPCION =
  'Comprueba que la cita (tipo, número, año y artículo, si se indica) coincide con lo que devuelve el Gestor ' +
  'Normativo y que el dominio del enlace es el esperado (funcionpublica.gov.co). Clasifica el resultado en ' +
  '"cita validada", "cita parcialmente validada" o "no fue posible validar". NUNCA afirma vigencia: para el ' +
  'estado de una norma usa resolver_cita. Con formato="json" devuelve, para una cita, un objeto con ' +
  'fecha_consulta, estado y detalle (o resultado, comprobaciones y encontrada si se validó); para un lote, un ' +
  'objeto {fecha_consulta, resultados:[...]} con un resultado por cita. Una cita sin forma, ambigua o con la ' +
  'fuente caída NUNCA lanza: sale como objeto con estado y detalle. Se pasa cita o citas, nunca las dos; el ' +
  `lote lleva entre 1 y ${MAX_LOTE} citas.`

export const schema = estricto({
  cita: z.string().optional().describe('Cita a validar, ej. "Ley 909 de 2004"'),
  citas: loteDeCitas
    .optional()
    .describe(`Lote de 1 a ${MAX_LOTE} citas a validar en una llamada, ej. ["Ley 909 de 2004", "C-337/11"]`),
  // Sin .url(): una URL malformada se reporta como "no fue posible validar",
  // no como un error de esquema.
  url: z.string().optional().describe('Enlace a comprobar; si no se da, se usa el de la fuente'),
  formato: z
    .enum(['markdown', 'json'])
    .default('markdown')
    .describe(
      'Salida: "markdown" (texto legible, por defecto) o "json" (un objeto por cita, sin cabecera ni pie)',
    ),
})


/**
 * El texto de validar UNA cita: `calcularDatos` + `textoDeDatos`. Los errores
 * de red siguen lanzando aquí (el modo markdown no cambia); el json los
 * convierte en `fuente-caida`.
 */
export async function resolverUna(
  cita: string,
  url?: string,
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma } = {},
): Promise<string> {
  return textoDeDatos(await calcularDatos(cita, url, deps))
}

/** Igual que `calcularDatos`, pero un fallo de red se vuelve `fuente-caida` en vez de lanzar. */
async function calcularDatosSeguro(
  cita: string,
  url: string | undefined,
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma },
): Promise<DatosCita> {
  try {
    return await calcularDatos(cita, url, deps)
  } catch (e) {
    return {
      estado: 'fuente-caida',
      cita,
      detalle:
        `No fue posible validar: la fuente no respondió en esta consulta (${(e as Error).message}). ` +
        `Vuelve a intentarlo antes de afirmar nada.`,
    }
  }
}

/**
 * Un bloque por cita del lote: su veredicto y su enlace. Un fallo de red de
 * una cita se anota en su bloque y no tumba al resto del lote.
 */
async function bloqueDe(
  cita: string,
  url: string | undefined,
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma },
): Promise<string> {
  try {
    const veredicto = await resolverUna(cita, url, deps)
    const enlace = veredicto.match(/https?:\/\/\S+/)?.[0] ?? '(sin enlace)'
    return `### ${cita}\n${veredicto}\nEnlace: ${enlace}`
  } catch (e) {
    return (
      `### ${cita}\nNo fue posible validar: la fuente no respondió en esta consulta (${(e as Error).message}). ` +
      `Vuelve a intentarlo antes de afirmar nada.\nEnlace: (sin enlace)`
    )
  }
}

export async function escribir(
  args: { cita?: string; citas?: string[]; url?: string; formato?: 'markdown' | 'json' },
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma } = {},
): Promise<string> {
  unaViaDeCita(args)
  const json = args.formato === 'json'
  if (args.citas?.length) {
    if (json) {
      // Un solo objeto con un resultado por cita: un fallo de una no tumba al resto.
      const resultados: DatosCita[] = []
      for (const cita of args.citas) resultados.push(await calcularDatosSeguro(cita, args.url, deps))
      return JSON.stringify({ fecha_consulta: fechaBogota(), resultados })
    }
    const bloques: string[] = []
    for (const cita of args.citas) bloques.push(await bloqueDe(cita, args.url, deps))
    return bloques.join('\n\n')
  }
  if (args.cita) {
    if (json) {
      const d = await calcularDatosSeguro(args.cita, args.url, deps)
      return JSON.stringify({ fecha_consulta: fechaBogota(), ...d })
    }
    return resolverUna(args.cita, args.url, deps)
  }
  const falta = 'Falta la cita: pásala en cita ("Ley 909 de 2004") o en citas (["Ley 909 de 2004", "C-337/11"]).'
  if (json) return JSON.stringify({ fecha_consulta: fechaBogota(), estado: 'sin-cita', detalle: falta })
  return falta
}
