import { z } from 'zod'

import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import { clasificarValidacion, validarArticulo, validarNumeroAnio, validarUrl } from '../nucleo/evidencia.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Validar una cita y su enlace'

export const DESCRIPCION =
  'Comprueba que la cita (tipo, número, año y artículo, si se indica) coincide con lo que devuelve el Gestor ' +
  'Normativo y que el dominio del enlace es el esperado (funcionpublica.gov.co). Clasifica el resultado en ' +
  '"cita validada", "cita parcialmente validada" o "no fue posible validar". NUNCA afirma vigencia: para el ' +
  'estado de una norma usa resolver_cita.'

export const schema = {
  cita: z.string().optional().describe('Cita a validar, ej. "Ley 909 de 2004"'),
  citas: z
    .array(z.string())
    .optional()
    .describe('Lote de citas a validar en una llamada, ej. ["Ley 909 de 2004", "C-337/11"]'),
  // Sin .url(): una URL malformada se reporta como "no fue posible validar",
  // no como un error de esquema.
  url: z.string().optional().describe('Enlace a comprobar; si no se da, se usa el de la fuente'),
}

export const SIN_FORMA =
  'No fue posible validar: la cita no tiene forma de cita colombiana. Escríbela como "Ley 909 de 2004" o "C-337/11".'

/** El aviso de forma si `cita` no parsea; texto vacío si sí. */
export function sinForma(cita: string): string {
  return parsearCita(cita) ? '' : SIN_FORMA
}

/** Texto puro de un resultado de validación, inyectable para las pruebas. */
export function formatear(
  _cita: string,
  resultado: string,
  comprobaciones: { nombre: string; ok: boolean }[],
  encontrada?: { titulo: string; url: string },
): string {
  const lineas = comprobaciones.map((c) => `- ${c.nombre}: ${c.ok ? '✓' : '✗'}`)
  const cuerpo = encontrada
    ? [encontrada.titulo, encontrada.url]
    : ['Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.']
  return [`Resultado: ${resultado}`, ...lineas, ...cuerpo].join('\n')
}

/**
 * Valida UNA cita. Nunca lanza por la forma: una cita que no parsea devuelve
 * el aviso de forma y se sigue. Los errores de red sí pueden lanzar; quien
 * llama en lote los captura para que una cita no tumbe a las demás.
 * `buscar` y `obtenerNorma` son inyectables para probar sin red (patrón del repo).
 */
export async function resolverUna(
  cita: string,
  url?: string,
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma } = {},
): Promise<string> {
  const buscar = deps.buscar ?? gestor.buscar
  const obtenerNorma = deps.obtenerNorma ?? gestor.obtenerNorma
  const aviso = sinForma(cita)
  if (aviso) return aviso

  const c = parsearCita(cita)!
  const r = await buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  const item = r.items[0]
  if (!item) {
    return 'No fue posible validar: la cita no se encontró en el Gestor Normativo. Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.'
  }

  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return (
        `No fue posible validar: la cita "${cita}" es ambigua. El Gestor tiene ${ambiguos.length} normas con ese ` +
        `tipo y número, de años distintos; no se elige una por ti:\n` +
        ambiguos
          .sort((a, b) => Number(b.anio) - Number(a.anio))
          .map((x) => `- ${x.titulo} (id ${x.id})\n  ${x.url}`)
          .join('\n') +
        `\n\nRepite con el año ("${c.tipo} ${c.numero} de ${ambiguos[0]!.anio}").`
      )
    }
  }

  const comprobaciones: { nombre: string; ok: boolean }[] = [
    { nombre: 'número y año', ok: validarNumeroAnio(item.titulo, c.numero, c.anio) },
    // El dominio a comprobar es SIEMPRE el enlace que el usuario dio (si lo dio):
    // validar el del item cuando el usuario pasó uno ajeno sería un falso positivo.
    { nombre: 'dominio del enlace', ok: validarUrl(url ?? item.url, 'funcionpublica.gov.co') },
    // Si el usuario dio un enlace, además debe apuntar al MISMO id de la norma.
    ...(url ? [{ nombre: 'el enlace corresponde a esta norma', ok: url.includes(`i=${item.id}`) }] : []),
  ]
  if (c.articulo) {
    const norma = await obtenerNorma(item.id)
    comprobaciones.push({ nombre: 'artículo', ok: validarArticulo(norma.texto, c.articulo) })
  }
  return formatear(cita, clasificarValidacion(comprobaciones), comprobaciones, { titulo: item.titulo, url: item.url })
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
  args: { cita?: string; citas?: string[]; url?: string },
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma } = {},
): Promise<string> {
  if (args.citas?.length) {
    const bloques: string[] = []
    for (const cita of args.citas) bloques.push(await bloqueDe(cita, args.url, deps))
    return bloques.join('\n\n')
  }
  if (args.cita) return resolverUna(args.cita, args.url, deps)
  return 'Falta la cita: pásala en cita ("Ley 909 de 2004") o en citas (["Ley 909 de 2004", "C-337/11"]).'
}
