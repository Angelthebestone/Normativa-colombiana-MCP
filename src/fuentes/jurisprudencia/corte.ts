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
import { cargar, limpiarTermino, sinTildes, textoDe } from '../../nucleo/parse.ts'
import { rutaDeSentencia } from '../../nucleo/citas.ts'
import { pedir as http } from '../../nucleo/http.ts'
import { esStopword } from '../../nucleo/stopwords.ts'

const BASE = 'https://www.corteconstitucional.gov.co/relatoria'
const BUSCADOR = `${BASE}/buscador_new/`

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
type FuenteES = {
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
type HitES = { _id?: string; _source?: FuenteES }
type BloqueHits = { total?: { value?: number }; hits?: HitES[] }
type RespuestaES = { data?: { hits?: BloqueHits }; hits?: BloqueHits }

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

async function pedirJson(url: string): Promise<{ json: RespuestaES | HitES[] | null; avisoFlexible: boolean }> {
  const bruto = await pedir(url)
  return extraerJson(bruto)
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

function aProvidencia(hit: HitES): Providencia {
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

/** C = constitucionalidad, T = tutela, SU = unificación, A = auto. */
export type TipoProvidencia = 'C' | 'T' | 'SU' | 'A'

const prefijo = (p: Providencia): string =>
  (p.sentencia.match(/^\s*(SU|C|T|A)\b/i)?.[1] ?? '').toUpperCase()

/**
 * El backend de la relatoría rompe la búsqueda "flexible" cuando el término
 * trae varias palabras (antepone un aviso y devuelve 0). Reintentar con una
 * sola palabra significativa rescata resultados reales.
 *
 * La primera palabra del término suele ser la más genérica ("debido proceso
 * inspección de policía querella" → "debido" da 36.954, "querella" 987), así
 * que se prueban las palabras de menor a mayor frecuencia en la relatoría:
 * la más distintiva primero. Eso devuelve providencias que de verdad tratan
 * el asunto, no cualquier tutela que mencione la palabra común.
 */
function nucleosDelTermino(termino: string): string[] {
  const palabras = termino.split(' ').filter(Boolean)
  const utiles = palabras.filter((p) => !esStopword(p))
  const candidatas = [...new Set(utiles.length ? utiles : palabras)]
  if (candidatas.length <= 1) return []
  // De menor a mayor frecuencia: la palabra más específica se prueba primero.
  return candidatas.sort((a, b) => FRECUENCIA.get(sinTildes(a).toLowerCase())! - FRECUENCIA.get(sinTildes(b).toLowerCase())!)
}

/** Frecuencia aproximada de cada palabra en la relatoría (medida el 2026-08-06). */
const FRECUENCIA = new Map<string, number>([
  ['debido', 36954], ['proceso', 47149], ['inspeccion', 6637], ['policia', 7744], ['querella', 987],
  ['amparo', 30025], ['policivo', 1944], ['mora', 6554], ['policiva', 1944], ['plazo', 17553],
  ['razonable', 20177], ['diligencia', 13682], ['lanzamiento', 495], ['irregular', 5264],
  ['incumplimiento', 17211], ['orden', 45443], ['desalojo', 970], ['omision', 23007],
  ['autoridad', 40660], ['hecho', 41577], ['superado', 9721], ['accion', 44222],
  ['cumplimiento', 41045], ['entrega', 10861], ['ficticia', 1395], ['renuencia', 1449],
])

async function consultar(
  termino: string,
  desde: string | undefined,
  hasta: string | undefined,
  maxprov: number,
): Promise<{ total: number; items: Providencia[]; avisoFlexible: boolean; nucleo?: string }> {
  const p = new URLSearchParams({
    searchOption: 'texto',
    fini: desde ?? '1992-01-01',
    ffin: hasta ?? '2100-12-31',
    buscar_por: termino,
    maxprov: String(maxprov),
    slop: '1',
    accion: 'search',
    tipo: 'json',
  })

  const { json, avisoFlexible } = await pedirJson(`${BUSCADOR}?${p}`)
  const hits = Array.isArray(json) ? undefined : json?.data?.hits
  // El aviso "flexible" es el canario del servidor: antepone HTML y devuelve
  // hits vacíos. En ese caso el 0 NO es palabra final — se reintenta con las
  // palabras del término, que rescatan resultados reales de la relatoría.
  if (hits && !avisoFlexible) {
    return {
      total: typeof hits.total?.value === 'number' ? hits.total.value : (hits.hits ?? []).length,
      items: (hits.hits ?? []).map(aProvidencia),
      avisoFlexible,
    }
  }
  // Sin bloque de resultados no hay nada que leer. Antes se tiraba un error
  // que culpaba a un cambio de API; hoy el canario es el aviso "flexible":
  // si está, el servidor sí respondió (con 0), y el vacío es legítimo.
  if (!avisoFlexible && json === null) {
    throw new Error('La respuesta de la relatoría no trae el bloque de resultados esperado; la API pudo cambiar.')
  }

  // Reintento con cada palabra del término: la frase completa no rindió.
  for (const nucleo of nucleosDelTermino(termino)) {
    const r = await consultar(nucleo, desde, hasta, maxprov)
    if (r.items.length || r.total > 0) return { ...r, nucleo }
  }
  return { total: 0, items: [], avisoFlexible }
}

export async function buscar(opts: {
  termino: string
  desde?: string | undefined
  hasta?: string | undefined
  limite?: number | undefined
  tipos?: TipoProvidencia[] | undefined
}): Promise<{ total: number; items: Providencia[]; nucleo?: string }> {
  const termino = limpiarTermino(opts.termino)
  if (!termino) throw new Error('Indica un término para buscar jurisprudencia.')

  const limite = Math.min(Math.max(opts.limite ?? 10, 1), 100)
  const quiere = opts.tipos?.length ? new Set(opts.tipos.map((t) => t.toUpperCase())) : null
  // La API no filtra por tipo de providencia, así que se pide de más y se
  // recorta aquí; sin esto, pedir 10 tutelas podía devolver 10 autos.
  const maxprov = quiere ? Math.min(limite * 10, 300) : limite

  const r = await consultar(termino, opts.desde, opts.hasta, maxprov)
  const todas = quiere ? r.items.filter((x) => quiere.has(prefijo(x))) : r.items
  return { total: r.total, items: todas.slice(0, limite), ...(r.nucleo !== undefined ? { nucleo: r.nucleo } : {}) }
}

export async function ultimas(cantidad = 10): Promise<Providencia[]> {
  const n = Math.min(Math.max(cantidad, 1), 50)
  const { json } = await pedirJson(`${BUSCADOR}?accion=ver_modal_ultimas_providencias&cantidad=${n}&tipo=json`)
  const lista: HitES[] = Array.isArray(json) ? json : (json?.data?.hits?.hits ?? json?.hits?.hits ?? [])
  return lista.map(aProvidencia)
}

/**
 * Texto completo de una providencia. Acepta `2024/T-099-24.htm`, la URL entera
 * o la cita corta `T-099/24`: obligar a copiar la ruta literal de una respuesta
 * previa era fricción gratuita, porque el resto del sistema cita en corto.
 */
export async function obtenerTexto(ruta: string): Promise<{ url: string; texto: string }> {
  const limpia = ruta.replace(/^https?:\/\/[^/]+\/relatoria\//i, '').replace(/^\/+/, '')
  if (!/^[\w./-]+\.html?$/i.test(limpia)) {
    const porCita = rutaDeSentencia(ruta)
    if (porCita) return obtenerTexto(porCita)
    throw new Error(`Ruta de providencia inválida: ${ruta}. Se espera "2024/T-099-24.htm" o la cita "T-099/24".`)
  }
  const url = `${BASE}/${limpia}`
  const html = await pedir(url)
  // Una ruta inexistente no da 404: devuelve el armazón de la SPA en Angular.
  // Confundir eso con "documento vacío" haría creer que la sentencia no dice nada.
  if (html.includes('data-beasties-container') || /<title>\s*CORTE CONSTITUCIONAL DE COLOMBIA/i.test(html)) {
    throw new NoExisteProvidencia(limpia)
  }
  return { url, texto: textoDe(cargar(html), 'body') }
}

export class NoExisteProvidencia extends Error {
  constructor(ruta: string) {
    super(`No existe una providencia en la ruta "${ruta}". Verifícala con buscar_jurisprudencia.`)
    this.name = 'NoExisteProvidencia'
  }
}

/** Resuelve "C-337/11" a su providencia usando el buscador. */
export async function porSentencia(sentencia: string): Promise<Providencia | null> {
  const { items } = await buscar({ termino: sentencia, limite: 20 })
  const objetivo = sentencia.replace(/[\s.]/g, '').toUpperCase()
  return items.find((p) => p.sentencia.replace(/[\s.]/g, '').toUpperCase() === objetivo) ?? null
}
