/**
 * SUIN-Juriscol (Ministerio de Justicia).
 *
 * Existe por una sola razón: es la única fuente oficial del país que publica el
 * ESTADO DE VIGENCIA como dato. Ni el Gestor Normativo ni la relatoría lo
 * tienen, y por eso hasta ahora ninguna respuesta podía decir si una norma
 * sigue vigente.
 *
 * El portal se rehízo en septiembre de 2026 y volvió a cambiar en octubre
 * (medido el 2026-10-14). `www.suin-juriscol.gov.co` sigue siendo una SPA que
 * sirve la misma página vacía a cualquier ruta; lo vivo está en
 * `lexis.minjusticia.gov.co`, cuyo front (`buscador/Detallado/{1,2,3}`:
 * reglamentos técnicos, jurisprudencia y normas) habla con dos backends
 * públicos y sin clave:
 *
 * - El índice de Elasticsearch `documents_pdn` (antes `documents_stg`, que
 *   sigue respondiendo con una carga vieja de 82.445 documentos que se cortaba
 *   en 2020). `documents_pdn` tiene 103.326 documentos cargados el 2026-10-02 y
 *   llega a 2026 (1.078 normas de ese año): la Ley 2124 de 2021 y la 2281 de
 *   2023 ya están. `configid` separa las colecciones: 30 normas (89.879: leyes,
 *   decretos, resoluciones, circulares, directivas…), 200 Corte Constitucional
 *   (7.609), 100 Consejo de Estado (3.483) y 300 Corte Suprema (2.355). Su
 *   `estado` ES el campo de la ficha: la Ley 74 de 1923 da "Derogado" y la Ley
 *   1541 de 2012 "Vigencia en Estudio". Los reglamentos técnicos no son otra
 *   colección: el front los filtra por `materia` dentro de las normas.
 * - `suin-search/api/documentos/{id}`, que devuelve el documento entero en
 *   `textoHtml` (la Ley 909 de 2004: 175.015 caracteres) con el articulado, el
 *   resumen de modificaciones por artículo, el de jurisprudencia y el estado
 *   de vigencia. Un id inexistente da 204 sin cuerpo. Es lo que pinta el visor
 *   `lexis.minjusticia.gov.co/minjusticia/viewDocument/{id}` (medido con un
 *   navegador: 97.221 caracteres en su iframe), así que el TEXTO de SUIN vuelve
 *   a leerse; hasta el 2026-09-24 el visor lo pedía a una dirección privada.
 */
import { readFileSync } from 'node:fs'
import { TTL_BUSQUEDA_MS } from '../nucleo/cache.ts'
import { CanarioError, cargar, limpiarTermino, sinTildes, textoDe } from '../nucleo/parse.ts'
import { pedir, pedirJson } from '../nucleo/http.ts'
import { esStopword } from '../nucleo/stopwords.ts'

const LEXIS = 'https://lexis.minjusticia.gov.co'

/**
 * Dirección pública del documento: el visor del portal nuevo, que sí pinta el
 * texto. La clásica `www.suin-juriscol.gov.co/viewDocument.asp?id=` (la que
 * aún devuelve el propio API en `url`) sirve la SPA vacía. El id es el clásico
 * de SUIN: el de `visualizacion` en el índice y el del índice empaquetado.
 */
export const enlaceSuin = (id: string | number): string => `${LEXIS}/minjusticia/viewDocument/${id}`

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

/** El índice de Elasticsearch del buscador nuevo de SUIN: fichas y búsqueda. */
const INDICE = `${LEXIS}/elasticsearch/documents_pdn/_search`

/** Las colecciones del índice, por su `configid`. */
export const COLECCIONES = {
  normas: 30,
  'corte-constitucional': 200,
  'consejo-estado': 100,
  'corte-suprema': 300,
} as const
export type Coleccion = keyof typeof COLECCIONES

/** Un documento del índice, con los campos que se usan. */
type DocIndice = {
  id?: number | string
  visualizacion?: number | string | null
  configid?: number | null
  name?: string | null
  titulo?: string | null
  tipo?: string | null
  subtipo?: string | null
  numero?: string | null
  anio?: string | null
  epigrafe?: string | null
  estado?: string | null
  entidad?: string | null
  sector?: string | null
  normademandada?: string | null
  magistradoponente?: string | null
  consejeroponente?: string | null
  magistradosuprema?: string | null
}

/** La forma que se espera del índice; `fichasDe` y `resultadosDe` comprueban lo que usan. */
export type RespuestaFichas = {
  hits?: {
    total?: { value?: number } | number
    hits?: {
      /** Solo en consultas ordenadas: lo usa la paginación del generador del índice. */
      sort?: number[]
      _source?: DocIndice
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

// --- buscador (Elasticsearch del portal nuevo) ------------------------------

/**
 * La búsqueda por texto del portal nuevo: la misma `multi_match` de su caja
 * general sobre `documents_pdn`, acotada a una colección por `configid`.
 * Sustituye al índice de Azure Cognitive Search del front anterior, cuyo campo
 * de vigencia contradecía la ficha (la Ley 74 de 1923 figuraba "Vigencia en
 * Estudio"), que no resolvía citas ("LEY 909 DE 2004" daba cero) y que no
 * encontraba la Ley 1221 de 2008 por "teletrabajo". Aquí, medido el
 * 2026-10-14, las tres cosas salen bien: el `estado` es el de la ficha.
 *
 * `materia` va como frase y no como término exacto: el campo junta varias
 * materias con "|" ("Administrativo general|Laboral administrativo"), y el
 * término exacto del front solo casa con los documentos de una sola.
 */
export type ResultadoSuin = {
  id: string
  titulo: string
  subtipo: string
  epigrafe: string
  /** El `estado` de la ficha; en jurisprudencia no lo hay. */
  vigencia: string
  /** Entidad emisora; en jurisprudencia, el ponente. */
  entidad: string
  url: string
}

/** Campos de la caja general del portal, con sus mismos pesos. */
const CAMPOS_TEXTO = [
  'name^5',
  'epigrafe^2',
  'anio^2',
  'materia^2',
  'tipo',
  'tipodocumento',
  'numero',
  'sector',
  'subtipo',
  'estado',
  'entidad',
  'accionante',
  'demandante',
  'magistradoponente',
  'consejeroponente',
  'magistradosuprema',
  'normademandada',
  'documentofuente',
  'numerodiariooficial',
  'numeroradicacionproceso',
]

/** El cuerpo de la consulta, separado para probarlo sin red. */
export function consultaBusqueda(opts: {
  texto: string
  coleccion?: Coleccion | undefined
  vigencia?: string | undefined
  sector?: string | undefined
  materia?: string | undefined
  desde?: number | undefined
  limite?: number | undefined
}): Record<string, unknown> {
  const texto = limpiarTermino(opts.texto)
  const filtro: Record<string, unknown>[] = [{ term: { configid: COLECCIONES[opts.coleccion ?? 'normas'] } }]
  if (opts.vigencia) filtro.push({ term: { 'estado.keyword': opts.vigencia } })
  if (opts.sector) filtro.push({ term: { 'sector.keyword': opts.sector } })
  const debe: Record<string, unknown>[] = []
  // Las palabras pueden repartirse entre campos (el tipo en `name`, el año en `anio`), pero tienen que estar:
  // con el `or` de la caja del portal, "LEY 909 DE 2004" reunía 89.151 documentos. Hasta dos palabras se exigen
  // todas; con más, tres de cada cuatro, para que una frase larga no se quede en cero por una sola.
  if (texto) {
    debe.push({ multi_match: { query: texto, fields: CAMPOS_TEXTO, type: 'cross_fields', minimum_should_match: '2<75%' } })
  }
  if (opts.materia) debe.push({ match_phrase: { materia: opts.materia } })
  return {
    from: Math.max(0, opts.desde ?? 0),
    size: Math.min(Math.max(opts.limite ?? 15, 1), 50),
    track_total_hits: true,
    query: { bool: { filter: filtro, must: debe } },
  }
}

/** Espacios colapsados: los campos del índice y del visor traen saltos y dobles espacios. */
const plano = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Los resultados de una respuesta del índice; sin `hits.hits` es el portal cambiado. */
export function resultadosDe(json: RespuestaFichas | null | undefined): { total: number; items: ResultadoSuin[] } {
  const hits = json?.hits?.hits
  if (!Array.isArray(hits)) throw new CanarioError('el índice de SUIN no trae hits.hits')
  const t = json?.hits?.total
  const total = typeof t === 'number' ? t : (t?.value ?? hits.length)
  const items = hits
    .map((h) => h._source ?? {})
    .filter((d) => (d.visualizacion ?? d.id) != null)
    .map((d) => {
      const id = String(d.visualizacion ?? d.id)
      const ponente = d.magistradoponente ?? d.consejeroponente ?? d.magistradosuprema ?? ''
      const jurisprudencia = d.configid != null && d.configid !== COLECCIONES.normas
      return {
        id,
        // Al `name` de una providencia le sobran el sello de tiempo del final y los "null" de campos vacíos.
        titulo: plano(
          (jurisprudencia ? (d.name ?? d.titulo ?? '') : (d.titulo ?? d.name ?? ''))
            .replace(/\s+\d{9,}\s*$/, '')
            .replace(/\bnull\b/g, ''),
        ),
        subtipo: plano(d.subtipo ?? ''),
        epigrafe: plano((jurisprudencia ? (d.normademandada ?? d.epigrafe) : d.epigrafe) ?? ''),
        vigencia: plano(d.estado ?? ''),
        entidad: plano(jurisprudencia ? ponente : (d.entidad ?? '')),
        url: enlaceSuin(id),
      }
    })
  return { total, items }
}

export async function buscar(
  opts: Parameters<typeof consultaBusqueda>[0],
  deps: { pedirJson?: (url: string, cuerpo: unknown) => Promise<RespuestaFichas> } = {},
): Promise<{ total: number; items: ResultadoSuin[] }> {
  const json = await (deps.pedirJson ?? ((u, c) => pedirJson<RespuestaFichas>(u, c, 40_000)))(INDICE, consultaBusqueda(opts))
  return resultadosDe(json)
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

const cacheFichas = new Map<string, { estado: EstadoFicha; ts: number }>()
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
  if (cache && Date.now() - cache.ts < (cache.estado.ok ? TTL_FICHA : TTL_BUSQUEDA_MS)) return cache.estado

  let fichas: Ficha[]
  try {
    const json = await (deps.pedirJson ?? ((u, c) => pedirJson<RespuestaFichas>(u, c, 8_000)))(INDICE, {
      size: 10,
      query: {
        bool: {
          filter: [
            { term: { configid: COLECCIONES.normas } },
            { term: { 'numero.keyword': sinCeros(numero) } },
            { term: { 'anio.keyword': anio } },
          ],
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
  // Se recuerda el veredicto firme, la ficha y también el «no consta» (sin esto se volvía a preguntar en
  // cada herramienta); nunca la ficha caída, que se devolvió arriba.
  const estado: EstadoFicha = f ? { ok: true, ficha: f } : { ok: false, razon: 'no-consta' }
  cacheFichas.set(clave, { estado, ts: Date.now() })
  return estado
}

// --- texto del documento ------------------------------------------------------

const DOCUMENTOS = `${LEXIS}/suin-search/api/documentos/`

/** Una afectación del resumen de SUIN: qué artículo, qué le pasó y por qué norma o sentencia. */
export type Afectacion = { articulo: string; accion: string; por: string }

/**
 * Un documento de SUIN leído de su API. `texto` es el articulado (o el cuerpo
 * de la providencia); los resúmenes son los que el visor muestra plegados: las
 * modificaciones por artículo, la jurisprudencia que lo afectó y las notas de
 * vigencia de la norma entera. Son datos del portal, copiados sin interpretar.
 */
export type DocumentoSuin = {
  id: string
  titulo: string
  epigrafe: string
  estado: string
  entidad: string
  url: string
  texto: string
  modificaciones: Afectacion[]
  jurisprudencia: Afectacion[]
  notasVigencia: string[]
  fechas: Record<string, string>
}

type RespuestaDocumento = {
  success?: boolean
  data?: {
    id?: number | string
    textoHtml?: string | null
    vigencia?: string | null
    epigrafe?: string | null
    entidadEmisora?: string | null
  } | null
}

/**
 * El documento a partir de la respuesta del API, sin red. Sin `textoHtml` es el
 * portal cambiado: canario. El articulado de una norma es el último `div` del
 * cuerpo (el resto es la barra del visor, el carrusel de cursos y las tablas
 * plegadas); una providencia no tiene esa estructura y se lee el cuerpo sin la
 * barra. Los rótulos de artículo salen pegados al texto ("Artículo 10.Régimen"):
 * se les devuelve el espacio para que el índice de artículos los reconozca.
 */
export function documentoDe(json: RespuestaDocumento | null | undefined, id: string): DocumentoSuin {
  const d = json?.data
  if (!d || typeof d.textoHtml !== 'string') throw new CanarioError('el documento de SUIN no trae data.textoHtml')
  const $ = cargar(d.textoHtml)

  const afectaciones = (sel: string): Afectacion[] =>
    $(sel)
      .find('li.resumenvigencias')
      .toArray()
      .flatMap((li) => {
        const articulo = plano($(li).children('b').first().text()).replace(/:$/, '')
        return $(li)
          .find('li.referencia')
          .toArray()
          .map((ref) => {
            const por = plano($(ref).find('a').last().text())
            return { articulo, accion: plano(plano($(ref).text()).replace(por, '')), por }
          })
      })
  const modificaciones = afectaciones('[id$=ResumenNotasVigencia]')
  const jurisprudencia = afectaciones('[id$=ResumenAfectacionesJurisp]')
  const notasVigencia = $('#tablita > ul.resumenvigencias > li.referencia')
    .toArray()
    .map((li) => plano($(li).text()))
    .filter(Boolean)

  // Las fechas van en parejas de párrafos (rótulo, valor) en la tabla del estado de vigencia.
  const fechas: Record<string, string> = {}
  const parrafos = $('table#toc p')
    .toArray()
    .map((p) => plano($(p).text()))
  parrafos.forEach((p, i) => {
    const valor = parrafos[i + 1] ?? ''
    if (/^Fecha de /i.test(p) && /^\d{2}\/\d{2}\/\d{4}$/.test(valor)) fechas[p] = valor
  })

  const titulo = plano($('#titulotipo').text())
  let texto: string
  if (titulo) {
    texto = textoDe(cargar(`<main>${$.html($('body').children('div').last())}</main>`), 'main')
  } else {
    $('header, #toolPanel, #toolFab, .slider, table#toc, [style*="display: none"]').remove()
    texto = textoDe($, 'body')
  }
  texto = texto.replace(/(\b(?:ART[IÍ]CULO|Art[ií]culo)\s+\d+[A-Za-z]?\s*[°ºo]?\.)(?=[^\s\d])/g, '$1 ')

  return {
    id,
    titulo,
    // En las providencias el API manda el texto literal "null" en todos estos campos (medido el 2026-10-14).
    epigrafe: d.epigrafe === 'null' ? '' : plano(d.epigrafe ?? ''),
    estado: d.vigencia === 'null' ? '' : plano(d.vigencia ?? ''),
    entidad: d.entidadEmisora === 'null' ? '' : plano(d.entidadEmisora ?? ''),
    url: enlaceSuin(id),
    texto,
    modificaciones,
    jurisprudencia,
    notasVigencia,
    fechas,
  }
}

/**
 * El documento de SUIN por su id clásico (el de `visualizacion` y de los
 * enlaces). `null` si el portal no lo tiene: su API responde 204 sin cuerpo.
 */
export async function documento(
  id: string,
  deps: { pedir?: typeof pedir } = {},
): Promise<DocumentoSuin | null> {
  if (!/^\d+$/.test(id)) throw new Error(`Id de SUIN inválido: "${id}". Es numérico, el de buscar_en_suin o resolver_cita.`)
  const r = await (deps.pedir ?? pedir)(`${DOCUMENTOS}${id}`, 60_000, 'application/json')
  if (r.status === 204 || (r.status === 200 && !r.cuerpo.trim())) return null
  if (r.status !== 200) throw new Error(`SUIN-Juriscol respondió ${r.status} al pedir el documento ${id}.`)
  let json: RespuestaDocumento
  try {
    json = JSON.parse(r.cuerpo) as RespuestaDocumento
  } catch {
    throw new CanarioError('el documento de SUIN no llegó como JSON')
  }
  return documentoDe(json, id)
}

// --- búsqueda por texto con índice de leyes ----------------------------------

/** Clave normalizada (sin tildes, minúsculas) del epígrafe de una ley. */
const normaliza = (s: string): string => sinTildes(s).toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Búsqueda por texto sobre el índice de leyes empaquetado. A diferencia del
 * buscador del portal, no normaliza tildes ni deriva: "Teletrabajo" no casa con
 * "trabajo remoto", así que una ley solo aparece si su título contiene la
 * palabra exacta, sin tildes.
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
 * rinde 0, cae al buscador vivo del portal (que sí normaliza y deriva: encuentra
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
  aplicados.push('buscador del portal')
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
