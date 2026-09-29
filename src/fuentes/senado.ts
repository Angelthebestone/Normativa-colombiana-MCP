/**
 * Senado — «Leyes desde 1992» de la Secretaría del Senado (Avance Jurídico Casa
 * Editorial S.A.S.). Es la única fuente de este MCP que sirve el articulado del
 * Código Civil (Ley 84 de 1873): ni el Gestor Normativo lo tiene ni SUIN sirve
 * su texto, así que sin esta fuente «el art. 946 del Código Civil» no se puede leer.
 *
 * Todo lo de aquí abajo está medido contra el portal el 2026-09-28:
 *
 * - **HTTP plano, sin cifrar.** El puerto 443 del host no abre, así que se baja
 *   por `http:` (la capa de transporte ya acepta URLs `http:`). El texto viaja
 *   SIN cifrar ni autenticar: es una limitación de la fuente que no se puede
 *   arreglar desde aquí y que el llamador debe declarar. Por eso este módulo no
 *   promete autenticidad criptográfica, solo el texto que el Senado publica.
 * - **ISO-8859-1** declarada en el propio `<meta content="…charset=ISO-8859-1">`,
 *   que es lo que `decodificar` lee: la ñ y las tildes salen bien (comprobado
 *   artículo por artículo, ver el informe).
 * - **El índice es `codigo_civil.html`** (~168 KB) y trae un `<select>` con una
 *   `<option>` por artículo (2.684 en total) cuyo `value` mapea artículo → parte.
 *   El separador entre parte y ancla es el byte **0xE7 («ç»)**, no un guion:
 *   `_pr001ç#33` significa parte `codigo_civil_pr001.html`, ancla `33`. Los
 *   artículos 1–32 viven en el propio índice y su `value` no nombra parte
 *   (`#2`) o nombra el propio fichero (`çcodigo_civilç.htmlç#1`).
 * - **El `<select>` omite 14 artículos**, medido: 11 sí están publicados en el
 *   articulado (28, 31, 35, 37, 156, 160, 262, 655, 1025, 1045, 1264 —el ancla
 *   `name="35"` existe en `codigo_civil_pr001.html` aunque falte su `<option>`)
 *   y 3 no aparecen por ningún lado (264, 637, 642). Por eso la parte de un
 *   artículo ausente del `<select>` se deduce del vecino más cercano —las partes
 *   cubren tramos contiguos— en vez de responder `no-existe`.
 * - **Los apartes tachados van en `<S>`** y el portal los marca como
 *   «INEXEQUIBLE» o derogados en ese tramo. Se conservan como `~~…~~`: leer un
 *   tachado como vigente es el error grave de esta fuente.
 * - **Las cajas de notas no se tocan.** «Jurisprudencia Vigencia» y «Notas del
 *   Editor» son tablas VACÍAS que rellena JavaScript, y el pie del portal dice
 *   que esas notas, concordancias y notas del editor son de Avance Jurídico Casa
 *   Editorial y que su copia está prohibida. Se devuelve el texto de la norma y
 *   un `url` citable donde el portal anota vigencia y jurisprudencia del artículo.
 * - **La página declara su fecha** («Última actualización: 15 de septiembre de
 *   2026 - (Diario Oficial No. 53.619…)»), que se devuelve para saber de cuándo
 *   es el texto.
 *
 * Modelo de estilo: `src/fuentes/anh.ts`.
 */
import { CanarioError, cargar, colapsarEspacios } from '../nucleo/parse.ts'
import { pedir } from '../nucleo/http.ts'

export const BASE_SENADO = 'http://www.secretariasenado.gov.co/senado/basedoc'

export type ResultadoArticulo =
  | { ok: true; archivo: string; numero: string; texto: string; url: string; actualizacion: string; tachados: boolean }
  | { ok: false; razon: 'no-existe' | 'no-respondio' | 'formato'; detalle: string }

/** Ancla del portal: `<a class="bookmarkaj" name="33">` o `<A name="35">`. */
const ANCLA = String.raw`<a\b[^>]*\sname\s*=\s*["']?([\w-]+)["']?[^>]*>`
/** Ancla de ARTÍCULO (nombre numérico); distingue «sin artículos» de «sin ese artículo». */
const ANCLA_ARTICULO = String.raw`<a\b[^>]*\sname\s*=\s*["']?\d+["']?[^>]*>`
/** `<option …>…` — el `value` se lee aparte, el texto es el número del artículo. */
const OPCION = String.raw`<option\b([^>]*)>([\s\S]*?)(?=<\/option>|<option\b|<\/select>)`
/** ¿El ancla es de un artículo? Las de encabezado («Nivel091») no son numéricas. */
const esArticulo = (nombre: string): boolean => /^\d+$/.test(nombre)

/**
 * Mapa número de artículo → fichero de la parte que lo contiene, leído del
 * `<select>` del índice. `archivo` es el nombre sin extensión («codigo_civil»).
 */
export function parsearIndice(html: string, archivo: string): Map<string, string> {
  const sel = /<select[^>]*>[\s\S]*?<\/select>/i.exec(html)?.[0]
  if (!sel) throw new CanarioError(`el índice del Senado de "${archivo}" ya no trae el <select> de artículos`)
  const mapa = new Map<string, string>()
  for (const m of sel.matchAll(new RegExp(OPCION, 'gi'))) {
    const valor = /value\s*=\s*"([^"]*)"/i.exec(m[1] ?? '')?.[1] ?? ''
    const texto = (m[2] ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()
    if (!/^\d+$/.test(texto)) continue // las opciones «TITULO XVII» separan secciones, no son artículos
    const parte = /_pr(\d+)/.exec(valor)?.[1]
    mapa.set(texto, parte ? `${archivo}_pr${parte}.html` : `${archivo}.html`)
  }
  if (!mapa.size) throw new CanarioError(`el <select> del índice de "${archivo}" no trae ninguna opción de artículo`)
  return mapa
}

/**
 * Parte que contiene el artículo. Si el `<select>` no lo lista —omite 14, medido—
 * se usa la del vecino conocido más cercano: las partes cubren tramos contiguos
 * de artículos, así que el artículo ausente cae en la parte de al lado. Preferir
 * el vecino menor es lo que acierta en los 11 casos medidos.
 */
export function parteDe(mapa: Map<string, string>, numero: string): string | undefined {
  const directo = mapa.get(numero)
  if (directo !== undefined) return directo
  const n = Number(numero)
  if (!Number.isInteger(n)) return undefined
  let menor: number | undefined
  let mayor: number | undefined
  for (const clave of mapa.keys()) {
    const k = Number(clave)
    if (k < n && (menor === undefined || k > menor)) menor = k
    if (k > n && (mayor === undefined || k < mayor)) mayor = k
  }
  const vecino = menor ?? mayor
  return vecino === undefined ? undefined : mapa.get(String(vecino))
}

/**
 * Texto del artículo `numero` dentro del HTML de una parte. El artículo va de su
 * ancla a la frontera siguiente, que puede ser el ancla del artículo de al lado
 * o la de un encabezado (`name="Nivel091"`); así el «CAPÍTULO I» que precede al
 * 947 no se cuela como cola del 946. `null` si el ancla del artículo no está.
 *
 * ponytail: la frontera por encabezado vale para el Código Civil, donde los
 * encabezados separan artículos. Si alguna fuente diese encabezados DENTRO del
 * articulado, habría que acotar por el contenedor del artículo, no por la ancla.
 */
export function extraerArticulo(html: string, numero: string): { texto: string; tachados: boolean } | null {
  const cortes: { numero: string | null; index: number }[] = []
  for (const m of html.matchAll(new RegExp(ANCLA, 'gi'))) {
    const nombre = m[1] ?? ''
    cortes.push({ numero: esArticulo(nombre) ? nombre : null, index: m.index! })
  }
  cortes.sort((a, b) => a.index - b.index)
  const i = cortes.findIndex((c) => c.numero === numero)
  if (i < 0) return null
  const inicio = cortes[i]!.index
  let fin = i + 1 < cortes.length ? cortes[i + 1]!.index : html.length
  const finDocumento = html.indexOf('<!--Fin documento-->')
  if (finDocumento > inicio) fin = Math.min(fin, finDocumento)
  return limpiar(html.slice(inicio, fin))
}

/** Deja el texto del artículo: sin navegación, flechas ni cajas, y `~~` en los tachados. */
function limpiar(fragmento: string): { texto: string; tachados: boolean } {
  const $ = cargar(fragmento)
  $('a[title="Ir al inicio"]').remove()
  // Las cajas de notas («Notas del Editor», «Jurisprudencia Vigencia») son tablas
  // vacías rellenadas por JS y de copia prohibida: se descartan enteras.
  $('.caja_vja_encabezado, table.caja_vja_v').remove()
  $('a.antsig').each((_, el) => {
    const $p = $(el).closest('p')
    if ($p.length) $p.remove()
    else $(el).remove()
  })
  $('s').each((_, el) => {
    const $el = $(el)
    $el.replaceWith(`~~${$el.text()}~~`)
  })
  $('br').replaceWith('\n')
  $('p,div,li,tr,table,blockquote,h1,h2,h3,h4,h5,h6').each((_, el) => {
    $(el).append('\n\n')
  })
  const texto = $.root()
    .text()
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { texto, tachados: /~~/.test(texto) }
}

/** La fecha que la propia página declara, sin el aviso de derechos de autor que la sigue. */
export function fechaDeActualizacion(html: string): string {
  const txt = colapsarEspacios(cargar(html)('#update_date').text())
  return /Última actualizaci[óo]n:\s*(.*?)\s*(?:Derechos de autor|$)/i.exec(txt)?.[1]?.trim() ?? ''
}

async function pedirHtml(url: string): Promise<{ status: number; cuerpo: string } | { fallo: string }> {
  try {
    const r = await pedir(url, 40_000)
    return { status: r.status, cuerpo: r.cuerpo }
  } catch (e) {
    // Fallo de red: se declara con el motivo literal, no se confunde con «no existe».
    return { fallo: (e as Error).message }
  }
}

/**
 * Devuelve el artículo `numero` de `archivo` («codigo_civil») tal como lo publica
 * el Senado. Pide el índice una vez y la parte una vez (`pedir` cachea los .html).
 */
export async function articulo(archivo: string, numero: string): Promise<ResultadoArticulo> {
  const num = String(numero).trim()
  const urlIndice = `${BASE_SENADO}/${archivo}.html`

  const idx = await pedirHtml(urlIndice)
  if ('fallo' in idx) return { ok: false, razon: 'no-respondio', detalle: `${urlIndice}: ${idx.fallo}` }
  if (idx.status !== 200) {
    return { ok: false, razon: 'no-respondio', detalle: `el índice respondió ${idx.status} en ${urlIndice}` }
  }

  const mapa = parsearIndice(idx.cuerpo, archivo)
  const parte = parteDe(mapa, num)
  if (parte === undefined) {
    return { ok: false, razon: 'no-existe', detalle: `el índice de "${archivo}" no lista el artículo ${num}` }
  }

  const urlParte = `${BASE_SENADO}/${parte}`
  let htmlParte = idx.cuerpo
  if (parte !== `${archivo}.html`) {
    const r = await pedirHtml(urlParte)
    if ('fallo' in r) return { ok: false, razon: 'no-respondio', detalle: `${urlParte}: ${r.fallo}` }
    if (r.status !== 200) return { ok: false, razon: 'no-respondio', detalle: `la parte respondió ${r.status} en ${urlParte}` }
    htmlParte = r.cuerpo
  }

  const extraido = extraerArticulo(htmlParte, num)
  if (!extraido) {
    // Sin NINGUNA ancla de artículo el cambio es de plantilla, no de contenido:
    // gritarlo evita que un cambio de marcado se lea como «ese artículo no existe».
    if (!new RegExp(ANCLA_ARTICULO, 'i').test(htmlParte)) {
      throw new CanarioError(`la parte ${parte} del Senado ya no trae anclas de artículo`)
    }
    return {
      ok: false,
      razon: 'no-existe',
      detalle:
        `el artículo ${num} no está en el articulado publicado de "${archivo}" (parte ${parte}): ` +
        `el portal lo omite tanto del índice como del texto`,
    }
  }

  return {
    ok: true,
    archivo,
    numero: num,
    texto: extraido.texto,
    url: `${urlParte}#${num}`,
    actualizacion: fechaDeActualizacion(htmlParte),
    tachados: extraido.tachados,
  }
}

/** Partes internas que las pruebas ejercitan con fixtures, sin red. */
export const _interno = {
  parsearIndice,
  parteDe,
  extraerArticulo,
  fechaDeActualizacion,
}
