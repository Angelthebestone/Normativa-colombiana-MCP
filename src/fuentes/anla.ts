/**
 * ANLA — Autoridad Nacional de Licencias Ambientales, sistema «Eureka».
 *
 * Es la fuente con menos documentos propios y, aun así, la que puede ahorrar más
 * trabajo, porque lo que aporta no son normas nuevas sino una CURADURÍA: Eureka
 * agrupa la normativa nacional que aplica al licenciamiento ambiental por temas
 * —licencia ambiental, biodiversidad, cambio climático, consulta previa— y eso
 * no está en ninguna otra fuente de este MCP.
 *
 * Hay que ser honesto sobre qué es: casi todo lo que lista son leyes y decretos
 * nacionales («Ley 2893 de 2011», «Ley 1659 de 2013») que `resolver_cita` ya
 * resuelve mejor, con texto completo y vigencia. La propia ANLA remite a
 * SUIN-Juriscol para la base normativa. Por eso esta herramienta devuelve la
 * clasificación temática y remite a `resolver_cita` para el contenido, en vez de
 * duplicar lo que ya existe peor.
 *
 * Técnicamente es Joomla: listados de 10 con paginación `?start=N`.
 */
import { CanarioError, cargar, sinTildes } from '../parse.ts'
import { pedir } from '../http.ts'

const BASE = 'https://www.anla.gov.co/wanla/eureka/'

/** Secciones de Eureka comprobadas; son rutas del propio menú. */
export const SECCIONES = {
  leyes: 'normativa/leyes',
  'licencia-ambiental': 'articulos-relacionados-licencia-ambiental',
  biodiversidad: 'articulos-relacionados-biodiversidad',
  'cambio-climatico': 'articulos-relacionados-cambio-climatico',
  'consulta-previa': 'articulos-relacionados-consulta-previa',
  'impacto-ambiental': 'articulos-relacionados-impacto-ambiental',
  'participacion-ciudadana': 'articulos-relacionados-participacion-ciudadana',
} as const
export type SeccionAnla = keyof typeof SECCIONES

export type EntradaAnla = {
  titulo: string
  /** Cita normativa detectada en el título, para encadenar con resolver_cita. */
  cita: string
  resumen: string
  url: string
}

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Eureka pagina de 10 en 10 y no admite otro tamaño, así que no hay `limite`. */
export async function listar(
  seccion: SeccionAnla,
  desde = 0,
): Promise<{ items: EntradaAnla[]; desde: number; hayMas: boolean; url: string }> {
  const inicio = Math.max(0, Math.trunc(desde))
  const url = `${BASE}${SECCIONES[seccion]}${inicio ? `?start=${inicio}` : ''}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`Eureka (ANLA) respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  // La plantilla de Joomla NO usa <article>: cada entrada es un `div.article`
  // con `.article-header` y `.article-introtext`. Costó una pasada averiguarlo.
  const articulos = $('div.article, [itemprop=blogPost]')
  if (!articulos.length) {
    throw new CanarioError('la sección de Eureka no devolvió entradas: su plantilla de Joomla cambió')
  }

  const items: EntradaAnla[] = []
  articulos.each((_, el) => {
    const $e = $(el)
    const titulo = limpio($e.find('.article-header, h1, h2, h3').first().text()) || limpio($e.find('a').first().text())
    if (!titulo) return
    const href = $e.find('a[href]').first().attr('href') ?? ''
    // "Ley 2893 de 2011 – Objetivos…" → "Ley 2893 de 2011".
    // Eureka escribe los decretos leyes como "Decreto – Ley 2893 de 2011", con
    // guion largo: sin contemplarlo se extraía "Ley 2893 de 2011", que es una
    // norma DISTINTA, y la cita habría viajado mal a resolver_cita.
    const cita = (
      titulo.match(/\bDecreto\s*[–—-]\s*Ley\s+\d[\d.]*\s+de\s+\d{4}/i)?.[0].replace(/\s*[–—-]\s*/, ' ') ??
      titulo.match(/\b(?:Ley|Decreto(?:\s+Ley)?|Resoluci[óo]n|Acuerdo|Circular)\s+\d[\d.]*\s+de\s+\d{4}/i)?.[0] ??
      ''
    ).replace(/\s+/g, ' ')
    items.push({
      titulo,
      cita,
      resumen: (limpio($e.find('.article-introtext').text()) || limpio($e.text()).slice(titulo.length)).slice(0, 400).trim(),
      url: href ? new URL(href, BASE).toString() : url,
    })
  })

  // Joomla pagina de 10 en 10; que venga una página llena sugiere que hay más.
  return { items, desde: inicio, hayMas: items.length >= 10, url }
}

/** Busca por texto dentro de una sección ya descargada; Eureka no tiene buscador propio. */
export const filtrar = (items: EntradaAnla[], texto: string): EntradaAnla[] => {
  const q = sinTildes(texto).toLowerCase().trim()
  return q ? items.filter((i) => sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase().includes(q)) : items
}
