import { pedir as http } from '../../../nucleo/http.ts'
import type { Providencia } from './providencia.ts'

export const BASE = 'https://www.corteconstitucional.gov.co/relatoria'
export const BUSCADOR = `${BASE}/buscador_new/`


export async function pedir(url: string): Promise<string> {
  let res: Awaited<ReturnType<typeof http>>
  try {
    res = await http(url, undefined, 'application/json,text/html,*/*')
  } catch (e) {
    throw new Error(`No se pudo contactar la relatoría de la Corte Constitucional (${(e as Error).message}).`)
  }
  // El sitio redirige a minúsculas; seguimos una sola vez.
  if (res.status >= 300 && res.status < 400) throw new Error(`La relatoría redirigió (${res.status}) para ${url}.`)
  if (res.status !== 200) throw new Error(`La relatoría de la Corte respondió ${res.status}.`)
  return res.cuerpo
}

/** Forma de la respuesta de Elasticsearch, tal como la reenvía la relatoría. */
export type FuenteES = {
  prov_id?: string | number
  prov_sentencia?: string
  prov_tipo?: string
  prov_f_sentencia?: string
  prov_f_public?: string
  prov_tema?: string
  prov_sintesis?: string
  prov_magistrados?: unknown
  prov_expediente?: string
  rutahtml?: string
}
export type HitES = { _id?: string; _source?: FuenteES }
export type BloqueHits = { total?: { value?: number }; hits?: HitES[] }
export type RespuestaES = { data?: { hits?: BloqueHits }; hits?: BloqueHits }

/**
 * La relatoría antepone un aviso HTML a la respuesta JSON cuando la búsqueda
 * "flexible" no halla coincidencias. El aviso NO es un cambio de API: es el
 * canario de "0 resultados" que el propio servidor pone. Se extrae el JSON
 * del cuerpo; si el aviso está, quien llama decide (vacío legítimo o núcleo).
 * La comparación es sin tildes: esbuild escapa la "ú" en el bundle y el texto
 * real del servidor la trae literal, así que comparar la forma acentuada
 * fallaría según dónde se ejecute.
 */
function extraerJson(bruto: string): { json: RespuestaES | HitES[] | null; avisoFlexible: boolean } {
  const avisoFlexible = /no fue posible ejecutar b[úu]squedas flexibles/i.test(bruto)
  const inicio = bruto.search(/[{[]/)
  if (inicio === -1) return { json: null, avisoFlexible }
  const final = bruto.lastIndexOf(bruto[inicio] === '{' ? '}' : ']')
  if (final <= inicio) return { json: null, avisoFlexible }
  try {
    return { json: JSON.parse(bruto.slice(inicio, final + 1)) as RespuestaES | HitES[], avisoFlexible }
  } catch {
    return { json: null, avisoFlexible }
  }
}

export async function pedirJson(url: string): Promise<{ json: RespuestaES | HitES[] | null; avisoFlexible: boolean }> {
  const bruto = await pedir(url)
  return extraerJson(bruto)
}

export const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

export function aProvidencia(hit: HitES): Providencia {
  const s = hit._source ?? {}
  const ruta = texto(s.rutahtml)
  return {
    id: String(s.prov_id ?? hit._id ?? ''),
    sentencia: texto(s.prov_sentencia),
    tipo: texto(s.prov_tipo),
    fecha: texto(s.prov_f_sentencia),
    publicacion: texto(s.prov_f_public),
    tema: texto(s.prov_tema),
    sintesis: texto(s.prov_sintesis),
    magistrados: Array.isArray(s.prov_magistrados) ? s.prov_magistrados.map(texto) : [],
    expediente: texto(s.prov_expediente),
    ruta,
    url: ruta ? `${BASE}/${ruta}` : '',
  }
}
