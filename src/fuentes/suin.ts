/**
 * SUIN-Juriscol (Ministerio de Justicia).
 *
 * Existe por una sola razón: es la única fuente oficial del país que publica el
 * ESTADO DE VIGENCIA como dato. Ni el Gestor Normativo ni la relatoría lo
 * tienen, y por eso hasta ahora ninguna respuesta podía decir si una norma
 * sigue vigente.
 *
 * No tiene buscador utilizable —su Solr no resuelve ni por nombre ni por IP—,
 * así que la norma se localiza contra un índice empaquetado que se genera con
 * scripts/generar-indice-suin.ts. Sin índice, esta fuente simplemente no opina.
 */
import { readFileSync } from 'node:fs'
import { CanarioError, cargar, limpiarTermino, sinTildes, textoDe } from '../nucleo/parse.ts'
import { pedir } from '../nucleo/http.ts'
import { esStopword } from '../nucleo/stopwords.ts'

const BASE = 'https://www.suin-juriscol.gov.co'

export const claveSuin = (tipo: string, numero: string, anio: string): string =>
  `${tipo.toLowerCase()} ${Number(numero)} ${anio}`

export type Ficha = { tipo: string; numero: string; anio: string; epigrafe: string; estado: string }

/**
 * Metadatos del documento, leídos del bloque oculto de `<span field="…">` que
 * SUIN incrusta al principio de cada página (45 campos, entre ellos `tipo`,
 * `numero`, `anio`, `epigrafe` y `estado_documento`).
 *
 * Se lee de ahí y no de la prosa por dos razones medidas: la etiqueta visible
 * "ESTADO DE VIGENCIA" falta en documentos antiguos que sí traen el campo —la
 * Ley 74 de 1923 está DEROGADA y no la muestra—, y donde aparecen los dos se
 * contradicen: en la Ley 1541 de 2012 la prosa dice "Vigente" y el campo dice
 * "Vigencia en Estudio". El campo es el dato; la prosa es su maquetación.
 *
 * El estado se devuelve literal, sin reducirlo a un booleano: SUIN distingue
 * "Vigente", "DEROGADO" y "Vigencia en Estudio", y un sí/no inventaría una
 * certeza que la fuente no da.
 */
export function fichaSuin(html: string): Ficha | null {
  const campos: Record<string, string> = {}
  for (const m of html.matchAll(/<span field="([^"]+)">([\s\S]*?)<\/span>/g)) {
    campos[m[1]!] = m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  const { tipo, numero, anio } = campos
  if (!tipo || !numero || !anio) return null
  return {
    tipo: tipo.toUpperCase(),
    numero: numero.replace(/\D/g, ''),
    anio,
    epigrafe: campos['epigrafe'] ?? '',
    estado: campos['estado_documento'] ?? '',
  }
}

// --- buscador (Azure Cognitive Search) ------------------------------------

/**
 * SUIN no tiene buscador propio, pero su front nuevo consulta un índice de
 * Azure Cognitive Search: 56.832 documentos —no solo leyes— con epígrafe,
 * sector, materia y entidad emisora. Es lo único que permite explorar SUIN por
 * materia, porque el índice empaquetado solo sabe traducir una cita a un id.
 *
 * DOS LÍMITES MEDIDOS, y por eso esto NO sustituye a `vigencia()`:
 *
 * 1. Su campo `vigencia` contradice a la ficha del documento. La Ley 74 de 1923
 *    (id 1622206) aparece aquí como "Vigencia en Estudio" y su ficha dice
 *    DEROGADO. Además solo 82 de 56.832 figuran derogadas (0,14%), cifra
 *    increíble para un corpus que arranca en 1844: parece el estado de la carga
 *    inicial, no el actual. Se devuelve rotulado como dato del buscador.
 * 2. No sirve para resolver citas: "LEY 909 DE 2004" devuelve cero resultados.
 *    Para eso está resolver_cita con el índice.
 *
 * ponytail: la api-key es la que el propio sitio sirve a cualquier visitante en
 * js/buscador.js, y es de solo consulta. Si la rotan, esta búsqueda deja de
 * responder —de ahí el CanarioError, para que se note en vez de parecer que
 * SUIN no tiene nada.
 */
const BUSCADOR = 'https://searchmjd.search.windows.net/indexes/suinjuriscol-index/docs'
const API_KEY = '404481BD9298D9A33EE7215E16757100'

export type ResultadoSuin = {
  id: string
  titulo: string
  subtipo: string
  epigrafe: string
  vigencia: string
  entidad: string
  url: string
}

type RespuestaAzure = {
  '@odata.count'?: number
  value?: {
    ID?: string
    titulo?: string
    subtipo?: string
    epigrafe?: string
    vigencia?: string[]
    entidad_emisora?: string
  }[]
}

export async function buscar(opts: {
  texto: string
  vigencia?: string | undefined
  sector?: string | undefined
  desde?: number | undefined
  limite?: number | undefined
}): Promise<{ total: number; items: ResultadoSuin[] }> {
  const texto = limpiarTermino(opts.texto) || '*'
  const limite = Math.min(Math.max(opts.limite ?? 15, 1), 50)
  const p = new URLSearchParams({
    'api-version': '2019-05-06',
    search: texto,
    $top: String(limite),
    $skip: String(Math.max(0, opts.desde ?? 0)),
    $count: 'true',
    $select: 'ID,titulo,subtipo,epigrafe,vigencia,entidad_emisora',
  })
  // Los filtros son campos de colección; se escriben tal como los espera OData.
  const filtros = [
    opts.vigencia ? `vigencia/any(t: t eq '${opts.vigencia.replace(/'/g, "''")}')` : '',
    opts.sector ? `sector/any(t: t eq '${opts.sector.replace(/'/g, "''")}')` : '',
  ].filter(Boolean)
  if (filtros.length) p.set('$filter', filtros.join(' and '))

  const r = await pedir(`${BUSCADOR}?${p}`, 40_000, 'application/json;odata.metadata=none', { 'api-key': API_KEY })
  if (r.status !== 200) {
    throw new CanarioError(`el buscador de SUIN respondió ${r.status} (la clave pública del portal pudo cambiar)`)
  }
  let j: RespuestaAzure
  try {
    j = JSON.parse(r.cuerpo) as RespuestaAzure
  } catch {
    throw new CanarioError('el buscador de SUIN no devolvió JSON')
  }
  if (!Array.isArray(j.value)) throw new CanarioError('la respuesta del buscador de SUIN no trae la lista de documentos')

  return {
    total: typeof j['@odata.count'] === 'number' ? j['@odata.count'] : j.value.length,
    items: j.value.map((d) => ({
      id: String(d.ID ?? ''),
      titulo: (d.titulo ?? '').replace(/\s+/g, ' ').trim(),
      subtipo: d.subtipo ?? '',
      epigrafe: (d.epigrafe ?? '').replace(/\s+/g, ' ').trim(),
      vigencia: (d.vigencia ?? []).join(', '),
      entidad: d.entidad_emisora ?? '',
      url: `${BASE}/viewDocument.asp?id=${d.ID ?? ''}`,
    })),
  }
}

// --- índice empaquetado ---------------------------------------------------

type Indice = { generado: string; normas: Record<string, string> }
let indice: Indice | null | undefined

function cargarIndice(): Indice | null {
  if (indice !== undefined) return indice
  // Empaquetado este módulo vive en server/index.js y el índice queda un nivel
  // arriba; sin empaquetar vive en src/fuentes/ y quedan dos. Se prueban ambos.
  for (const rel of ['../datos/indice-suin.json', '../../datos/indice-suin.json']) {
    try {
      indice = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Indice
      return indice
    } catch {
      /* siguiente ubicación */
    }
  }
  indice = null // sin índice no hay vigencia; no es un fallo, es una capacidad ausente
  return indice
}

/**
 * Qué cubre el índice empaquetado, para poder declararlo en vez de prometerlo.
 * `null` cuando el índice no viaja con la instalación: entonces esta fuente no
 * opina, y eso hay que poder decirlo también.
 */
export function coberturaIndice(): { generado: string; leyes: number } | null {
  const idx = cargarIndice()
  return idx ? { generado: idx.generado, leyes: Object.keys(idx.normas).length } : null
}

export type Vigencia = Ficha & { url: string; generado: string; texto: string }

/** Los tres estados de la ficha directa, para que quien llama los distinga. */
export type EstadoFichaDirecta =
  | { ok: true; vigencia: Vigencia }
  | {
      ok: false
      razon: 'indice-ausente' | 'ficha-caida' | 'no-consta'
      /** Qué se vio exactamente ("HTTP 503"): sin esto, una caída del portal y
       *  un corte del cliente se leen igual y no hay nada que comprobar. */
      detalle?: string
    }

const cacheFichaDirecta = new Map<string, { vigencia: Vigencia; ts: number }>()
const TTL_FICHA_DIRECTA = 30 * 60 * 1000

/**
 * Ficha SUIN de un DECRETO por la vía directa, sin índice: se resuelve el id
 * con el buscador de Azure filtrado por título exacto y se pide la ficha. Es
 * la ruta que cierra el hueco "todo decreto = no consta" sin reindexar.
 *
 * Devuelve un estado explícito en vez de `null` a secas: índice ausente, ficha
 * caída y norma no cubierta son tres cosas distintas y la respuesta tiene que
 * poder decirlas. El resultado se cachea 30 min por clave `tipo|numero|anio`.
 *
 * `buscar` y `pedir` son inyectables para poder probar los tres estados sin
 * red; en producción usan el buscador y el transporte reales.
 */
export async function fichaDirectaDecreto(
  tipo: string,
  numero: string,
  anio: string,
  deps: {
    buscar?: typeof buscar
    pedir?: typeof pedir
  } = {},
): Promise<EstadoFichaDirecta> {
  const buscarDecreto = deps.buscar ?? buscar
  const pedirFicha = deps.pedir ?? pedir

  const idx = cargarIndice()
  if (!idx) return { ok: false, razon: 'indice-ausente' }

  const clave = claveSuin(tipo, numero, anio)
  // Un decreto que SÍ está en el índice ya lo cubre `vigencia()`: aquí solo
  // entran los que el índice no trae.
  if (idx.normas[clave]) return { ok: false, razon: 'no-consta' }

  const cache = cacheFichaDirecta.get(clave)
  if (cache && Date.now() - cache.ts < TTL_FICHA_DIRECTA) {
    return { ok: true, vigencia: cache.vigencia }
  }

  const q = `${tipo} ${numero} de ${anio}`
  const r = await buscarDecreto({ texto: q, limite: 5 })
  const item = r.items.find((d) => d.titulo && /^Decreto/i.test(d.titulo))
  if (!item || !/^https:\/\/www\.suin-juriscol\.gov\.co\/viewDocument\.asp\?id=\d+$/.test(item.url)) {
    return { ok: false, razon: 'no-consta' }
  }
  const id = item.url.match(/id=(\d+)/)?.[1]
  if (!id) return { ok: false, razon: 'no-consta' }

  const url = `${BASE}/viewDocument.asp?id=${id}`
  const r2 = await pedirFicha(url, 40_000)
  if (r2.status !== 200) return { ok: false, razon: 'ficha-caida', detalle: `HTTP ${r2.status}` }
  const ficha = fichaSuin(r2.cuerpo)
  if (!ficha) return { ok: false, razon: 'no-consta' }
  const vigencia: Vigencia = {
    ...ficha,
    url,
    generado: idx.generado,
    texto: textoDe(cargar(r2.cuerpo), 'body'),
  }
  cacheFichaDirecta.set(clave, { vigencia, ts: Date.now() })
  return { ok: true, vigencia }
}

/**
 * Ficha de SUIN para una norma, o `null` si el índice no la tiene. Si SUIN no
 * publica el estado, `estado` viene vacío y la norma se informa igual: callarla
 * entera por un campo ausente equivaldría a decir que no existe.
 */
export async function vigencia(tipo: string, numero: string, anio: string): Promise<Vigencia | null> {
  const idx = cargarIndice()
  const id = idx?.normas[claveSuin(tipo, numero, anio)]
  if (!idx || !id) return null

  const url = `${BASE}/viewDocument.asp?id=${id}`
  // La ficha es un complemento de la respuesta, no la respuesta: un SUIN sano
  // la sirve en menos de dos segundos, y cuando el portal está caído el
  // ETIMEDOUT del SO tardaba ~21 s en fallar, colgando resolver_cita entera.
  // Con 8 s se corta antes sin perder el caso normal.
  const r = await pedir(url, 8_000)
  if (r.status !== 200) return null
  const ficha = fichaSuin(r.cuerpo)
  if (!ficha) return null
  // La página trae el articulado completo además de la ficha, así que se
  // devuelve: ya está descargado y es lo único que hay cuando el Gestor no tiene
  // la norma.
  return { ...ficha, url, generado: idx.generado, texto: textoDe(cargar(r.cuerpo), 'body') }
}

// --- búsqueda por texto con índice de leyes ----------------------------------

/** Clave normalizada (sin tildes, minúsculas) del epígrafe de una ley. */
const normaliza = (s: string): string => sinTildes(s).toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Búsqueda por texto sobre el índice de leyes empaquetado. A diferencia del
 * buscador de Azure, no normaliza tildes ni deriva: "Teletrabajo" no casa con
 * "trabajo remoto", así que una ley solo aparece si su título contiene la
 * palabra exacta, sin tildes. Si la búsqueda no rinde, `buscar_en_suin` cae al
 * buscador vivo.
 */
export function buscarEnIndice(texto: string, limite = 15): { total: number; items: ResultadoSuin[] } {
  const idx = cargarIndice()
  const aguja = normaliza(texto)
  if (!idx || !aguja) return { total: 0, items: [] }
  // Sin las vacías: "ley 1221 de 2008" no debe exigir la palabra "de" en la clave.
  const palabras = aguja.split(' ').filter((p) => !esStopword(p))
  const pedido = aguja.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''
  const sinAño = palabras.filter((p) => !/^(19|20)\d{2}$/.test(p)).join(' ')
  const items: ResultadoSuin[] = []
  for (const [clave, id] of Object.entries(idx.normas)) {
    if (items.length >= limite) break
    // La clave es "tipo numero anio". La búsqueda debe caber en ella sin vacías:
    // "ley 1221 de 2008" → "ley 1221" + año 2008 exacto.
    if (pedido) {
      if (!clave.endsWith(pedido) || !clave.includes(sinAño)) continue
    } else if (!clave.includes(sinAño)) {
      continue
    }
    const m = clave.match(/^(.+?)\s+(\d+)\s+(\d{4})$/)
    const tipo = m?.[1] ?? ''
    const numero = m?.[2] ?? ''
    const anio = m?.[3] ?? ''
    items.push({
      id,
      titulo: `${tipo.toUpperCase()} ${numero} de ${anio}`.trim(),
      subtipo: tipo,
      epigrafe: '',
      vigencia: '',
      entidad: '',
      url: `${BASE}/viewDocument.asp?id=${id}`,
    })
  }
  return { total: items.length, items }
}

/**
 * Búsqueda por texto que primero prueba el índice de leyes empaquetado y, si
 * rinde 0, cae al buscador vivo de Azure (que sí normaliza y deriva: encuentra
 * la Ley 1221 de 2008 para "teletrabajo"). El hueco del índice se declara en la
 * respuesta; si el fallback tampoco encuentra nada, la norma puede existir
 * igual: ese vacío no es palabra final.
 */
export async function buscarEnSuin(
  deps: { buscar?: typeof buscar },
  opts: {
    texto: string
    vigencia?: string | undefined
    sector?: string | undefined
    desde?: number | undefined
    limite?: number | undefined
  },
): Promise<{ total: number; items: ResultadoSuin[]; nota?: string | undefined; aplicados: string[] }> {
  const aplicados: string[] = []
  const notas: string[] = []

  const delIndice = buscarEnIndice(opts.texto, opts.limite ?? 15)
  if (delIndice.items.length) {
    aplicados.push('índice de leyes empaquetado')
    return { total: delIndice.total, items: delIndice.items, aplicados }
  }

  // El índice solo cubre un subconjunto (leyes del sitemap de leyes). Antes de
  // concluir "no existe", se consulta el buscador del portal: es OTRO índice y
  // normaliza tildes y derivación.
  const vivo = await (deps.buscar ?? buscar)({
    texto: opts.texto,
    ...(opts.vigencia ? { vigencia: opts.vigencia } : {}),
    ...(opts.sector ? { sector: opts.sector } : {}),
    ...(opts.desde ? { desde: opts.desde } : {}),
    ...(opts.limite ? { limite: opts.limite } : {}),
  })
  aplicados.push('buscador del portal (Azure)')
  if (vivo.items.length) {
    notas.push(
      'El índice empaquetado no cubría el término; se consultó el buscador del portal, que normaliza tildes y derivación.',
    )
  } else {
    notas.push(
      'El índice empaquetado no cubría el término y el buscador del portal tampoco lo encontró. ' +
        'Eso NO significa que la norma no exista: el índice tiene huecos y el buscador solo indexa título, epígrafe ' +
        'y materia. Prueba con buscar_por_tema (Gestor Normativo) o resuelve la cita con resolver_cita.',
    )
  }
  return { total: vivo.total, items: vivo.items, nota: notas.join(' ') || undefined, aplicados }
}
