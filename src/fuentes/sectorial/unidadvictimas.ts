/**
 * Unidad para las Víctimas — Unidad Administrativa Especial para la Atención
 * y Reparación Integral a las Víctimas (UARIV).
 *
 * El portal es WordPress + Elementor. Medido en agosto de 2026:
 *
 * - El listado vive en `/documentos_bibliotec/` (custom post type
 *   `documentos_bibliotec`) como un widget de PESTAÑAS (nested tabs): el HTML
 *   trae las trece pestañas y sus paneles, cada uno con su propio loop-grid.
 *   Las trece están en la respuesta; solo la primera lleva `e-active` (las
 *   demás las oculta CSS, no el servidor). Por eso UNA petición alcanza para
 *   todas las categorías, sin recorrer enlaces por pestaña.
 * - Cada item del loop es un `<a href="/documentos_bibliotec/<slug>/">` con:
 *     p.elementor-heading-title   categoría ("Informes", "Resoluciones"…)
 *     h2.elementor-heading-title  título del documento
 *     time                        fecha de publicación ("julio 7, 2026")
 *   El icono SVG indica el tipo de archivo (PDF la mayoría).
 * - La taxonomía `categoria_biblioteca` va en la clase del item
 *   (`categoria_biblioteca-informes`): es la señal de categoría fiable; el
 *   texto del `p` puede venir vacío o compuesto ("Informes, Resoluciones").
 * - La paginación de cada panel es `?e-page-<id-widget>=N` (Elementor). El
 *   sufijo WordPress `/page/N/` también funciona y pagina TODOS los paneles a
 *   la vez; el panel con ≤ 30 documentos queda vacío en `/page/2/`. Aquí se
 *   usa `/page/N/`, que es la forma estable y ya documentada del adaptador.
 * - No hay endpoint por categoría: `?categoria_biblioteca=` responde 500 y
 *   `/categoria_biblioteca/<slug>/` no trae el listado. El filtro por
 *   `categoria` se aplica sobre los items de la página.
 *
 * Regla de la casa: si la estructura cambia (desaparecen los `e-loop-item`,
 * la taxonomía o los enlaces al item), se lanza `CanarioError` y no una lista
 * vacía.
 */
import { CanarioError, cargar, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.unidadvictimas.gov.co'
const RUTA = '/documentos_bibliotec/'

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** El slug de la taxonomía en la clase del item ("categoria_biblioteca-informes"). */
const slugDe = (nodo: ReturnType<ReturnType<typeof cargar>>): string => {
  const clases = nodo.attr('class') ?? ''
  return clases.match(/categoria_biblioteca-([\w-]+)/)?.[1] ?? ''
}

function leerItem(nodo: ReturnType<ReturnType<typeof cargar>>): ActoSectorial | null {
  const $n = nodo
  const a = $n.find('a[href*="/documentos_bibliotec/"]').first()
  const href = a.attr('href') ?? ''
  if (!href) return null
  const titulo = limpio($n.find('h2.elementor-heading-title').first().text()) || limpio($n.find('h1').first().text())
  if (!titulo) return null
  // El texto del `p` puede venir vacío o compuesto ("Informes, Resoluciones");
  // la clase de la taxonomía es la señal fiable y es también el `tipo`.
  const categoria = limpio($n.find('p.elementor-heading-title').first().text())
  const fecha = limpio($n.find('time').first().text())
  const numero = titulo.match(/(?:resoluci[oó]n|decreto|ley|circular)\s*(?:n[°o]?\.?|no\.?)?\s*([\d]{2,8})/i)?.[1] ?? ''
  const anio = fecha.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''
  return {
    tipo: categoria || 'Documento',
    numero,
    anio,
    fecha,
    epigrafe: titulo,
    url: href.startsWith('http') ? href : new URL(href, BASE).toString(),
  }
}

export async function buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
  // WordPress pagina desde /page/2/; la página 1 (default) no lleva sufijo.
  const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
  const url = `${BASE}${RUTA}${pagina > 1 ? `page/${pagina}/` : ''}`
  const r = await pedir(url, 60_000)
  if (r.status !== 200) throw new Error(`El portal de la Unidad de Víctimas respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  const itemsNodo = $('.e-loop-item')
  if (!itemsNodo.length) {
    throw new CanarioError('no se encontró el listado de documentos (e-loop-item)')
  }
  const items = itemsNodo
    .map((_, it) => {
      const $it = $(it)
      const acto = leerItem($it)
      if (!acto) return null
      return { acto, slug: slugDe($it) }
    })
    .get()
    .filter((x): x is { acto: ActoSectorial; slug: string } => x !== null)
  if (!items.length) throw new CanarioError('el listado no trajo ninguna fila con enlace')

  // Las categorías del portal: las que traen los items de esta página.
  const categorias = [...new Set(items.map((x) => x.slug).filter(Boolean))].sort()
  if (!categorias.length) throw new CanarioError('no se encontró la taxonomía categoria_biblioteca en los items')

  let resultantes = items
  const categoria = opts.categoria?.trim()
  if (categoria) {
    const aguja = sinTildes(categoria).toLowerCase()
    resultantes = resultantes.filter((x) => {
      // La clase de la taxonomía es la señal canónica; el texto del `p` (tipo)
      // es el respaldo cuando el slug no coincide ("Infografías" → slug con sufijo).
      const enClase = Boolean(x.slug) && (x.slug.includes(aguja) || aguja.includes(x.slug))
      const enTipo = sinTildes(x.acto.tipo).toLowerCase().includes(aguja)
      return enClase || enTipo
    })
  }
  if (opts.texto?.trim()) {
    const aguja = sinTildes(opts.texto.trim()).toLowerCase()
    resultantes = resultantes.filter((x) =>
      sinTildes(`${x.acto.tipo} ${x.acto.anio} ${x.acto.fecha} ${x.acto.epigrafe}`.toLowerCase()).includes(aguja),
    )
  }
  const tope = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  const itemsFinales = resultantes.map((x) => x.acto)
  const notas: string[] = []
  if (categoria) {
    notas.push(
      `Categoría consultada: «${categoria}». El portal no tiene endpoint por categoría; el filtro se aplicó ` +
        `sobre los items de la página. Categorías disponibles en esta página: ${categorias.map((c) => `"${c}"`).join(', ')}.`,
    )
  }
  if (resultantes.length > tope) {
    notas.push(`Coinciden ${resultantes.length}; se muestran ${tope}. Usa pagina para ver más.`)
  }
  return {
    items: itemsFinales.slice(0, tope),
    total: resultantes.length,
    url,
    ...(notas.length ? { nota: notas.join(' ') } : {}),
  }
}

export default {
  id: 'unidadvictimas',
  nombre: 'Unidad para las Víctimas',
  sector: 'víctimas, reparación integral y atención humanitaria',
  portal: 'https://www.unidadvictimas.gov.co/documentos_bibliotec/',
  dominioPermitido: 'https://www.unidadvictimas.gov.co',
  tiposDocumento: ['Informes', 'Planeación', 'Presupuesto', 'Documento'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Cubre la biblioteca de documentos de la Unidad para las Víctimas (informes, planeación, presupuesto y ' +
    'otros documentos institucionales). No es normativa en sentido estricto: son documentos de gestión, no ' +
    'actos con fuerza normativa, y no se publica vigencia. El enlace de cada resultado lleva a la página del ' +
    'documento, donde está el archivo (PDF la mayoría); este adaptador no lee el texto del archivo. La ' +
    'búsqueda por texto filtra sobre el título y la categoría del documento.',
  buscar,
} satisfies import('../sectorial.ts').Adaptador
