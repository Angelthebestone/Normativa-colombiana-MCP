/**
 * Búsqueda federada `buscar_unificado`: una sola herramienta que agrega las
 * fuentes ya existentes (Gestor, Corte Constitucional, SUIN y DIAN) para que
 * el enrutado no dependa solo de las INSTRUCCIONES.
 *
 * Es orquestación, no un scraper nuevo: reutiliza `gestor.buscar/tematica`,
 * `corte.buscar`, `suin.buscar` y `dian.buscar`, con `conAlternativas` por
 * fuente cuando rinde 0. Cada resultado se etiqueta con su fuente y su URL, y
 * la vigencia de SUIN se rotula "SEGÚN EL BUSCADOR" sin reinterpretarla.
 *
 * Ranking trivial: `perfil=tributario` prioriza la DIAN; el resto sigue el
 * orden Gestor → Corte → SUIN → DIAN. No hay reranking LLM ni router: es un
 * fan-out explícito y testeable.
 */
import { z } from 'zod'

import * as gestor from '../fuentes/gestor.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'
import * as suin from '../fuentes/suin.ts'
import * as dian from '../fuentes/normograma.ts'
import { adaptador } from '../fuentes/sectorial.ts'
import { conAlternativas } from '../nucleo/alternativas.ts'
import { activa, alcance, proyectar } from '../nucleo/alcance.ts'

export const TITULO = 'Buscar en varias fuentes a la vez'

export const DESCRIPCION =
  'Busca en paralelo en Gestor Normativo, Corte Constitucional, SUIN-Juriscol y DIAN, y agrega los ' +
  'resultados con su fuente y su enlace (con perfil "salud" añade INVIMA y Supersalud; con "mineria", la ' +
  'ANM). Úsala cuando la consulta es abierta o por materia y no hay herramienta obvia; para una cita exacta ' +
  'sigue siendo mejor resolver_cita y para un tribunal concreto, su buscador propio. Cada resultado declara ' +
  'su fuente; la vigencia de SUIN se rotula SEGÚN EL BUSCADOR y no es la ficha oficial.'

/**
 * Clave de la línea de alcance para cada fuente consultable. Los tres
 * reguladores con nombre propio (INVIMA, Supersalud, ANM) comparten la clave
 * "sectorial", así que en la línea se funden en una sola entrada.
 */
const CLAVE_ALCANCE: Record<Fuente, string> = {
  gestor: 'gestor',
  corte: 'corte',
  suin: 'suin',
  dian: 'dian',
  invima: 'sectorial',
  supersalud: 'sectorial',
  anm: 'sectorial',
}

const FUENTES = ['gestor', 'corte', 'suin', 'dian', 'invima', 'supersalud', 'anm'] as const
export type Fuente = (typeof FUENTES)[number]

export const schema = {
  texto: z.string().describe('Términos a buscar, ej. "teletrabajo"'),
  perfil: z
    .enum(['laboral', 'tributario', 'ambiental', 'contratacion', 'energia', 'salud', 'mineria'])
    .optional()
    .describe(
      'Perfil sectorial: prioriza la fuente que mejor responde a ese sector (tributario → DIAN; salud → INVIMA ' +
        'y Supersalud; mineria → ANM)',
    ),
  fuentes: z
    // Solo las encendidas (FUENTES): pedir una apagada no se puede ni escribir.
    .array(z.enum(proyectar(FUENTES, (f) => CLAVE_ALCANCE[f])))
    .optional()
    .describe('Fuentes a consultar; sin él se usan todas menos DIAN (que va con perfil=tributario)'),
  limite: z.coerce.number().int().min(1).max(30).default(15).describe('Cuántos resultados por fuente (máximo 30)'),
}

const schemaCompleto = z.object(schema)
type Parametros = z.infer<typeof schemaCompleto>

export type Item = { fuente: string; titulo: string; url: string; detalle?: string }

const PERFILES_ADMITIDOS = ['laboral', 'tributario', 'ambiental', 'contratacion', 'energia', 'salud', 'mineria'] as const

/**
 * Qué fuentes consultar según perfil y filtro explícito. Las apagadas (FUENTES)
 * salen también de los perfiles: el perfil salud con los reguladores apagados
 * consulta lo demás y la línea de alcance dice cuáles faltan.
 */
export function fuentesDe(perfil: string | undefined, fuentes: Fuente[] | undefined): Fuente[] {
  if (fuentes?.length) return fuentes
  // Sin perfil, la DIAN se deja fuera: su buscador tarda ~20 s y su materia
  // (tributario) tiene herramienta propia. Con perfil tributario entra.
  const base: Fuente[] =
    perfil === 'tributario'
      ? ['gestor', 'corte', 'suin', 'dian']
      : perfil === 'salud'
        ? ['gestor', 'corte', 'suin', 'invima', 'supersalud']
        : perfil === 'mineria'
          ? ['gestor', 'corte', 'suin', 'anm']
          : ['gestor', 'corte', 'suin']
  return base.filter((f) => activa(CLAVE_ALCANCE[f]))
}

async function porGestor(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => gestor.buscar({ palabras: t }).then((r) => r.items),
    texto,
    1,
  )
  return items.slice(0, limite).map((i) => ({ fuente: 'gestor', titulo: i.titulo, url: i.url }))
}

async function porCorte(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => corte.buscar({ termino: t, limite }).then((r) => r.items),
    texto,
    1,
  )
  return items.slice(0, limite).map((p) => ({
    fuente: 'corte-constitucional',
    titulo: `${p.sentencia} (${p.tipo}, ${p.fecha})`,
    url: p.url,
    ...(p.sintesis ? { detalle: p.sintesis.slice(0, 200) } : {}),
  }))
}

async function porSuin(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => suin.buscar({ texto: t, limite }).then((r) => r.items),
    texto,
    1,
  )
  return items.slice(0, limite).map((d) => ({
    fuente: 'suin',
    titulo: d.titulo,
    url: d.url,
    ...(d.vigencia ? { detalle: `Vigencia SEGÚN EL BUSCADOR: ${d.vigencia}` } : {}),
  }))
}

async function porDian(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => dian.buscar(t, limite, 0).then((r) => r.items),
    texto,
    1,
  )
  return items.map((d) => ({
    fuente: 'dian',
    titulo: d.nombre,
    url: d.url,
    detalle: d.epigrafe,
  }))
}

/** Sectoriales de perfil: INVIMA, Supersalud y ANM se consultan con su adaptador. */
const porSectorial = (id: 'invima' | 'supersalud' | 'anm') => async (texto: string, limite: number): Promise<Item[]> => {
  const a = adaptador(id)
  if (!a) return []
  const r = await a.buscar({ texto, limite })
  return r.items.slice(0, limite).map((x) => ({
    fuente: id,
    titulo: `${x.tipo} ${x.numero}${x.anio ? ` de ${x.anio}` : ''}${x.epigrafe ? ` — ${x.epigrafe.slice(0, 120)}` : ''}`,
    url: x.url,
  }))
}

const POR_FUENTE: Record<Fuente, (texto: string, limite: number) => Promise<Item[]>> = {
  gestor: porGestor,
  corte: porCorte,
  suin: porSuin,
  dian: porDian,
  invima: porSectorial('invima'),
  supersalud: porSectorial('supersalud'),
  anm: porSectorial('anm'),
}

/** Orden de presentación: tributario prioriza DIAN; el resto, Gestor primero. */
function ordenar(items: Item[], perfil?: string): Item[] {
  const peso: Record<string, number> = { gestor: 0, 'corte-constitucional': 1, suin: 2, dian: 3, invima: 4, supersalud: 5, anm: 4 }
  if (perfil === 'tributario') peso['dian'] = -1
  return items.sort((a, b) => (peso[a.fuente] ?? 9) - (peso[b.fuente] ?? 9))
}

export function formatear(
  resultados: Partial<Record<Fuente, Item[]>>,
  texto: string,
  perfil?: string,
  /** Fallos por fuente (fuente → mensaje): se declaran como fallo, nunca como vacío. */
  fallidas: Partial<Record<Fuente, string>> = {},
): string {
  const consultadas = Object.keys(resultados) as Fuente[]
  const conFallo = new Set(Object.keys(fallidas) as Fuente[])
  const vacias = consultadas.filter((f) => !resultados[f]?.length && !conFallo.has(f))
  const lineas: string[] = []
  for (const item of ordenar(Object.values(resultados).flat(), perfil)) {
    lineas.push(`- [${item.fuente}] ${item.titulo}\n  ${item.url}${item.detalle ? `\n  ${item.detalle}` : ''}`)
  }
  const bloque = [
    `Resultados para "${texto}"${perfil ? ` (perfil ${perfil})` : ''}:`,
    ...(lineas.length ? lineas : ['  (sin resultados)']),
  ]
  if (vacias.length) {
    bloque.push(
      '',
      `Sin resultados en: ${vacias.join(', ')} (respondieron sin nada).`,
      'Un vacío en una fuente NO significa que la norma no exista; para una cita exacta usa resolver_cita.',
    )
  }
  const caidas = consultadas.filter((f) => conFallo.has(f))
  if (caidas.length) {
    bloque.push(
      '',
      `No se pudo consultar: ${caidas.map((f) => `${f} (${fallidas[f] ?? 'la fuente no respondió'})`).join('; ')}.`,
      'Esto es un FALLO de la fuente, no un vacío: no concluyas que no hay resultados ahí. Vuelve a intentarlo.',
    )
  }
  return bloque.join('\n')
}

export async function escribir(
  params: Parametros,
  deps: { porFuente?: Record<Fuente, (texto: string, limite: number) => Promise<Item[]>> } = {},
): Promise<string> {
  // Un perfil desconocido no debe ejecutar ningún fan-out: se lista lo admitido.
  if (params.perfil && !(PERFILES_ADMITIDOS as readonly string[]).includes(params.perfil)) {
    return (
      'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).\n\n' +
      `No existe el perfil "${params.perfil}". Disponibles: ${PERFILES_ADMITIDOS.join(', ')}.`
    )
  }
  const porFuente = deps.porFuente ?? POR_FUENTE
  const fuentes = fuentesDe(params.perfil, params.fuentes)
  const limite = Math.min(params.limite ?? 15, 30)
  const resultado = {} as Record<Fuente, Item[]>
  for (const f of FUENTES) resultado[f] = []
  const fallidas: Partial<Record<Fuente, string>> = {}

  await Promise.all(
    fuentes.map(async (f) => {
      try {
        resultado[f] = await porFuente[f](params.texto, limite)
      } catch (e) {
        // Una fuente caída no tumba el resto: se anota como FALLO con su
        // mensaje, no como vacío. Un vacío dice "respondió sin nada"; un fallo
        // dice "no se sabe qué hay ahí". En materia jurídica confundirlos es
        // afirmar que no hay jurisprudencia sobre algo.
        resultado[f] = []
        fallidas[f] = e instanceof Error ? e.message : String(e)
      }
    }),
  )

  // Solo se declaran vacíos de las fuentes que SÍ se consultaron: un filtro
  // explícito (fuentes=["corte"]) no debe reportar "sin resultados" en las
  // que nunca se pidieron.
  const consultadas = Object.fromEntries(fuentes.map((f) => [f, resultado[f]])) as Record<Fuente, Item[]>
  // La línea de alcance se arma de lo que de verdad se consultó: una entrada por
  // clave (INVIMA y Supersalud se funden en "sectorial"), con cuántos resultados
  // trajo cada una y "falló" para las que no respondieron. Las fuentes que no
  // están en `fuentes` quedan declaradas como no consultadas por `alcance`.
  const porClave = new Map<string, { n: number; fallo: boolean }>()
  for (const f of fuentes) {
    const visto = porClave.get(CLAVE_ALCANCE[f]) ?? { n: 0, fallo: false }
    if (fallidas[f]) visto.fallo = true
    else visto.n += resultado[f].length
    porClave.set(CLAVE_ALCANCE[f], visto)
  }
  const usadas = [...porClave].map(([clave, v]) => ({
    clave,
    detalle: v.fallo ? (v.n ? `${v.n} resultado(s) y un fallo` : 'falló') : `${v.n} resultado(s)`,
  }))
  return `${alcance(usadas)}\n\n${formatear(consultadas, params.texto, params.perfil, fallidas)}`
}
