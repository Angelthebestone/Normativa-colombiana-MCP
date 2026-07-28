import * as cheerio from 'cheerio/slim'

export const BASE_GESTOR = 'https://www.funcionpublica.gov.co/eva/gestornormativo'

/**
 * El MCP vive del HTML de un portal que puede cambiar sin aviso. Cuando el
 * parseo deja de encontrar lo que esperaba hay que gritarlo: una lista vacía
 * en silencio es indistinguible de "no existe", y en materia legal esa
 * confusión es el peor fallo posible.
 */
export class CanarioError extends Error {
  constructor(que: string) {
    super(
      `El portal cambió su estructura y esta extensión no pudo leer la respuesta (${que}). ` +
        `No es que no haya resultados: es que no se pudieron interpretar. ` +
        `Actualiza la extensión desde https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases`,
    )
    this.name = 'CanarioError'
  }
}

export class NoExisteError extends Error {
  constructor(id: string) {
    super(`No existe un documento con el identificador ${id} en el Gestor Normativo.`)
    this.name = 'NoExisteError'
  }
}

// --- texto ---------------------------------------------------------------

const CON = 'áàäâÁÀÄÂéèëêÉÈËÊíìïîÍÌÏÎóòöôÓÒÖÔúùüûÚÙÜÛñÑçÇ'
const SIN = 'aaaaAAAAeeeeEEEEiiiiIIIIooooOOOOuuuuUUUUnNcC'
const TILDES: Record<string, string> = {}
for (let i = 0; i < CON.length; i++) TILDES[CON[i]!] = SIN[i]!

/** Quita tildes conservando la longitud, para poder cortar el texto original por índice. */
export const sinTildes = (s: string): string =>
  s.replace(/[áàäâÁÀÄÂéèëêÉÈËÊíìïîÍÌÏÎóòöôÓÒÖÔúùüûÚÙÜÛñÑçÇ]/g, (c) => TILDES[c] ?? c)

export const tieneTildes = (s: string): boolean => sinTildes(s) !== s

/**
 * El portal guarda temas en mayúsculas pero con las vocales acentuadas en
 * minúscula ("PROVISIóN - ENCARGO"), porque quien los cargó usó una función que
 * no contempla tildes. Se corrige solo ese artefacto: las erratas del propio
 * dato oficial —"Telebrajo"— se dejan como están, porque son lo que el portal
 * tiene indexado y corregirlas en silencio rompería la correspondencia.
 */
export const normalizarRotulo = (s: string): string =>
  s.replace(/\S+/g, (palabra) => {
    if (!/[áéíóúüñ]/.test(palabra)) return palabra
    // Si al quitar las vocales acentuadas lo que queda son solo mayúsculas,
    // la palabra iba en mayúsculas y la tilde se quedó atrás.
    const resto = palabra.replace(/[áéíóúüñ]/g, '')
    return /[A-ZÁÉÍÓÚÑ]/.test(resto) && resto === resto.toUpperCase() ? palabra.toUpperCase() : palabra
  })

/** Ambos portales devuelven error ante comillas y signos de control en los términos. */
export const limpiarTermino = (s: string): string =>
  s.replace(/["'<>;%\\]/g, ' ').replace(/\s+/g, ' ').trim()

/** Basura que Word deja incrustada en los documentos viejos (ver Ley 114 de 1913). */
const LINEA_BASURA =
  /mso-|MsoNormal|X-NONE|Style Definitions|^\s*\d{4}-\d{2}-\d{2}T[\d:]{8}Z|^\s*<!\[endif\]|^(Clean|false|true|Normal|ES-CO|MicrosoftInternetExplorer\d*)$|^[\d.,]+( pto)?$|^[a-z-]+:[^;]{0,60};$/i

/**
 * Los documentos viejos abren con el bloque de propiedades de Word (autor,
 * revisiones, "Hewlett-Packard", CSS): el portal guardó el HTML de Word quitando
 * las etiquetas pero dejando los valores, así que no queda marca estructural.
 * Se descarta el preámbulo de líneas cortas hasta la primera línea sustantiva.
 *
 * ponytail: heurística acotada a las primeras 80 líneas y solo mientras las
 * líneas sean cortas; si aparece un documento que empiece con muchas líneas
 * cortas legítimas, hay que acotar por selector en vez de por contenido.
 */
const INICIO_REAL =
  /^(LEY|DECRETO|RESOLUCI[ÓO]N|CIRCULAR|ACUERDO|SENTENCIA|CONCEPTO|AUTO|DIRECTIVA|CONSTITUCI[ÓO]N|ACTO|ART[ÍI]CULO|EL |LA |LOS |POR |REP[ÚU]BLICA|MINISTERIO|DEPARTAMENTO)/i

function quitarPreambuloWord(lineas: string[]): string[] {
  let i = 0
  let descartadas = 0
  while (i < lineas.length && descartadas < 40) {
    const l = lineas[i]!
    if (l === '') {
      i++ // los renglones en blanco no gastan el presupuesto de descarte
      continue
    }
    if (INICIO_REAL.test(l) || l.length >= 40) break
    descartadas++
    i++
  }
  return descartadas > 0 && i < lineas.length ? lineas.slice(i) : lineas
}

const DESCARGO = /Los datos publicados tienen prop[óo]sitos exclusivamente informativos[^.]*\./i

function limpiarTexto(bruto: string): string {
  const lineas = bruto
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => !LINEA_BASURA.test(l))

  const utiles = quitarPreambuloWord(lineas)

  let t = utiles.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  // El descargo del propio portal lo emitimos aparte, una vez, no dentro del articulado.
  const m = t.match(DESCARGO)
  if (m && t.indexOf(m[0]) < 400) t = t.slice(t.indexOf(m[0]) + m[0].length).trim()

  return t
}

const BLOQUES = 'p,div,br,tr,li,h1,h2,h3,h4,h5,h6,table,blockquote'

/** Carga HTML quitando de raíz lo que ensucia el texto (scripts, estilos, XML de Word). */
export function cargar(html: string): cheerio.CheerioAPI {
  const limpio = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|xml|o:p)\b[\s\S]*?<\/\1>/gi, ' ')
  return cheerio.load(limpio)
}

export function textoDe($: cheerio.CheerioAPI, selector: string): string {
  const $c = $(selector).first()
  if (!$c.length) return ''
  $c.find(BLOQUES).after('\n')
  return limpiarTexto($c.text())
}

// --- troceado y búsqueda dentro del texto --------------------------------

export type Trozo = { texto: string; total: number; desde: number; omitido: number }

export function trocear(texto: string, desde = 0, limite = 8000): Trozo {
  const ini = Math.max(0, Math.min(desde, texto.length))
  const fin = Math.min(texto.length, ini + limite)
  return { texto: texto.slice(ini, fin), total: texto.length, desde: ini, omitido: texto.length - fin }
}

/**
 * Búsqueda de texto completo del lado del cliente: el buscador del portal solo
 * indexa los resúmenes temáticos, así que es aquí donde realmente se busca
 * dentro del articulado.
 */
export function fragmentos(texto: string, termino: string, contexto = 400, max = 10) {
  const plano = sinTildes(texto).toLowerCase()
  const aguja = sinTildes(termino).toLowerCase().trim()
  if (!aguja) return { total: 0, trozos: [] as string[], pasajes: 0 }

  // Ventanas solapadas se fusionan: dos coincidencias cercanas producían seis
  // extractos casi idénticos y hacían leer lo mismo varias veces.
  const ventanas: { ini: number; fin: number; hits: number }[] = []
  let total = 0
  for (let i = plano.indexOf(aguja); i !== -1; i = plano.indexOf(aguja, i + aguja.length)) {
    total++
    const ini = Math.max(0, i - contexto)
    const fin = Math.min(texto.length, i + aguja.length + contexto)
    const ultima = ventanas.at(-1)
    if (ultima && ini <= ultima.fin) {
      ultima.fin = Math.max(ultima.fin, fin)
      ultima.hits++
    } else {
      ventanas.push({ ini, fin, hits: 1 })
    }
  }

  const trozos = ventanas
    .slice(0, max)
    .map(
      (v) =>
        (v.ini > 0 ? '…' : '') +
        texto.slice(v.ini, v.fin).trim() +
        (v.fin < texto.length ? '…' : '') +
        (v.hits > 1 ? `\n[${v.hits} coincidencias en este pasaje]` : ''),
    )
  return { total, trozos, pasajes: ventanas.length }
}

/** Índice de artículos, para que Claude sepa qué pedir sin traerse la norma entera. */
export function indiceArticulos(texto: string, max = 60): string[] {
  const vistos = new Set<string>()
  const re = /\b(?:ART[IÍ]CULO|Art[ií]culo)\s+([\d.]+[A-Za-z]?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) && vistos.size < max) vistos.add(m[1]!.replace(/\.$/, ''))
  return [...vistos]
}

export function articulo(texto: string, numero: string): string | null {
  const n = numero.replace(/[^\d.A-Za-z]/g, '').replace(/[.]+$/, '')
  if (!n) return null
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`\\b(?:ART[IÍ]CULO|Art[ií]culo)\\s+${esc}\\b`, 'g')
  const m = re.exec(texto)
  if (!m) return null
  const desde = m.index + m[0].length
  // El siguiente artículo tiene que ser un encabezado (inicio de renglón y
  // seguido de su número). Sin esta exigencia, una referencia cruzada dentro de
  // una nota —"Artículo 15 Ley 91 de 1989"— cortaba el artículo por la mitad y
  // se perdían justo las notas de vigencia.
  const sig = texto.slice(desde).search(/\n\s*(?:ART[IÍ]CULO|Art[ií]culo)\s+[\d]/)
  return texto.slice(m.index, sig >= 0 ? desde + sig : Math.min(texto.length, m.index + 20000)).trim()
}

/**
 * La vigencia no es un campo: va incrustada en el articulado. El Decreto 1083
 * trae 155 "Modificado por" y 17 "Derogado". Citar un artículo derogado como
 * vigente es el error caro, así que se advierte sobre el fragmento devuelto.
 */
export function advertenciasVigencia(texto: string): string[] {
  const avisos: string[] = []
  const derogado = (texto.match(/\bDerogad[oa]\b/gi) ?? []).length
  const modificado = (texto.match(/\bModificad[oa] por\b/gi) ?? []).length
  if (derogado) avisos.push(`El texto mostrado contiene ${derogado} marca(s) de derogatoria. Verifica si el aparte que te interesa sigue vigente.`)
  if (modificado) avisos.push(`Contiene ${modificado} nota(s) de "Modificado por". El texto original pudo haber cambiado.`)
  return avisos
}

// --- parsers del Gestor Normativo ----------------------------------------

export type Resultado = { id: string; titulo: string; resumen: string; url: string }

/**
 * Enlaces a normas de cualquier listado del portal (resultados, normas FP…).
 *
 * `termino` sirve para elegir el resumen: una norma puede traer varios
 * restrictores y el portal no ordena por pertinencia, así que al buscar
 * "teletrabajo" el Decreto 1083 salía resumido como "estándares para la
 * elección de personeros". Se prefiere el fragmento que menciona lo buscado.
 */
export function enlacesDeNormas(html: string, termino = ''): Resultado[] {
  const $ = cargar(html)
  const aguja = sinTildes(termino).toLowerCase().trim()
  const vistos = new Set<string>()

  return $('a[href*="norma.php?i="]')
    .map((_, el) => {
      const $a = $(el)
      const id = ($a.attr('href') ?? '').replace(/\D/g, '')

      const partes = $a
        .find('li')
        .map((__, li) => $(li).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean)
      const parrafos = partes.length
        ? partes
        : $a
            .find('p')
            .map((__, p) => $(p).text().replace(/\s+/g, ' ').trim())
            .get()
            .filter(Boolean)

      const pertinente = aguja ? parrafos.find((t) => sinTildes(t).toLowerCase().includes(aguja)) : undefined
      const resumen = pertinente ?? parrafos.join(' ')

      // Sin <h5> el título y el resumen quedan pegados ("Ley 87 de 1993Establece…").
      let titulo = $a.find('h5').text().replace(/\s+/g, ' ').trim()
      if (!titulo) {
        const todo = $a.text().replace(/\s+/g, ' ').trim()
        titulo = (resumen && todo.endsWith(resumen) ? todo.slice(0, -resumen.length) : todo).trim()
      }

      return { id, titulo, resumen, url: `${BASE_GESTOR}/norma.php?i=${id}` }
    })
    .get()
    .filter((r) => {
      if (!r.id || vistos.has(r.id)) return false // los listados repiten normas
      vistos.add(r.id)
      return true
    })
}

export function parseResultados(html: string, termino = ''): { total: number; items: Resultado[] } {
  const m = html.match(/encontrados:\s*(\d+)/i)
  if (!m) throw new CanarioError('no aparece "Número de documentos encontrados"')
  const total = Number(m[1])
  const items = enlacesDeNormas(html, termino)
  if (total > 0 && items.length === 0) throw new CanarioError('hay resultados pero ningún enlace de norma')
  return { total, items }
}

export type Norma = {
  id: string
  titulo: string
  fechas: Record<string, string>
  temas: { tema: string; subtema: string; restrictor: string }[]
  texto: string
  url: string
  urlPdf: string
}

export function parseNorma(html: string, id: string): Norma {
  const $ = cargar(html)
  const titulo = $('h2.titulo-norma').text().trim()
  if (!titulo) throw new CanarioError('no se encontró h2.titulo-norma')

  const fechas: Record<string, string> = {}
  $('#collapseOne p').each((_, el) => {
    const t = $(el).text().trim()
    const i = t.indexOf(':')
    if (i > 0) fechas[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  })

  const temas: Norma['temas'] = []
  let tema = ''
  let subtema = ''
  $('#collapseTwo').find('h5,h6,p').each((_, el) => {
    const $e = $(el)
    const t = $e.text().replace(/\s+/g, ' ').trim()
    if (!t) return
    if (el.tagName === 'h5') tema = t
    else if (el.tagName === 'h6') subtema = t.replace(/^-\s*Subtema:\s*/i, '')
    else temas.push({ tema, subtema, restrictor: t })
  })

  return {
    id,
    titulo,
    fechas,
    temas,
    // `.descripcion-contenido` deja fuera el aviso legal del portal, que va en
    // un `.alert` hermano; `col-lg-9` es el respaldo si el portal lo quita.
    texto: textoDe($, 'div.descripcion-contenido') || textoDe($, 'div.col-lg-9'),
    url: `${BASE_GESTOR}/norma.php?i=${id}`,
    urlPdf: `${BASE_GESTOR}/norma_pdf.php?i=${id}`,
  }
}

export function parseOpciones(html: string, idSelect: string): { id: string; nombre: string }[] {
  const $ = cheerio.load(html)
  const $sel = $(`#${idSelect}`)
  if (!$sel.length) throw new CanarioError(`no existe el select #${idSelect} en la consulta avanzada`)
  return $sel
    .find('option')
    .map((_, el) => ({ id: ($(el).attr('value') ?? '').trim(), nombre: $(el).text().trim() }))
    .get()
    .filter((o) => o.id && o.nombre)
}

export type FilaTema = { tema: string; subtema: string; temsubid: string; documentos: { normid: string; titulo: string }[] }

/**
 * La consulta temática enlaza cada norma con `info_restrictor('tema','subtema','titulo',temsubid,normid)`.
 * Los nombres de tema traen comillas y comas, así que solo se leen los dos números
 * del final — intentar separar los argumentos por coma rompe con temas como
 * `1) MUJERES 2) CONSEJERÍA...`.
 */
export function parseTematica(html: string): FilaTema[] {
  const $ = cargar(html)
  const filas: FilaTema[] = []

  $('h3').each((_, h3) => {
    const tema = $(h3).text().trim()
    $(h3)
      .nextAll()
      // `tr` a secas, no `tbody tr`: htmlparser2 no inserta el tbody implícito
      // que sí añade un parser conforme a la especificación, y el día que el
      // portal omita la etiqueta la tabla se leería vacía sin avisar.
      .find('tr')
      .each((__, tr) => {
        const $tds = $(tr).find('td')
        if ($tds.length < 2) return
        const subtema = $tds.eq(0).text().replace(/\s+/g, ' ').trim()
        const docs: { normid: string; titulo: string }[] = []
        let temsubid = ''
        $(tr)
          .find('a[onclick*="info_restrictor"]')
          .each((___, a) => {
            const oc = $(a).attr('onclick') ?? ''
            const ids = oc.match(/,\s*(\d+)\s*,\s*(\d+)\s*\)\s*$/)
            if (!ids) return
            temsubid = ids[1]!
            docs.push({ normid: ids[2]!, titulo: $(a).text().trim() })
          })
        if (docs.length) filas.push({ tema, subtema, temsubid, documentos: docs })
      })
  })

  return filas
}
