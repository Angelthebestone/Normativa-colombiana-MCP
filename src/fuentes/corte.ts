/**
 * Relatoría de la Corte Constitucional.
 *
 * API JSON no documentada, descubierta leyendo los bundles de Angular del
 * propio sitio (el objeto de entorno y la construcción de la consulta estaban
 * en texto plano). Devuelve la respuesta cruda de Elasticsearch, así que aquí
 * no hay HTML que parsear ni canario frágil: solo el troceado del texto.
 *
 * Cubre lo que al Gestor Normativo le falta: en el Gestor hay 3 sentencias de
 * 2024; aquí hay 49.409 providencias y se publican el mismo día.
 */
import { cargar, textoDe } from '../parse.ts'
import { pedir as http } from '../http.ts'

const BASE = 'https://www.corteconstitucional.gov.co/relatoria'
const BUSCADOR = `${BASE}/buscador_new/`
const TIMEOUT = 60_000

export type Providencia = {
  id: string
  sentencia: string
  tipo: string
  fecha: string
  publicacion: string
  tema: string
  sintesis: string
  magistrados: string[]
  expediente: string
  ruta: string
  url: string
}

async function pedir(url: string): Promise<string> {
  let res: Awaited<ReturnType<typeof http>>
  try {
    res = await http(url, TIMEOUT, 'application/json,text/html,*/*')
  } catch (e) {
    throw new Error(`No se pudo contactar la relatoría de la Corte Constitucional (${(e as Error).message}).`)
  }
  // El sitio redirige a minúsculas; seguimos una sola vez.
  if (res.status >= 300 && res.status < 400) throw new Error(`La relatoría redirigió (${res.status}) para ${url}.`)
  if (res.status !== 200) throw new Error(`La relatoría de la Corte respondió ${res.status}.`)
  return res.cuerpo
}

async function pedirJson(url: string): Promise<any> {
  const bruto = await pedir(url)
  try {
    return JSON.parse(bruto)
  } catch {
    throw new Error(
      'La API de la relatoría devolvió algo que no es JSON. Es una API no documentada y pudo haber cambiado; ' +
        'no se devuelven resultados vacíos para no hacer creer que no hay jurisprudencia.',
    )
  }
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

function aProvidencia(hit: any): Providencia {
  const s = hit?._source ?? {}
  const ruta = texto(s.rutahtml)
  return {
    id: String(s.prov_id ?? hit?._id ?? ''),
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

export async function buscar(opts: {
  termino: string
  desde?: string
  hasta?: string
  limite?: number
}): Promise<{ total: number; items: Providencia[] }> {
  const termino = opts.termino.replace(/["'<>;%\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!termino) throw new Error('Indica un término para buscar jurisprudencia.')

  const p = new URLSearchParams({
    searchOption: 'texto',
    fini: opts.desde ?? '1992-01-01',
    ffin: opts.hasta ?? '2100-12-31',
    buscar_por: termino,
    maxprov: String(Math.min(Math.max(opts.limite ?? 10, 1), 100)),
    slop: '1',
    accion: 'search',
    tipo: 'json',
  })

  const j = await pedirJson(`${BUSCADOR}?${p}`)
  const hits = j?.data?.hits
  if (!hits) {
    throw new Error('La respuesta de la relatoría no trae el bloque de resultados esperado; la API pudo cambiar.')
  }
  return {
    total: typeof hits.total?.value === 'number' ? hits.total.value : (hits.hits?.length ?? 0),
    items: (hits.hits ?? []).map(aProvidencia),
  }
}

export async function ultimas(cantidad = 10): Promise<Providencia[]> {
  const n = Math.min(Math.max(cantidad, 1), 50)
  const j = await pedirJson(`${BUSCADOR}?accion=ver_modal_ultimas_providencias&cantidad=${n}&tipo=json`)
  const lista = Array.isArray(j) ? j : (j?.data?.hits?.hits ?? j?.hits?.hits ?? [])
  return lista.map(aProvidencia)
}

export async function total(): Promise<number> {
  const j = await pedirJson(`${BUSCADOR}?accion=ver_total_providencias&tipo=json`)
  return j?.hits?.total?.value ?? j?.data?.hits?.total?.value ?? 0
}

/** Texto completo de una providencia: acepta `2024/T-099-24.htm` o la URL entera. */
export async function obtenerTexto(ruta: string): Promise<{ url: string; texto: string }> {
  const limpia = ruta.replace(/^https?:\/\/[^/]+\/relatoria\//i, '').replace(/^\/+/, '')
  if (!/^[\w./-]+\.html?$/i.test(limpia)) {
    throw new Error(`Ruta de providencia inválida: ${ruta}. Se espera algo como 2024/T-099-24.htm`)
  }
  const url = `${BASE}/${limpia}`
  const $ = cargar(await pedir(url))
  return { url, texto: textoDe($, 'body') }
}

/** Resuelve "C-337/11" a su providencia usando el buscador. */
export async function porSentencia(sentencia: string): Promise<Providencia | null> {
  const { items } = await buscar({ termino: sentencia, limite: 20 })
  const objetivo = sentencia.replace(/[\s.]/g, '').toUpperCase()
  return items.find((p) => p.sentencia.replace(/[\s.]/g, '').toUpperCase() === objetivo) ?? null
}
