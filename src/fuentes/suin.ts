/**
 * SUIN-Juriscol (Ministerio de Justicia).
 *
 * Existe por una sola razón: es la única fuente oficial del país que publica el
 * ESTADO DE VIGENCIA como dato. Ni el Gestor Normativo ni la relatoría lo
 * tienen, y por eso hasta ahora ninguna respuesta podía decir si una norma
 * sigue vigente.
 *
 * El portal se rehízo entre el 2026-09-16 y el 2026-09-24 (medido): hasta el 16
 * respondía 301 a todo; desde entonces `www.suin-juriscol.gov.co` es una SPA de
 * Angular que sirve la MISMA página vacía de 4.758 bytes a cualquier ruta,
 * `viewDocument.asp?id=` incluida, así que la ficha HTML con sus
 * `<span field="…">` ya no existe. Lo que hay ahora:
 *
 * - La FICHA sale del índice de Elasticsearch que consulta el buscador nuevo
 *   (`lexis.minjusticia.gov.co/elasticsearch/documents_stg`), público y sin
 *   clave: 64.792 decretos y 11.094 leyes con `tipo`, `subtipo`, `numero`,
 *   `anio`, `epigrafe` y `estado`. Ese `estado` ES el campo de la ficha vieja:
 *   la Ley 74 de 1923 da "Derogado" (la ficha decía DEROGADO; el índice de Azure
 *   dice "Vigencia en Estudio") y la Ley 1541 de 2012 "Vigencia en Estudio" (el
 *   campo de la ficha, no la prosa "Vigente"). Y trae decretos, que el índice
 *   empaquetado casi no tenía: la vigencia de un decreto deja de ser "no consta".
 * - Ese índice LLEGA HASTA 2020: el año más alto con documentos es 2020 (737), y
 *   la Ley 2124 de 2021 o la 2281 de 2023 no están. Una norma posterior sale
 *   "no consta" diciendo por qué; no se corta por año en el código, para que el
 *   día que carguen lo reciente se lea sin tocar nada.
 * - El TEXTO no se puede leer desde fuera: el visor nuevo lo pide a
 *   `http://192.168.8.64:10015` y los enlaces del buscador apuntan a
 *   `http://192.168.8.145/viewDocument.asp`, direcciones de red privada. Medido
 *   con un navegador: la página carga, la petición del texto no termina y el
 *   cuerpo queda con 0 caracteres. Se devuelve la ficha y se dice que el texto
 *   no está al alcance.
 */
import { readFileSync } from 'node:fs'
import { CanarioError, limpiarTermino, sinTildes } from '../nucleo/parse.ts'
import { pedir, pedirJson } from '../nucleo/http.ts'
import { esStopword } from '../nucleo/stopwords.ts'

/**
 * Dirección pública del documento: la clásica de SUIN, con el id que el propio
 * buscador nuevo usa en sus enlaces (`visualizacion`). Hoy sirve la SPA vacía,
 * pero es el identificador con el que el documento se cita y el único enlace
 * público: el del portal nuevo apunta a una dirección privada.
 */
export const enlaceSuin = (id: string | number): string => `https://www.suin-juriscol.gov.co/viewDocument.asp?id=${id}`

/** El año más alto con documentos en el índice de fichas (medido el 2026-09-24). */
const ULTIMO_ANIO_INDICE = 2020

/** Lo que se dice cuando haría falta el texto de un documento de SUIN. */
export const TEXTO_NO_PUBLICO =
  'SUIN-Juriscol no sirve hoy el texto de sus documentos fuera de la red del Ministerio de Justicia (medido el ' +
  '2026-09-24: su visor lo pide a una dirección privada y la página queda en blanco), así que el articulado no ' +
  'se puede leer ni aquí ni en el enlace.'

export const claveSuin = (tipo: string, numero: string, anio: string): string =>
  `${tipo.toLowerCase()} ${Number(numero)} ${anio}`

/**
 * Metadatos de un documento de SUIN. El estado se devuelve literal, sin
 * reducirlo a un booleano: SUIN distingue "Vigente", "Derogado", "Vigencia en
 * Estudio", "Compilado"…, y un sí/no inventaría una certeza que la fuente no da.
 *
 * `id` es el de `visualizacion`, que es el id clásico de SUIN (el de
 * `viewDocument.asp?id=` y el del índice empaquetado): el `id` del índice nuevo
 * es otro y difiere en uno para 619 leyes (Ley 1945 de 2019: 30036079 frente a
 * 30036080).
 */
export type Ficha = {
  id: string
  tipo: string
  subtipo: string
  numero: string
  anio: string
  epigrafe: string
  estado: string
  url: string
}

/** El índice de fichas del buscador nuevo de SUIN. */
const FICHAS = 'https://lexis.minjusticia.gov.co/elasticsearch/documents_stg/_search'

/** La forma que se espera del índice; `fichasDe` comprueba lo que usa. */
export type RespuestaFichas = {
  hits?: {
    hits?: {
      /** Solo en consultas ordenadas: lo usa la paginación del generador del índice. */
      sort?: number[]
      _source?: {
        id?: number | string
        visualizacion?: number | string | null
        tipo?: string | null
        subtipo?: string | null
        numero?: string | null
        anio?: string | null
        epigrafe?: string | null
        estado?: string | null
      }
    }[]
  }
}

/**
 * Las fichas de una respuesta del índice. Una respuesta sin la lista de
 * resultados es el portal cambiado, no una norma inexistente: se lanza el
 * canario para que se note en vez de leerse como "no consta".
 */
export function fichasDe(json: RespuestaFichas | null | undefined): Ficha[] {
  const hits = json?.hits?.hits
  if (!Array.isArray(hits)) throw new CanarioError('el índice de fichas de SUIN no trae hits.hits')
  return hits
    .map((h) => h._source ?? {})
    .filter((d) => (d.visualizacion ?? d.id) != null && d.tipo && d.numero && d.anio)
    .map((d) => {
      const id = String(d.visualizacion ?? d.id)
      return {
        id,
        tipo: String(d.tipo).toUpperCase(),
        subtipo: String(d.subtipo ?? '').toUpperCase(),
        numero: String(d.numero),
        anio: String(d.anio),
        epigrafe: (d.epigrafe ?? '').replace(/\s+/g, ' ').trim(),
        estado: (d.estado ?? '').trim(),
        url: enlaceSuin(id),
      }
    })
}

// --- buscador (Azure Cognitive Search) ------------------------------------

/**
 * El índice de Azure Cognitive Search que consultaba el front anterior de SUIN:
 * 56.832 documentos con epígrafe, sector, materia y entidad emisora. Sigue
 * respondiendo (medido el 2026-09-24) y es lo que permite explorar SUIN por
 * materia; el índice empaquetado solo sabe traducir una cita a un id.
 *
 * DOS LÍMITES MEDIDOS, y por eso esto NO sustituye a `ficha()`:
 *
 * 1. Su campo `vigencia` contradice a la ficha. La Ley 74 de 1923 (id 1622206)
 *    aparece aquí como "Vigencia en Estudio" y su ficha dice "Derogado". Solo
 *    82 de 56.832 figuran derogadas (0,14%): parece el estado de la carga
 *    inicial, no el actual. Se devuelve rotulado como dato del buscador.
 * 2. No sirve para resolver citas: "LEY 909 DE 2004" devuelve cero resultados.
 *    Para eso está `ficha()`.
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
      url: enlaceSuin(d.ID ?? ''),
    })),
  }
}

// --- índice empaquetado ---------------------------------------------------

/**
 * Mapa "ley 909 2004" → id, generado con scripts/generar-indice-suin.ts. Ya no
 * hace falta para la vigencia —la ficha se pide por tipo, número y año—; queda
 * para `buscarEnIndice`, que resuelve una cita escrita como texto sin red.
 */
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
  indice = null
  return indice
}

/** Qué cubre el índice empaquetado, para poder declararlo en vez de prometerlo. */
export function coberturaIndice(): { generado: string; leyes: number } | null {
  const idx = cargarIndice()
  return idx ? { generado: idx.generado, leyes: Object.keys(idx.normas).length } : null
}

// --- ficha por identidad ------------------------------------------------------

/** Los estados de la ficha, para que quien llama los distinga. */
export type EstadoFicha =
  | { ok: true; ficha: Ficha }
  | {
      ok: false
      razon: 'ficha-caida' | 'no-consta'
      /** Qué se vio exactamente: sin esto, una caída del portal y un corte del
       *  cliente se leen igual y no hay nada que comprobar. */
      detalle?: string
    }

const cacheFichas = new Map<string, { ficha: Ficha; ts: number }>()
const TTL_FICHA = 30 * 60 * 1000

/** Mayúsculas sin tildes y con los espacios colapsados. */
const normalizaTipo = (s: string): string => sinTildes(s).toUpperCase().replace(/\s+/g, ' ').trim()

/** "01235" y "1235" son el mismo número. */
const sinCeros = (n: string): string => (/^\d+$/.test(n) ? String(Number(n)) : n)

/**
 * ¿Esta ficha ES la norma pedida? Número y año exactos, y el tipo pedido tiene
 * que ser el tipo de la ficha o su subtipo. Con el portal viejo, "Decreto 1235
 * de 2023" devolvía primero "DECRETO 1235 DE 1952": acertar la forma y fallar
 * el fondo. El índice ya filtra por número y año, pero se vuelve a comprobar
 * aquí porque es lo único que separa una vigencia real de una ajena.
 *
 * "Decreto" casa con un DECRETO de subtipo DECRETO LEY: en Colombia los decretos
 * de un año comparten una sola numeración, así que son el mismo documento. Al
 * revés no: "Ley" no casa con un DECRETO LEY.
 */
export function esLaPedida(f: Ficha, tipo: string, numero: string, anio: string): boolean {
  const pedido = normalizaTipo(tipo)
  const tipoOk = pedido === f.tipo || pedido === normalizaTipo(f.subtipo) || pedido.startsWith(`${f.tipo} `)
  return tipoOk && sinCeros(f.numero) === sinCeros(numero) && f.anio === anio
}

/**
 * La ficha de SUIN de una norma por su tipo, número y año, con el estado de
 * vigencia que publica. Cualquier tipo: leyes, decretos, actos legislativos.
 *
 * Tres estados y no un `null`: la ficha, "no consta" (SUIN no tiene esa norma)
 * y "ficha caída" (no se pudo preguntar), porque los dos últimos se leen igual
 * si no se separan y solo el primero es un dato. Se cachea 30 min por norma.
 *
 * `pedirJson` es inyectable para probar los tres estados sin red.
 */
export async function ficha(
  tipo: string,
  numero: string,
  anio: string,
  deps: { pedirJson?: (url: string, cuerpo: unknown) => Promise<RespuestaFichas> } = {},
): Promise<EstadoFicha> {
  const clave = claveSuin(tipo, numero, anio)
  const cache = cacheFichas.get(clave)
  if (cache && Date.now() - cache.ts < TTL_FICHA) return { ok: true, ficha: cache.ficha }

  let fichas: Ficha[]
  try {
    const json = await (deps.pedirJson ?? ((u, c) => pedirJson<RespuestaFichas>(u, c, 8_000)))(FICHAS, {
      size: 10,
      query: {
        bool: {
          filter: [{ term: { 'numero.keyword': sinCeros(numero) } }, { term: { 'anio.keyword': anio } }],
        },
      },
    })
    fichas = fichasDe(json)
  } catch (e) {
    // Con un corte de 8 s: la ficha es un complemento de la respuesta, y un
    // portal caído tardaba ~21 s en fallar por el ETIMEDOUT del sistema.
    return { ok: false, razon: 'ficha-caida', detalle: (e as Error).message }
  }
  const f = fichas.find((x) => esLaPedida(x, tipo, numero, anio))
  if (!f) {
    return Number(anio) > ULTIMO_ANIO_INDICE
      ? {
          ok: false,
          razon: 'no-consta',
          detalle:
            `el índice público de SUIN-Juriscol llega hasta ${ULTIMO_ANIO_INDICE} (medido el 2026-09-24), así que ` +
            `de una norma de ${anio} no puede haber ficha ahí: su ausencia no dice nada sobre la norma`,
        }
      : { ok: false, razon: 'no-consta' }
  }
  cacheFichas.set(clave, { ficha: f, ts: Date.now() })
  return { ok: true, ficha: f }
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
      url: enlaceSuin(id),
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
