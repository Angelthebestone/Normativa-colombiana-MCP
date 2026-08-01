import {
  BASE_GESTOR,
  CanarioError,
  NoExisteError,
  enlacesDeNormas,
  parseNorma,
  parseOpciones,
  parseResultados,
  parseTematica,
  pdfEsEscaneo,
  limpiarTermino,
  sinTildes,
  tieneTildes,
  type FilaTema,
  type Norma,
  type Resultado,
} from '../parse.ts'

import { pedir } from '../http.ts'

// El ritmo y la serialización por dominio los gobierna `pedir`.
async function traer(url: string): Promise<string> {
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
  palabras?: string | undefined
  tipo?: string | number | undefined
  numero?: string | number | undefined
  anio?: string | number | undefined
  entidad?: string | number | undefined
  tema?: string | number | undefined
  subtema?: string | number | undefined
}

async function consultar(p: URLSearchParams, termino = ''): Promise<{ total: number; items: Resultado[] }> {
  p.set('t', 'ejecuta_busqueda_avanzada2')
  return parseResultados(await traer(`${BASE_GESTOR}/gestion/funphp/funajax.php?${p}`), termino)
}

/**
 * Traduce un par tema/subtema (por nombre) al `subtemaid` que entiende el
 * buscador. Es la vía que de verdad encuentra: `palabras=teletrabajo` devuelve
 * 3 documentos en todo el portal, mientras que el subtema correspondiente
 * devuelve 55, de los cuales 43 son conceptos.
 *
 * Ojo: el `temsubid` de la consulta temática es OTRO espacio de ids y no sirve
 * como `subtemaid`.
 */
export async function subtemaPorNombre(tema: string, subtema: string): Promise<string | undefined> {
  const idTema = await resolver(tema, 'temas')
  if (!idTema) return undefined
  const objetivo = sinTildes(subtema).toLowerCase()
  const lista = await subtemas(idTema)
  return (
    lista.find((s) => sinTildes(s.nombre).toLowerCase() === objetivo)?.id ??
    lista.find((s) => sinTildes(s.nombre).toLowerCase().includes(objetivo))?.id
  )
}

export async function buscar(
  f: Filtros,
): Promise<{ total: number; items: Resultado[]; nota?: string | undefined; aplicados: string[] }> {
  const p = new URLSearchParams()
  const notas: string[] = []
  // Qué filtros se aplicaron de verdad: sin esto, un cero por combinación
  // inexistente es indistinguible de un filtro que no se supo resolver.
  const aplicados: string[] = []

  if (f.palabras) {
    const { usadas, descartadas } = quitarStopwords(f.palabras)
    p.set('palabras', usadas)
    if (descartadas.length) notas.push(`Se ignoraron palabras vacías (${descartadas.join(', ')}): el buscador del portal las une con OR e inundan el resultado.`)
  }
  for (const [etiqueta, valor, campo, cual] of [
    ['tipo', f.tipo, 'tipdoc', 'tipos'],
    ['entidad', f.entidad, 'entidad1', 'entidades'],
    ['tema', f.tema, 'temarl', 'temas'],
  ] as const) {
    if (valor === undefined || valor === '') continue
    const id = await resolver(valor, cual)
    if (id) {
      p.set(campo, id)
      aplicados.push(`${etiqueta}="${valor}" (id ${id})`)
    } else {
      notas.push(`No reconocí ${etiqueta} "${valor}"; se ignoró. Consulta los valores válidos con listar_catalogos.`)
    }
  }
  const num = entero(f.numero)
  const an = entero(f.anio)

  // El subtema admite el id o el nombre. Por nombre hace falta el tema, porque
  // los subtemas no son únicos en el portal: "Teletrabajo" cuelga de varios.
  let sub = entero(f.subtema)
  if (!sub && f.subtema) {
    if (!f.tema) {
      notas.push(
        `Para usar el subtema por nombre ("${f.subtema}") hace falta indicar también el tema; ` +
          `si no, usa el id numérico que devuelve listar_subtemas.`,
      )
    } else {
      sub = await subtemaPorNombre(String(f.tema), String(f.subtema))
      if (!sub) notas.push(`No encontré el subtema "${f.subtema}" dentro del tema "${f.tema}"; se ignoró.`)
    }
  }
  if (num) {
    p.set('nrodoc', num)
    aplicados.push(`número=${num}`)
  }
  if (an) {
    p.set('ano', an)
    aplicados.push(`año=${an}`)
  }
  if (sub) {
    p.set('subtemaid', sub)
    aplicados.push(`subtema=${sub}`)
  }
  if (f.palabras) aplicados.push(`palabras="${p.get('palabras')}"`)

  if (![...p.keys()].length) {
    // Si algún filtro se descartó, el motivo explica más que un error genérico.
    throw new Error(
      notas.length
        ? `No quedó ningún filtro aplicable. ${notas.join(' ')}`
        : 'Indica al menos un filtro o unas palabras para buscar.',
    )
  }

  let { total, items } = await consultar(p, f.palabras ?? '')

  // `gestión` (18 resultados) y `gestion` (3) son conjuntos distintos: el portal
  // no normaliza tildes, así que se consultan ambas y se unen.
  if (f.palabras && tieneTildes(p.get('palabras') ?? '')) {
    const p2 = new URLSearchParams(p)
    p2.set('palabras', sinTildes(p.get('palabras')!))
    try {
      const otra = await consultar(p2, f.palabras ?? '')
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

  // El buscador une los términos con OR: conviene saber cuáles aparecieron de
  // verdad, o "zopilote interconectado" parece haber encontrado zopilotes.
  if (f.palabras && items.length) {
    const heno = sinTildes(items.map((i) => `${i.titulo} ${i.resumen}`).join(' ')).toLowerCase()
    const ausentes = (p.get('palabras') ?? '')
      .split(' ')
      .filter((t) => t && !heno.includes(sinTildes(t).toLowerCase()))
    if (ausentes.length) {
      notas.push(
        `Atención: ${ausentes.map((t) => `"${t}"`).join(' y ')} no aparece en ningún resultado — ` +
          `el portal une los términos con OR, así que coincidió solo el resto.`,
      )
    }
  }

  return { total, items, nota: notas.join(' ') || undefined, aplicados }
}

// --- documentos ----------------------------------------------------------

export async function obtenerNorma(id: string | number): Promise<Norma> {
  const n = entero(id)
  if (!n) throw new Error(`Identificador de norma inválido: ${id}`)
  return parseNorma(await traer(`${BASE_GESTOR}/norma.php?i=${n}`), n)
}

/**
 * ¿El PDF de una norma es un escaneo? Solo se pregunta cuando el HTML no trajo
 * texto: es una petición de más en un camino que ya iba a devolver poco, y a
 * cambio distingue "no hay texto publicado" de "es una imagen".
 */
export async function pdfEscaneado(id: string | number): Promise<boolean> {
  try {
    return pdfEsEscaneo(await traer(`${BASE_GESTOR}/norma_pdf.php?i=${entero(id)}`))
  } catch {
    return false // sin PDF no hay nada que afirmar; se informa como "sin texto" a secas
  }
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

// `normasfp.php` es un listado plano: no trae el contador "encontrados" que sí
// devuelve el buscador, así que se leen los enlaces directamente.
export async function normasFp(): Promise<Resultado[]> {
  const items = enlacesDeNormas(await traer(`${BASE_GESTOR}/normasfp.php`))
  if (!items.length) throw new CanarioError('el listado de normas de Función Pública no trae enlaces')
  return items
}

// --- conceptos de Función Pública ---------------------------------------

// ponytail: `conceptosfp.php` son 10,7 MB sin búsqueda en servidor, así que se
// baja una vez y se filtra localmente. Alternativa más barata que ya cubre casi
// todo: buscar_normas con tipo_documento "Concepto".
let cacheConceptos: { cuando: number; items: Resultado[] } | null = null
const TTL_CONCEPTOS = 7 * 24 * 3600 * 1000

/**
 * El listado solo trae número y año ("Concepto 036201 de 2024"): no hay materia
 * en el título, así que aquí NO se puede buscar por tema. Filtrar por asunto
 * devolvería siempre cero y eso se leería como "no existen conceptos sobre
 * esto", que es justo la confusión que hay que evitar. Para buscar por materia,
 * `buscar` con tipo Concepto (7), que sí consulta los restrictores.
 */
export async function conceptosFp(numero?: string | number, anio?: string | number, limite = 20, desde = 0) {
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
  const num = numero ? String(numero).replace(/\D/g, '') : ''
  const a = anio ? String(anio) : ''
  const filtrados = cacheConceptos.items.filter(
    (c) => (!num || c.titulo.includes(num)) && (!a || c.titulo.includes(a)),
  )
  return { total: filtrados.length, desde, items: filtrados.slice(desde, desde + limite) }
}
