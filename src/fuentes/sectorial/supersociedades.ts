/**
 * Superintendencia de Sociedades.
 *
 * El portal es Liferay y su "Normativa General" no es un listado: es un
 * buscador por CATEGORÍA (`?id=<id numérico>`), con `keyword` para texto y
 * `start`/`end` para paginar de 20 en 20 (confirmado: pedir un rango más
 * ancho, p.ej. `end=50`, el servidor lo ignora y devuelve 20 igual).
 *
 * La categoría importa más de lo que parece: sin `id` en la URL, el portal
 * NO devuelve "todo sin filtrar" — devuelve la categoría "Actas de
 * Conciliación" (id 1256470), que es el valor por defecto de `catBuscada` en
 * su JS. Esas actas son documentos de personas naturales (conciliaciones de
 * insolvencia), no normativa, y sin este descubrimiento cualquier búsqueda
 * sin filtro habría devuelto ruido con apariencia de resultado válido.
 *
 * De las categorías que sí expone (`id`), esta fuente solo consulta
 * **Resoluciones** (id 1256464, la más numerosa: ~480 actos). Se excluyen a
 * propósito:
 * - Leyes, Decretos y Constitución Política: normativa nacional, ya cubierta
 *   por el Gestor Normativo de Función Pública. Repetirla aquí no añade nada.
 * - Circulares Externas, Circular Básica Jurídica, Decreto Único
 *   Reglamentario Sectorial, Otra Normativa: quedan fuera por alcance, no
 *   porque falten datos. Quien las necesite debe ir al portal.
 * - Actas de Conciliación, Escala Salarial, Estructura: no son normativa.
 *
 * Cada fila SÍ trae algo que ninguna otra fuente sectorial da: un estado de
 * vigencia declarado ("Vigente"), que se antepone al epígrafe tal cual lo
 * publica el portal, sin convertirlo en un booleano.
 */
import { CanarioError, cargar } from '../../parse.ts'
import { pedir } from '../../http.ts'
import type { Adaptador, ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.supersociedades.gov.co/web/nuestra-entidad/normativa'
/** Resoluciones, según el `id` que usa el propio buscador del portal. */
const CATEGORIA_RESOLUCIONES = '1256464'
const TAMANO_PAGINA = 20

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * "Resolución 100-026149 de 24 de julio de 2026" → tipo + número. La fecha de
 * este título no se usa (es la misma que la de expedición, que viene aparte y
 * más fácil de parsear): se guarda solo para separar tipo de número.
 */
const TITULO = /^(.+?)\s+([\w.-]*\d[\w.-]*)\s+del?\s+.+$/i

function extraerActo(html: string): { items: ActoSectorial[]; totalDeclarado: number | undefined } {
  const $ = cargar(html)

  // El formulario de búsqueda tiene que seguir ahí aunque no haya resultados
  // para esta categoría/palabra: si desaparece, la página cambió de raíz.
  if (!/id="searchKeyword"/.test(html)) {
    throw new CanarioError('la página de normativa de la Supersociedades ya no trae su buscador interno')
  }

  const totalTxt = $(`#cont_${CATEGORIA_RESOLUCIONES}`).attr('val')
  const totalDeclarado = totalTxt ? Number(totalTxt) : undefined

  const items: ActoSectorial[] = []
  $('span.titulo-articulo').each((_, el) => {
    const $titulo = $(el)
    // Los datos de la fila viven en la tabla interna `table.wd-100`, no en la
    // tabla exterior (esa solo trae el ícono de PDF y el peso del archivo).
    const $card = $titulo.closest('table.wd-100')
    if (!$card.length) return

    const tituloTxt = limpio($titulo.attr('title') ?? $titulo.text())
    const m = tituloTxt.match(TITULO)
    const tipo = m ? limpio(m[1]!) : tituloTxt
    const numero = m ? m[2]! : ''

    const epigrafeTxt = limpio($card.find('p').first().text())
    const vigencia = limpio($card.find('.estado-vigencia').first().text())
    const epigrafe = vigencia ? `[${vigencia}] ${epigrafeTxt || tituloTxt}` : epigrafeTxt || tituloTxt

    // "Publicación: 24 Jul 2026 | Expedición 24 Jul 2026": se prefiere la de
    // expedición, que es la que fecha el acto y no su cambio de estado.
    //
    // El propio portal trae fechas de expedición rotas en algunas filas (se
    // vio "Expedición 27 Dic 0031" en una resolución de 2026, del propio dato
    // fuente, no de este parseo): se descarta cualquier fecha cuyo año no sea
    // plausible y se cae a Publicación, y de ahí al año que sí trae el título.
    const anioPlausible = (s: string): boolean => /\b(19|20)\d{2}\b/.test(s)
    const lineaFechas = limpio($card.find('.text-info-data[title]').first().text())
    const fechaExpedicion = lineaFechas.match(/Expedici[oó]n\s+([^|]+)/i)?.[1]?.trim() ?? ''
    const fechaPublicacion = lineaFechas.match(/Publicaci[oó]n:\s*([^|]+)/i)?.[1]?.trim() ?? ''
    const fecha =
      (anioPlausible(fechaExpedicion) ? fechaExpedicion : '') ||
      (anioPlausible(fechaPublicacion) ? fechaPublicacion : '') ||
      fechaExpedicion ||
      lineaFechas
    const anio = fecha.match(/\b(19|20)\d{2}\b/)?.[0] ?? tituloTxt.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''

    const url = $titulo.closest('a').attr('href') ?? ''

    items.push({ tipo, numero, anio, fecha, epigrafe, url })
  })

  return { items, totalDeclarado }
}

async function buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
  const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
  const start = (pagina - 1) * TAMANO_PAGINA
  const end = start + TAMANO_PAGINA

  const p = new URLSearchParams()
  p.set('id', CATEGORIA_RESOLUCIONES)
  if (opts.texto?.trim()) p.set('keyword', opts.texto.trim())
  p.set('start', String(start))
  p.set('end', String(end))

  const url = `${BASE}?${p}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`El portal de la Superintendencia de Sociedades respondió ${r.status}.`)

  const { items, totalDeclarado } = extraerActo(r.cuerpo)

  // Un vacío legítimo tiene DOS formas: la categoría no tiene nada con ese
  // filtro (total 0), o se pidió una página más allá del final (total > 0
  // pero `start` ya lo supera: el portal responde 200 con la tabla vacía en
  // vez de un 404). Ninguna de las dos es un fallo de parseo. Lo que sí lo es
  // es un vacío DENTRO del rango que el propio portal declara tener datos.
  if (totalDeclarado && start < totalDeclarado && items.length === 0) {
    throw new CanarioError('la categoría "Resoluciones" declara resultados en este rango pero no se pudo leer ninguna fila')
  }

  let resultado = items
  if (opts.anio) resultado = resultado.filter((a) => a.anio === opts.anio)
  if (opts.limite && opts.limite > 0) resultado = resultado.slice(0, opts.limite)

  return {
    items: resultado,
    total: totalDeclarado,
    nota:
      'Solo cubre la categoría "Resoluciones" del buscador de normativa. NO incluye leyes, decretos ni ' +
      'Constitución (ya están en el Gestor Normativo de Función Pública), ni circulares, ni el Decreto Único ' +
      'Reglamentario Sectorial: para esas, consulta el portal directamente.' +
      (opts.anio ? ' El filtro de año se aplicó sobre esta página de resultados, no sobre todo el histórico.' : ''),
    url,
  }
}

export default {
  id: 'supersociedades',
  nombre: 'Superintendencia de Sociedades',
  sector: 'sociedades comerciales, insolvencia y vigilancia societaria',
  portal: BASE,
  dominioPermitido: 'https://www.supersociedades.gov.co',
  tiposDocumento: ['Resolución'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Solo cubre resoluciones de la Superintendencia de Sociedades (~480 actos). NO cubre leyes, decretos, la ' +
    'Constitución, circulares (externas ni la Circular Básica Jurídica), el Decreto Único Reglamentario Sectorial, ' +
    'ni actas de conciliación. Los documentos son PDF: no hay texto para buscar dentro del articulado, solo el ' +
    'epígrafe que publica el portal. El estado "Vigente"/"Derogada" es el que declara el propio portal en cada ' +
    'fila, no una verificación de esta extensión.',
  buscar,
} satisfies Adaptador
