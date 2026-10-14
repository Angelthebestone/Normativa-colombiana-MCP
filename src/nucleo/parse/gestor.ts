import * as cheerio from 'cheerio/slim'
import { CanarioError } from './errores.ts'
import { cargar, textoDe } from './limpieza.ts'
import { sinTildes } from './texto.ts'

export const BASE_GESTOR = 'https://www.funcionpublica.gov.co/eva/gestornormativo'

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
