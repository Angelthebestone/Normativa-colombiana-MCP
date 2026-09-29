import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { idTipo, parsearCita, candidatosAmbiguos, type Cita } from '../nucleo/citas.ts'
import { clasificarValidacion, validarArticulo, validarNumeroAnio, validarUrl } from '../nucleo/evidencia.ts'
import { sinTildes } from '../nucleo/parse.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Validar una cita y su enlace'

export const DESCRIPCION =
  'Comprueba que la cita (tipo, número, año y artículo, si se indica) coincide con lo que devuelve el Gestor ' +
  'Normativo y que el dominio del enlace es el esperado (funcionpublica.gov.co). Clasifica el resultado en ' +
  '"cita validada", "cita parcialmente validada" o "no fue posible validar". NUNCA afirma vigencia: para el ' +
  'estado de una norma usa resolver_cita. Con formato="json" devuelve, para una cita, un objeto con ' +
  'fecha_consulta, estado y detalle (o resultado, comprobaciones y encontrada si se validó); para un lote, un ' +
  'objeto {fecha_consulta, resultados:[...]} con un resultado por cita. Una cita sin forma, ambigua o con la ' +
  'fuente caída NUNCA lanza: sale como objeto con estado y detalle.'

export const schema = estricto({
  cita: z.string().optional().describe('Cita a validar, ej. "Ley 909 de 2004"'),
  citas: z
    .array(z.string())
    .optional()
    .describe('Lote de citas a validar en una llamada, ej. ["Ley 909 de 2004", "C-337/11"]'),
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

/** Fecha de la consulta en AAAA-MM-DD: la que el envoltorio ya no añade en modo json. */
const hoy = () => new Date().toISOString().slice(0, 10)

export type Comprobacion = { nombre: string; ok: boolean }

/**
 * Los datos de validar UNA cita, antes de darles forma. El texto y el json
 * salen de aquí: partirlos evita reescribir la lógica dos veces. `estado` es el
 * discriminador y el que lleva el json; los casos de error (sin forma, no
 * encontrada, ambigua, fuente caída) traen `detalle` y nunca lanzan.
 */
export type DatosCita =
  | { estado: 'sin-forma'; cita: string; detalle: string }
  | { estado: 'no-encontrada'; cita: string; detalle: string }
  | {
      estado: 'ambigua'
      cita: string
      detalle: string
      candidatos: { titulo: string; id: string; anio: string; url: string }[]
    }
  | { estado: 'fuente-caida'; cita: string; detalle: string }
  | {
      estado: 'validada' | 'parcialmente-validada' | 'no-validada'
      cita: string
      /** El veredicto en las palabras de siempre ("cita validada", …). */
      resultado: string
      comprobaciones: Comprobacion[]
      encontrada?: { titulo: string; url: string }
      nota?: string
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
  nota?: string,
): string {
  const lineas = comprobaciones.map((c) => `- ${c.nombre}: ${c.ok ? '✓' : '✗'}`)
  const cuerpo = encontrada
    ? [encontrada.titulo, encontrada.url]
    : ['Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.']
  return [`Resultado: ${resultado}`, ...lineas, ...(nota ? [nota] : []), ...cuerpo].join('\n')
}

/**
 * Busca en el Gestor corrigiendo el tipo escrito, que casi nunca es el oficial:
 * «Decreto 1567 de 1998» no existe, pero «Decreto Ley 1567 de 1998» sí. Se
 * reintenta sin filtrar por tipo, PERO solo se acepta si el tipo oficial
 * contiene al escrito: número y año no identifican una norma —existen a la vez
 * la Ley 1541 de 2012 y el Decreto 1541 de 2012—, y devolver el otro sería peor
 * que no encontrar nada, porque nadie sospecharía del cambio.
 *
 * Nació dentro de `resolverUnaCita` en index.ts y se mudó aquí porque index.ts
 * ya importa este módulo: dejarla allí y llamarla desde aquí sería un ciclo de
 * imports. Compartirla es justo el arreglo: sin ella el lote con validar=true
 * respondía «no fue posible validar» a «Decreto 624 de 1989» mientras la
 * consulta individual devolvía el id 6533.
 */
export async function buscarCorrigiendoTipo(
  c: Cita,
  buscar: typeof gestor.buscar = gestor.buscar,
): Promise<{
  r: Awaited<ReturnType<typeof gestor.buscar>>
  /** Tipo oficial cuando el escrito se quedó corto; vacío si no hubo corrección. */
  tipoOficial: string
  /** Norma homónima de OTRO tipo que sí tiene el Gestor; pista para explicar el vacío. */
  otroTitulo: string
}> {
  const r = await buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  if (r.items.length || !c.anio) return { r, tipoOficial: '', otroTitulo: '' }

  const sinTipo = await buscar({ numero: c.numero, anio: c.anio })
  const real = sinTipo.items[0]?.titulo.match(/^(.+?)\s+\d/)?.[1]?.trim()
  if (!real) return { r, tipoOficial: '', otroTitulo: '' }
  if (new RegExp(`\\b${sinTildes(c.tipo).toLowerCase()}\\b`, 'i').test(sinTildes(real).toLowerCase())) {
    return { r: sinTipo, tipoOficial: real, otroTitulo: '' }
  }
  // No se corta aquí: la norma puede existir en SUIN aunque el Gestor solo
  // tenga la homónima de otro tipo. La pista se guarda para el vacío.
  return { r, tipoOficial: '', otroTitulo: sinTipo.items[0]!.titulo }
}

/**
 * Valida UNA cita y devuelve sus DATOS. Nunca lanza por la forma: una cita que
 * no parsea sale como `sin-forma`. Los errores de red sí pueden lanzar; quien
 * llama en lote los captura para que una cita no tumbe a las demás.
 * `buscar` y `obtenerNorma` son inyectables para probar sin red (patrón del repo).
 */
export async function calcularDatos(
  cita: string,
  url?: string,
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma } = {},
): Promise<DatosCita> {
  const buscar = deps.buscar ?? gestor.buscar
  const obtenerNorma = deps.obtenerNorma ?? gestor.obtenerNorma
  const aviso = sinForma(cita)
  if (aviso) return { estado: 'sin-forma', cita, detalle: aviso }

  const c = parsearCita(cita)!
  const { r, tipoOficial } = await buscarCorrigiendoTipo(c, buscar)
  const item = r.items[0]
  if (!item) {
    return {
      estado: 'no-encontrada',
      cita,
      detalle:
        'No fue posible validar: la cita no se encontró en el Gestor Normativo. Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.',
    }
  }

  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      const candidatos = [...ambiguos].sort((a, b) => Number(b.anio) - Number(a.anio))
      return {
        estado: 'ambigua',
        cita,
        candidatos,
        detalle:
          `No fue posible validar: la cita "${cita}" es ambigua. El Gestor tiene ${ambiguos.length} normas con ese ` +
          `tipo y número, de años distintos; no se elige una por ti:\n` +
          candidatos.map((x) => `- ${x.titulo} (id ${x.id})\n  ${x.url}`).join('\n') +
          `\n\nRepite con el año ("${c.tipo} ${c.numero} de ${candidatos[0]!.anio}").`,
      }
    }
  }

  const comprobaciones: Comprobacion[] = [
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
  // La corrección de tipo se anuncia: la cita se validó contra otra forma de
  // escribirla, y quien la use en un escrito debe escribir la oficial.
  const nota = tipoOficial ? `No existe un «${c.tipo} ${c.numero} de ${c.anio}»; el tipo oficial es «${tipoOficial}».` : ''
  const resultado = clasificarValidacion(comprobaciones)
  const estado =
    resultado === 'cita validada' ? 'validada' : resultado === 'cita parcialmente validada' ? 'parcialmente-validada' : 'no-validada'
  return {
    estado,
    cita,
    resultado,
    comprobaciones,
    encontrada: { titulo: item.titulo, url: item.url },
    ...(nota ? { nota } : {}),
  }
}

/** El texto de siempre para unos datos. Cada rama reproduce su salida previa. */
export function textoDeDatos(d: DatosCita): string {
  switch (d.estado) {
    case 'sin-forma':
    case 'no-encontrada':
    case 'ambigua':
    case 'fuente-caida':
      return d.detalle
    default:
      return formatear(d.cita, d.resultado, d.comprobaciones, d.encontrada, d.nota)
  }
}

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
  const json = args.formato === 'json'
  if (args.citas?.length) {
    if (json) {
      // Un solo objeto con un resultado por cita: un fallo de una no tumba al resto.
      const resultados: DatosCita[] = []
      for (const cita of args.citas) resultados.push(await calcularDatosSeguro(cita, args.url, deps))
      return JSON.stringify({ fecha_consulta: hoy(), resultados })
    }
    const bloques: string[] = []
    for (const cita of args.citas) bloques.push(await bloqueDe(cita, args.url, deps))
    return bloques.join('\n\n')
  }
  if (args.cita) {
    if (json) {
      const d = await calcularDatosSeguro(args.cita, args.url, deps)
      return JSON.stringify({ fecha_consulta: hoy(), ...d })
    }
    return resolverUna(args.cita, args.url, deps)
  }
  const falta = 'Falta la cita: pásala en cita ("Ley 909 de 2004") o en citas (["Ley 909 de 2004", "C-337/11"]).'
  if (json) return JSON.stringify({ fecha_consulta: hoy(), estado: 'sin-cita', detalle: falta })
  return falta
}
