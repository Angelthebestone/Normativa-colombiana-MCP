import {
  BASE_GESTOR,
  CanarioError,
  NoExisteError,
  parseNorma,
  parseOpciones,
  parseResultados,
  parseTematica,
  limpiarTermino,
  sinTildes,
  tieneTildes,
  type FilaTema,
  type Norma,
  type Resultado,
} from '../parse.ts'

import { pedir } from '../http.ts'

// ponytail: una sola cola global. Es infraestructura pública y el MCP debe
// pesarle menos que una persona navegando; si algún día hace falta caudal,
// aquí va un semáforo de N permisos.
let cola: Promise<unknown> = Promise.resolve()

async function traer(url: string): Promise<string> {
  const tarea = cola.then(async () => {
    let res: Awaited<ReturnType<typeof pedir>>
    try {
      res = await pedir(url) // 60 s por defecto: el Decreto 1083 tarda ~8 s
    } catch (e) {
      throw new Error(
        `No se pudo contactar el Gestor Normativo (${(e as Error).message}). ` +
          `Revisa tu conexión o intenta más tarde: el portal a veces está en mantenimiento.`,
      )
    }
    // Un id inexistente redirige en vez de dar 404.
    if (res.status >= 300 && res.status < 400) throw new NoExisteError(url.replace(/^.*i=/, ''))
    if (res.status === 500) {
      throw new Error(
        'El portal rechazó la consulta (error 500). Suele pasar con comillas o caracteres raros en los términos; ' +
          'intenta con palabras sencillas, sin comillas.',
      )
    }
    if (res.status !== 200) throw new Error(`El portal respondió ${res.status}.`)
    return res.cuerpo
  })
  cola = tarea.catch(() => {})
  return tarea
}

// --- saneamiento ---------------------------------------------------------

const entero = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(String(v).replace(/\D/g, ''))
  return Number.isInteger(n) && n > 0 ? String(n) : undefined
}

const STOPWORDS = new Set([
  'a', 'al', 'ante', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los',
  'o', 'para', 'por', 'que', 'se', 'su', 'sus', 'un', 'una', 'unos', 'unas', 'y',
])

/**
 * El buscador une los términos con OR y no descarta vacías: `auxilio de
 * conectividad` devuelve 176 documentos solo por culpa del `de`, mientras que
 * `auxilio` devuelve 9. Quitarlas es lo que separa una búsqueda útil del ruido.
 */
export function quitarStopwords(frase: string): { usadas: string; descartadas: string[] } {
  const palabras = limpiarTermino(frase).split(' ').filter(Boolean)
  const utiles = palabras.filter((p) => !STOPWORDS.has(sinTildes(p).toLowerCase()))
  const descartadas = palabras.filter((p) => STOPWORDS.has(sinTildes(p).toLowerCase()))
  return { usadas: (utiles.length ? utiles : palabras).join(' '), descartadas }
}

// --- catálogos -----------------------------------------------------------

export type Catalogos = {
  tipos: { id: string; nombre: string }[]
  anios: { id: string; nombre: string }[]
  entidades: { id: string; nombre: string }[]
  temas: { id: string; nombre: string }[]
}

let cacheCatalogos: Catalogos | null = null

export async function catalogos(): Promise<Catalogos> {
  if (cacheCatalogos) return cacheCatalogos
  const html = await traer(`${BASE_GESTOR}/consulta_avanzada.php`)
  const c: Catalogos = {
    tipos: parseOpciones(html, 'tipodoc'),
    anios: parseOpciones(html, 'ano1'),
    entidades: parseOpciones(html, 'entidad1'),
    temas: parseOpciones(html, 'temarl'),
  }
  if (c.tipos.length < 10) throw new CanarioError(`el catálogo de tipos trae ${c.tipos.length} opciones`)
  cacheCatalogos = c
  return c
}

/** Acepta el id numérico o el nombre (coincidencia laxa, sin tildes). */
export async function resolver(valor: string | number | undefined, cual: keyof Catalogos): Promise<string | undefined> {
  if (valor === undefined || valor === '') return undefined
  const s = String(valor).trim()
  if (/^\d+$/.test(s)) return s
  const lista = (await catalogos())[cual]
  const objetivo = sinTildes(s).toLowerCase()
  const exacto = lista.find((o) => sinTildes(o.nombre).toLowerCase() === objetivo)
  if (exacto) return exacto.id
  const parcial = lista.find((o) => sinTildes(o.nombre).toLowerCase().includes(objetivo))
  return parcial?.id
}

// --- búsqueda ------------------------------------------------------------

export type Filtros = {
  palabras?: string
  tipo?: string | number
  numero?: string | number
  anio?: string | number
  entidad?: string | number
  tema?: string | number
  subtema?: string | number
}

async function consultar(p: URLSearchParams): Promise<{ total: number; items: Resultado[] }> {
  p.set('t', 'ejecuta_busqueda_avanzada2')
  return parseResultados(await traer(`${BASE_GESTOR}/gestion/funphp/funajax.php?${p}`))
}

export async function buscar(f: Filtros): Promise<{ total: number; items: Resultado[]; nota?: string }> {
  const p = new URLSearchParams()
  const notas: string[] = []

  if (f.palabras) {
    const { usadas, descartadas } = quitarStopwords(f.palabras)
    p.set('palabras', usadas)
    if (descartadas.length) notas.push(`Se ignoraron palabras vacías (${descartadas.join(', ')}): el buscador del portal las une con OR e inundan el resultado.`)
  }
  const tip = await resolver(f.tipo, 'tipos')
  const ent = await resolver(f.entidad, 'entidades')
  const tem = await resolver(f.tema, 'temas')
  if (tip) p.set('tipdoc', tip)
  if (ent) p.set('entidad1', ent)
  if (tem) p.set('temarl', tem)
  const num = entero(f.numero)
  const an = entero(f.anio)
  const sub = entero(f.subtema)
  if (num) p.set('nrodoc', num)
  if (an) p.set('ano', an)
  if (sub) p.set('subtemaid', sub)

  if (![...p.keys()].length) throw new Error('Indica al menos un filtro o unas palabras para buscar.')

  let { total, items } = await consultar(p)

  // `gestión` (18 resultados) y `gestion` (3) son conjuntos distintos: el portal
  // no normaliza tildes, así que se consultan ambas y se unen.
  if (f.palabras && tieneTildes(p.get('palabras') ?? '')) {
    const p2 = new URLSearchParams(p)
    p2.set('palabras', sinTildes(p.get('palabras')!))
    try {
      const otra = await consultar(p2)
      const vistos = new Set(items.map((i) => i.id))
      const extra = otra.items.filter((i) => !vistos.has(i.id))
      if (extra.length) {
        items = [...items, ...extra]
        total += extra.length
        notas.push('Se unieron los resultados con y sin tildes: el portal los trata como búsquedas distintas.')
      }
    } catch {
      /* la variante sin tildes es un extra; si falla, seguimos con lo que hay */
    }
  }

  return { total, items, nota: notas.join(' ') || undefined }
}

// --- documentos ----------------------------------------------------------

export async function obtenerNorma(id: string | number): Promise<Norma> {
  const n = entero(id)
  if (!n) throw new Error(`Identificador de norma inválido: ${id}`)
  return parseNorma(await traer(`${BASE_GESTOR}/norma.php?i=${n}`), n)
}

export async function subtemas(temaId: string | number): Promise<{ id: string; nombre: string }[]> {
  const t = entero(temaId)
  if (!t) throw new Error(`Identificador de tema inválido: ${temaId}`)
  const html = await traer(`${BASE_GESTOR}/gestion/funphp/funajax.php?t=cargar_subtemas_activos&itema=${t}`)
  return [...html.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1]!, nombre: m[2]!.trim() }))
}

/** El restrictor: por qué una norma aplica a un subtema. Es lo mejor del portal. */
export async function restrictor(temsubid: string | number, normid: string | number): Promise<string> {
  const a = entero(temsubid)
  const b = entero(normid)
  if (!a || !b) throw new Error('temsubid y normid deben ser numéricos.')
  const t = await traer(`${BASE_GESTOR}/consulta-tematica.php?inforestrictor=si&temsubid=${a}&normid=${b}`)
  return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function tematica(texto: string): Promise<FilaTema[]> {
  const q = limpiarTermino(texto)
  if (!q) throw new Error('Indica un término para la consulta temática.')
  return parseTematica(await traer(`${BASE_GESTOR}/consulta-tematica.php?texto=${encodeURIComponent(q)}`))
}

export async function normasFp(): Promise<Resultado[]> {
  return parseResultados(await traer(`${BASE_GESTOR}/normasfp.php`)).items
}

// --- conceptos de Función Pública ---------------------------------------

// ponytail: `conceptosfp.php` son 10,7 MB sin búsqueda en servidor, así que se
// baja una vez y se filtra localmente. Alternativa más barata que ya cubre casi
// todo: buscar_normas con tipo_documento "Concepto".
let cacheConceptos: { cuando: number; items: Resultado[] } | null = null
const TTL_CONCEPTOS = 7 * 24 * 3600 * 1000

export async function conceptosFp(texto?: string, anio?: string | number, limite = 20) {
  if (!cacheConceptos || Date.now() - cacheConceptos.cuando > TTL_CONCEPTOS) {
    const html = await traer(`${BASE_GESTOR}/conceptosfp.php`)
    const items = [...html.matchAll(/norma\.php\?i=(\d+)"[^>]*>([^<]+)</g)].map((m) => ({
      id: m[1]!,
      titulo: m[2]!.trim(),
      resumen: '',
      url: `${BASE_GESTOR}/norma.php?i=${m[1]}`,
    }))
    if (items.length < 100) throw new CanarioError(`la lista de conceptos trae ${items.length} entradas`)
    cacheConceptos = { cuando: Date.now(), items }
  }
  const q = texto ? sinTildes(texto).toLowerCase() : ''
  const a = anio ? String(anio) : ''
  const filtrados = cacheConceptos.items.filter(
    (c) => (!q || sinTildes(c.titulo).toLowerCase().includes(q)) && (!a || c.titulo.includes(a)),
  )
  return { total: filtrados.length, items: filtrados.slice(0, limite) }
}
