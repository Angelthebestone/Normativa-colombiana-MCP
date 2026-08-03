/**
 * Parques Nacionales Naturales de Colombia.
 *
 * La pista que traía este adaptador ("en otro portal la normativa vivía en un
 * tipo `circular_resolucion`", por UPME) NO se cumple aquí: `/wp-json/wp/v2/`
 * solo expone `posts`, `pages`, `media` y los tipos de siempre — sin
 * `circular_resolucion` ni ningún tipo propio. Comprobado pidiendo la raíz de
 * la API. La normativa vive, en cambio, en UNA sola página estática
 * (`/normativas/`, ~2 MB de HTML) construida a mano con WPBakery: un
 * acordeón con un panel por tipo de acto (Leyes, Decretos, Circulares,
 * Resoluciones…), cada uno con su propia tabla o lista de enlaces. No hay
 * backend de búsqueda ni paginación: todo lo que existe está en esa única
 * petición, así que `texto`/`anio`/`pagina` se aplican aquí, del lado del
 * cliente, sobre lo ya descargado.
 *
 * Se cubren tres paneles —Leyes, Decretos, Circulares— y se deja fuera
 * "Resoluciones" a propósito, con evidencia:
 *
 * - Ese panel no son resoluciones de alcance general: son decisiones caso a
 *   caso de registro de Reservas Naturales de la Sociedad Civil (RNSC),
 *   repetidas por cada una de las 6 direcciones territoriales y por año, del
 *   orden de varios cientos de filas.
 * - El título mostrado y el archivo enlazado pueden no corresponder. Ejemplo
 *   verificado: la fila rotulada "Resolución No. 056 del 28 de abril de 2022"
 *   enlaza `auto-no-114-del-22_03_2022-rnsc-157-21-la-gerar.pdf` — un AUTO,
 *   no una resolución, y de otra fecha. Devolver eso como si el título fuera
 *   de fiar sería peor que no cubrirlo.
 *
 * Otra trampa, la misma familia que la de UPME: cada tarjeta de documento
 * trae DOS enlaces al mismo archivo — un icono (`a.url-archivo`, con href
 * RELATIVO e incompleto: `2025/01/archivo.pdf`, sin el `/wp-content/uploads/`
 * que hace falta) y el texto (`a.documento-normativa`, con el href absoluto
 * correcto). Tomar el primer `<a>` de la tarjeta sin distinguir da una URL
 * rota; hay que preferir siempre `a.documento-normativa`.
 */
import { CanarioError, cargar, sinTildes } from '../../parse.ts'
import { pedir } from '../../http.ts'
import type * as cheerio from 'cheerio/slim'
import type { Adaptador, ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.parquesnacionales.gov.co'
const URL_NORMATIVAS = `${BASE}/normativas/`

/** Los tres paneles cubiertos, con el id real del `<div id="…">` del acordeón. */
const PANELES: { id: string; tipo: string }[] = [
  { id: 'leyes', tipo: 'Ley' },
  { id: 'decretos', tipo: 'Decreto' },
  { id: 'circulares', tipo: 'Circular' },
]

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

const RE_FECHA_PUBLICADO = /Publicado:\s*(\d{4}-\d{2}-\d{2})/
const RE_FECHA_CORTA = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/
const RE_FECHA_LARGA = /\b\d{1,2}\s+de\s+[A-Za-zÀ-ÿ]+\s+de\s+\d{4}\b/

function fechaDe(texto: string): string {
  return RE_FECHA_PUBLICADO.exec(texto)?.[1] ?? RE_FECHA_CORTA.exec(texto)?.[0] ?? RE_FECHA_LARGA.exec(texto)?.[0] ?? ''
}

/**
 * Cada panel usa una de dos estructuras: una tabla de siempre (Leyes,
 * Circulares) o tarjetas del widget de "documentos" del tema gov.co
 * (Decretos). Se buscan ambas y se usa la que aparezca.
 */
function contenedores($: cheerio.CheerioAPI, $panel: cheerio.Cheerio<any>) {
  const filas = $panel.find('table tr').filter((_, tr) => $(tr).find('a[href]:not([href^="#"])').length > 0)
  if (filas.length) return filas
  return $panel.find('.box-docgd').filter((_, div) => $(div).find('a.documento-normativa[href]').length > 0)
}

function extraer($unidad: cheerio.Cheerio<any>, tipo: string): ActoSectorial | null {
  // `a.documento-normativa` primero: el icono `a.url-archivo` que lo precede
  // en el DOM trae un href relativo incompleto (ver comentario de cabecera).
  const $a = $unidad.find('a.documento-normativa[href]').first().length
    ? $unidad.find('a.documento-normativa[href]').first()
    : $unidad.find('a[href]:not([href^="#"])').first()
  if (!$a.length) return null

  const titulo = limpio($a.text()) || limpio($a.attr('title') ?? '')
  if (!titulo) return null
  const href = $a.attr('href') ?? ''
  const textoCompleto = limpio($unidad.text())

  const numero = titulo.match(/(\d[\d.\-/]*)/)?.[1] ?? ''
  const anios = titulo.match(/\b(?:19|20)\d{2}\b/g) ?? textoCompleto.match(/\b(?:19|20)\d{2}\b/g)
  const anio = anios?.at(-1) ?? ''

  // El resto del texto de la fila/tarjeta, quitando el título, es lo más
  // parecido a un epígrafe que ofrece esta página (no hay un campo aparte).
  const resto = limpio(textoCompleto.replace(titulo, ''))

  return {
    tipo,
    numero,
    anio,
    fecha: fechaDe(textoCompleto),
    epigrafe: resto || titulo,
    url: href ? new URL(href, BASE).toString() : URL_NORMATIVAS,
  }
}

export default {
  id: 'parques',
  nombre: 'Parques Nacionales Naturales de Colombia',
  sector: 'ambiente y áreas protegidas',
  portal: BASE,
  advertencia:
    'Cubre solo Leyes, Decretos y Circulares de la página /normativas/. NO cubre el panel de ' +
    '"Resoluciones" de esa misma página: son decisiones individuales de registro de Reservas ' +
    'Naturales de la Sociedad Civil, no regulación general, y se verificó al menos un caso donde el ' +
    'título mostrado no corresponde al archivo enlazado. Tampoco cubre el Normograma en PDF, los ' +
    'Conceptos de la Oficina Jurídica ni las sentencias que enlaza la página. Tampoco hay texto de ' +
    'los actos: son enlaces a PDF. `tipo` es el panel en el que la propia entidad puso el documento, ' +
    'no algo deducido del título: hay al menos un caso comprobado (un archivo llamado ' +
    '"RESOLUCION-HONORARIOS-FIN.pdf") archivado bajo "Decretos". La página es estática y mantenida ' +
    'a mano: no hay buscador ni paginación en el portal — texto, año y página se aplican aquí sobre ' +
    'todo lo que la página trae, y una norma reciente puede no estar si aún no la han añadido.',
  async buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
    const r = await pedir(URL_NORMATIVAS, 60_000)
    if (r.status !== 200) throw new Error(`El portal de Parques Nacionales respondió ${r.status}.`)

    const $ = cargar(r.cuerpo)
    let items: ActoSectorial[] = []
    for (const { id, tipo } of PANELES) {
      const $panel = $(`#${id}`)
      if (!$panel.length) throw new CanarioError(`/normativas/ ya no trae el panel "${id}"`)
      const unidades = contenedores($, $panel)
      if (!unidades.length) throw new CanarioError(`el panel "${id}" de /normativas/ no trae ninguna fila reconocible`)
      unidades.each((_, el) => {
        const acto = extraer($(el), tipo)
        if (acto) items.push(acto)
      })
    }

    const notas: string[] = [
      'Página estática sin buscador propio: el filtro se aplicó aquí sobre todo lo publicado, no hay más páginas que pedir al portal.',
    ]

    if (opts.texto?.trim()) {
      const aguja = sinTildes(opts.texto).toLowerCase().trim()
      items = items.filter((it) => sinTildes(`${it.epigrafe} ${it.tipo} ${it.numero}`).toLowerCase().includes(aguja))
    }
    if (opts.anio?.trim()) {
      const anio = opts.anio.trim()
      items = items.filter((it) => it.anio === anio)
    }

    const total = items.length
    const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
    const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
    const inicio = (pagina - 1) * limite

    return {
      items: items.slice(inicio, inicio + limite),
      total,
      url: URL_NORMATIVAS,
      nota: notas.join(' '),
    }
  },
} satisfies Adaptador
