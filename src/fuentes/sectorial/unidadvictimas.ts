/**
 * Unidad para las Víctimas — Unidad Administrativa Especial para la Atención
 * y Reparación Integral a las Víctimas (UARIV).
 *
 * El portal es WordPress + Elementor. Medido en agosto de 2026:
 *
 * - El listado vive en `/documentos_bibliotec/` (custom post type
 *   `documentos_bibliotec`), con paginación WordPress estándar
 *   `/documentos_bibliotec/page/N/` (N desde 2; `rel="next"` en el HTML).
 * - Cada item del loop es un `<a href="/documentos_bibliotec/<slug>/">` con:
 *     p.elementor-heading-title   categoría ("Informes", "Planeación"…)
 *     h2.elementor-heading-title  título del documento
 *     time                        fecha de publicación ("julio 7, 2026")
 *   El icono SVG indica el tipo de archivo (PDF la mayoría).
 * - El documento real está en la página interna del item: el `h1 > a` y el
 *   botón "Descargar documento" apuntan al archivo
 *   `/wp-content/uploads/<año>/<mes>/<archivo>.pdf` en el MISMO dominio.
 * - Hay categorías (taxonomía `categoria_biblioteca`, en la clase del item
 *   como `categoria_biblioteca-informes`), pero el listado no ofrece un
 *   filtro por categoría en la URL: el archivo las agrupa todas.
 *
 * Regla de la casa: si la estructura cambia (desaparecen los `e-loop-item`
 * o los enlaces al item), se lanza `CanarioError` y no una lista vacía.
 */
import { CanarioError, cargar, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.unidadvictimas.gov.co'
const RUTA = '/documentos_bibliotec/'

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

function leerItem(nodo: ReturnType<ReturnType<typeof cargar>>): ActoSectorial | null {
  const $n = nodo
  const a = $n.find('a[href*="/documentos_bibliotec/"]').first()
  const href = a.attr('href') ?? ''
  if (!href) return null
  const titulo = limpio($n.find('h2.elementor-heading-title').first().text()) || limpio($n.find('h1').first().text())
  if (!titulo) return null
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
    .map((_, it) => leerItem($(it)))
    .get()
    .filter((x): x is ActoSectorial => x !== null)
  if (!items.length) throw new CanarioError('el listado no trajo ninguna fila con enlace')

  let resultantes = items
  if (opts.texto?.trim()) {
    const aguja = sinTildes(opts.texto.trim()).toLowerCase()
    resultantes = resultantes.filter((x) =>
      sinTildes(`${x.tipo} ${x.anio} ${x.fecha} ${x.epigrafe}`.toLowerCase()).includes(aguja),
    )
  }
  const tope = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  return {
    items: resultantes.slice(0, tope),
    total: resultantes.length,
    url,
    ...(resultantes.length > tope
      ? { nota: `Coinciden ${resultantes.length}; se muestran ${tope}. Usa pagina para ver más.` }
      : {}),
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
