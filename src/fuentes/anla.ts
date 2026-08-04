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
 * Técnicamente es Joomla con DOS plantillas distintas, y eso importa: «leyes» es
 * un blog (`div.article`, 10 por página) y las seis secciones temáticas son
 * páginas de etiqueta (`ul.com-tags-tag__category`, 20 por página). Leer solo la
 * primera dejaba rotas justo las seis que dan la curaduría, que es lo único que
 * esta fuente aporta. El salto de página se lee de los enlaces `?start=N` del
 * propio HTML en vez de cablearlo, porque depende de la plantilla.
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
  /**
   * La cita del mismo tipo y año que aparece en el RESUMEN cuando desmiente al
   * título. Eureka titula «Ley 2585 de 2026» un artículo cuyo texto dice «la Ley
   * 2577 de 2026»: 2585 no existe, y ofrecerla como cita resoluble era mandar a
   * citar mal una ley. No se corrige el número —cuál de los dos es el bueno lo
   * dice la fuente, no esta extensión—: se entregan los dos y se avisa.
   */
  desmentida: string
  resumen: string
  url: string
}

/** Citas normativas dentro de un texto corrido, para contrastar el título con su resumen. */
const CITAS = /\b(Ley|Decreto(?:\s*[–—-]?\s*Ley)?|Resoluci[óo]n|Acuerdo|Circular)\s+(\d[\d.]*)\s+de\s+(\d{4})\b/gi
const UNA_CITA = new RegExp(CITAS.source, 'i')
/** «Decreto – Ley» y «Decreto Ley» son la misma clase de norma escritas distinto. */
const clase = (s: string): string => sinTildes(s).toLowerCase().replace(/[^a-z]/g, '')

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Eureka pagina por su cuenta y no admite otro tamaño, así que no hay `limite`. */
export async function listar(
  seccion: SeccionAnla,
  desde = 0,
): Promise<{ items: EntradaAnla[]; desde: number; siguiente: number | null; url: string }> {
  const inicio = Math.max(0, Math.trunc(desde))
  const url = `${BASE}${SECCIONES[seccion]}${inicio ? `?start=${inicio}` : ''}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`Eureka (ANLA) respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  // Ninguna de las dos plantillas usa <article>. En el blog cada entrada es un
  // `div.article` con `.article-header` y `.article-introtext`; en las páginas de
  // etiqueta es un `li` de `ul.com-tags-tag__category` con el título en un `h3` y
  // sin resumen. Se aceptan las dos: mirar solo la del blog daba por «plantilla
  // cambiada» seis secciones que respondían 200 con sus documentos dentro.
  const articulos = $('div.article, [itemprop=blogPost], ul.com-tags-tag__category > li')
  if (!articulos.length) {
    // La caída es por sección: en la misma sesión "leyes" respondió y
    // "licencia-ambiental" no. Un aviso genérico hacía concluir de más en las dos
    // direcciones —ANLA entera caída, o ANLA sana— según cuál se hubiera probado.
    throw new CanarioError(
      `la sección "${seccion}" de Eureka no devolvió entradas con ninguna de sus dos plantillas (blog y etiqueta): ` +
        `su HTML cambió. Es esta sección, no todo el portal: otras secciones pueden seguir respondiendo, pruébalas ` +
        `antes de dar ANLA por caída`,
    )
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
    const resumen = (limpio($e.find('.article-introtext').text()) || limpio($e.text()).slice(titulo.length))
      .slice(0, 400)
      .trim()

    // Misma clase de norma y mismo año, número distinto: el resumen desmiente al
    // título. Se exige que coincida el año para no confundir una norma citada de
    // pasada («modificada por la Ley 99 de 1993») con el número equivocado.
    const suya = cita.match(UNA_CITA)
    let desmentida = ''
    if (suya) {
      for (const m of resumen.matchAll(CITAS)) {
        if (m[3] === suya[3] && m[2] !== suya[2] && clase(m[1]!) === clase(suya[1]!)) {
          desmentida = `${m[1]} ${m[2]} de ${m[3]}`.replace(/\s+/g, ' ')
          break
        }
      }
    }

    items.push({
      titulo,
      cita,
      desmentida,
      resumen,
      url: href ? new URL(href, BASE).toString() : url,
    })
  })

  // El paginador de Joomla enlaza las páginas por `?start=N`, y el salto es el de
  // la plantilla: 10 en el blog, 20 en las etiquetas. Se toma el menor N mayor
  // que el actual en vez de contar entradas, que daba «hay más» en la última
  // página de una etiqueta con 10 o más documentos.
  const siguiente =
    $('a[href*="start="]')
      .map((_, a) => Number(new URL($(a).attr('href') ?? '', BASE).searchParams.get('start')))
      .get()
      .filter((n) => Number.isFinite(n) && n > inicio)
      .sort((a, b) => a - b)[0] ?? null

  return { items, desde: inicio, siguiente, url }
}

/** Busca por texto dentro de una sección ya descargada; Eureka no tiene buscador propio. */
export const filtrar = (items: EntradaAnla[], texto: string): EntradaAnla[] => {
  const q = sinTildes(texto).toLowerCase().trim()
  return q ? items.filter((i) => sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase().includes(q)) : items
}
