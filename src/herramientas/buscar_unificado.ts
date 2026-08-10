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
import { conAlternativas } from '../nucleo/alternativas.ts'

export const TITULO = 'Buscar en varias fuentes a la vez'

export const DESCRIPCION =
  'Busca en paralelo en las fuentes ya existentes (Gestor Normativo, Corte Constitucional, SUIN-Juriscol y ' +
  'DIAN) y agrega los resultados con su fuente y su enlace. Úsala cuando la consulta es abierta o por materia ' +
  'y no hay una herramienta obvia; para una cita exacta sigue siendo mejor resolver_cita, y para un tribunal ' +
  'concreto su buscador propio. Cada resultado declara de qué fuente salió; la vigencia de SUIN se rotula ' +
  'SEGÚN EL BUSCADOR y no es la ficha oficial.'

export const schema = {
  texto: z.string().describe('Términos a buscar, ej. "teletrabajo"'),
  perfil: z
    .enum(['laboral', 'tributario', 'ambiental', 'contratacion', 'energia'])
    .optional()
    .describe('Perfil sectorial: prioriza la fuente que mejor responde a ese sector (tributario → DIAN)'),
  fuentes: z
    .array(z.enum(['gestor', 'corte', 'suin', 'dian']))
    .optional()
    .describe('Fuentes a consultar; sin él se usan todas menos DIAN (que va con perfil=tributario)'),
  limite: z.coerce.number().int().min(1).max(30).default(15).describe('Cuántos resultados por fuente (máximo 30)'),
}

const schemaCompleto = z.object(schema)
type Parametros = z.infer<typeof schemaCompleto>

export type Item = { fuente: string; titulo: string; url: string; detalle?: string }

const FUENTES = ['gestor', 'corte', 'suin', 'dian'] as const
export type Fuente = (typeof FUENTES)[number]

/** Qué fuentes consultar según perfil y filtro explícito. */
export function fuentesDe(perfil: string | undefined, fuentes: Fuente[] | undefined): Fuente[] {
  if (fuentes?.length) return fuentes
  // Sin perfil, la DIAN se deja fuera: su buscador tarda ~20 s y su materia
  // (tributario) tiene herramienta propia. Con perfil tributario entra.
  if (perfil === 'tributario') return [...FUENTES]
  return ['gestor', 'corte', 'suin']
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

const POR_FUENTE: Record<Fuente, (texto: string, limite: number) => Promise<Item[]>> = {
  gestor: porGestor,
  corte: porCorte,
  suin: porSuin,
  dian: porDian,
}

/** Orden de presentación: tributario prioriza DIAN; el resto, Gestor primero. */
function ordenar(items: Item[], perfil?: string): Item[] {
  const peso: Record<string, number> = { gestor: 0, 'corte-constitucional': 1, suin: 2, dian: 3 }
  if (perfil === 'tributario') peso['dian'] = -1
  return items.sort((a, b) => (peso[a.fuente] ?? 9) - (peso[b.fuente] ?? 9))
}

export function formatear(resultados: Record<Fuente, Item[]>, texto: string, perfil?: string): string {
  const vacias = (Object.keys(resultados) as Fuente[]).filter((f) => !resultados[f].length)
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
      `Sin resultados en: ${vacias.join(', ')}.`,
      'Un vacío en una fuente NO significa que la norma no exista; para una cita exacta usa resolver_cita.',
    )
  }
  return bloque.join('\n')
}

export async function escribir(
  params: Parametros,
  deps: { porFuente?: Record<Fuente, (texto: string, limite: number) => Promise<Item[]>> } = {},
): Promise<string> {
  const porFuente = deps.porFuente ?? POR_FUENTE
  const fuentes = fuentesDe(params.perfil, params.fuentes)
  const limite = Math.min(params.limite ?? 15, 30)
  const resultado: Record<Fuente, Item[]> = { gestor: [], corte: [], suin: [], dian: [] }

  await Promise.all(
    fuentes.map(async (f) => {
      try {
        resultado[f] = await porFuente[f](params.texto, limite)
      } catch {
        // Una fuente caída no tumba el resto: se deja vacía y se explica.
        resultado[f] = []
      }
    }),
  )

  // Solo se declaran vacíos de las fuentes que SÍ se consultaron: un filtro
  // explícito (fuentes=["corte"]) no debe reportar "sin resultados" en las
  // que nunca se pidieron.
  const consultadas = Object.fromEntries(fuentes.map((f) => [f, resultado[f]])) as Record<Fuente, Item[]>
  return formatear(consultadas, params.texto, params.perfil)
}
