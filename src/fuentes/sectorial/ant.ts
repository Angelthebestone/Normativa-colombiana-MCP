/**
 * ANT — Agencia Nacional de Tierras.
 *
 * El portal es Drupal 10 (`/normativa`, vista `pxc-normas-taxonomicas`). Medido
 * en agosto de 2026:
 *
 * - El listado vive en `/normativa` con filtros por `tipo` (1 Concepto,
 *   2 Ley, 3 Constitución, 4 Decreto, 5 Resolución ANT, 6 Directiva, 7
 *   Circular, 8 Sentencia, 9 Otras, 10 Manuales) y `title` (texto libre).
 * - Cada resultado es `article.pxc-norma` con:
 *     h2 > span  "Resolución No. 202610300548606 con Fecha 2026-08-01"
 *     div        objeto ("Por la cual se realiza una delegación…")
 *     p.publicacion-info  "Fecha de expedición\n 3 Agosto, 2026"
 *     a[href$=".pdf"]     Descargar
 * - La paginación es `?page=N` (0-based, 33 páginas sin filtros).
 * - El PDF es `/sites/default/files/<año-mes>/normas/archivos/*.pdf`, siempre
 *   en el MISMO dominio (https://www.ant.gov.co).
 * - Un filtro sin resultados devuelve la página con el contenedor vacío
 *   (sin filas `views-row`): es un vacío legítimo, no un cambio de HTML.
 *
 * Regla de la casa: si la estructura cambia (desaparecen `.pxc-norma` o los
 * enlaces `.pdf`), se lanza `CanarioError` y no una lista vacía: un vacío se
 * leería como "esa norma no existe".
 */
import { CanarioError, cargar, colapsarEspacios, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.ant.gov.co'
const RUTA = '/normativa'

/** De "Resolución No. 202610300548606 con Fecha 2026-08-01" saca tipo/número/fecha. */
function parsearTitulo(titulo: string): { tipo: string; numero: string; fecha: string } {
  const tipo = titulo.match(/^\s*([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ]*(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ]*)*?)\s*(?:No\.?|N°\.?)?\s*\d/)?.[1]?.trim() ?? 'Resolución'
  const numero = titulo.match(/(?:No\.?|N°\.?)?\s*([\d]{6,})\b/)?.[1] ?? ''
  const fecha = titulo.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/)?.[0] ?? ''
  return { tipo, numero, fecha }
}

function leerArticulo($: ReturnType<typeof cargar>, nodo: ReturnType<ReturnType<typeof cargar>>): ActoSectorial | null {
  const $n = nodo
  const titulo = colapsarEspacios($n.find('h2 span').first().text())
  if (!titulo) return null
  const { tipo, numero, fecha } = parsearTitulo(titulo)
  // El objeto ("Por la cual…") es el div que sigue al h2; se descartan el
  // título repetido y los bloques de archivo ("Descargar (389.66 KB)").
  const divObjeto = $n
    .find('div')
    .map((_, d) => colapsarEspacios($(d).text()))
    .get()
    .find(
      (t) =>
        t &&
        !t.includes(titulo.slice(0, 20)) &&
        !/descargar|file-size|\.pdf|\.doc/i.test(t) &&
        t.length > 20,
    )
  // Cuando el portal no publica el objeto (p. ej. con filtro por texto, el
  // asunto vive en el título "20191030017933 - Micro y minifundio…"), se
  // recupera la parte tras el número como epígrafe.
  const epigrafe = colapsarEspacios(divObjeto ?? (titulo.match(/^[^ ]+ ?- ?(.+)$/)?.[1] ?? ''))
  const fechaExpedicion = colapsarEspacios($n.find('p.publicacion-info').text()).replace(/^Fecha de expedición\s*/i, '')
  const a = $n.find('a[href$=".pdf"], a[href*=".pdf?"]').first()
  const href = a.attr('href') ?? ''
  if (!href) return null
  const anio = fecha.slice(0, 4) || (fechaExpedicion.match(/\b(19|20)\d{2}\b/)?.[0] ?? '')
  return {
    tipo,
    numero,
    anio,
    fecha: fecha || fechaExpedicion,
    epigrafe,
    url: href.startsWith('http') ? href : new URL(href, BASE).toString(),
  }
}

export async function buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
  const params = new URLSearchParams()
  if (opts.texto?.trim()) params.set('title', opts.texto.trim())
  // El paginador de Drupal empieza en 0; la página 1 (default) no lleva query.
  const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
  if (pagina > 1) params.set('page', String(pagina - 1))

  const qs = params.toString()
  const url = `${BASE}${RUTA}${qs ? `?${qs}` : ''}`
  const r = await pedir(url, 60_000)
  if (r.status !== 200) throw new Error(`El portal de la ANT respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  const articulos = $('article.pxc-norma')
  // Un filtro sin resultados es un vacío legítimo (el contenedor queda sin filas).
  if (!articulos.length) {
    const hayFiltro = Boolean(opts.texto?.trim())
    if (hayFiltro) return { items: [], total: 0, url }
    throw new CanarioError('no se encontró el listado de normativa (article.pxc-norma)')
  }

  const items = articulos
    .map((_, a) => leerArticulo($, $(a)))
    .get()
    .filter((x): x is ActoSectorial => x !== null)
  if (!items.length) throw new CanarioError('el listado de la ANT no trajo ninguna fila con enlace')

  // Si el filtro por texto no lo aplicó el portal, se aplica aquí.
  let resultantes = items
  if (opts.texto?.trim() && !params.has('title')) {
    const aguja = sinTildes(opts.texto.trim()).toLowerCase()
    resultantes = resultantes.filter((x) =>
      sinTildes(`${x.tipo} ${x.numero} ${x.anio} ${x.fecha} ${x.epigrafe}`.toLowerCase()).includes(aguja),
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
  id: 'ant',
  nombre: 'Agencia Nacional de Tierras',
  sector: 'tierras, reforma agraria y ordenamiento territorial',
  portal: 'https://www.ant.gov.co/normativa',
  dominioPermitido: 'https://www.ant.gov.co',
  tiposDocumento: ['Resolución', 'Decreto', 'Ley', 'Circular', 'Concepto', 'Sentencia', 'Directiva', 'Manual'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Cubre la normativa que la ANT publica en su sección de normativa (resoluciones ANT, decretos, leyes, ' +
    'circulares, conceptos, sentencias, directivas y manuales relacionados con tierras). Los enlaces son PDF: ' +
    'este adaptador no lee el texto del documento. La búsqueda por texto filtra sobre el título del acto en el ' +
    'portal, no sobre su contenido. No publica vigencia.',
  buscar,
} satisfies import('../sectorial.ts').Adaptador
