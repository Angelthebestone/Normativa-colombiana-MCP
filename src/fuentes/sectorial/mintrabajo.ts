/**
 * Mintrabajo — Ministerio del Trabajo de Colombia.
 *
 * La ruta pública «normatividad» (https://www.mintrabajo.gov.co/web/guest/normatividad)
 * responde 302 a «marco legal» (https://www.mintrabajo.gov.co/web/guest/marco-legal),
 * que es la página que de verdad publica el listado. Medido en agosto de 2026:
 * 755 filas de normas en una sola página de 1,36 MB, sin paginación ni buscador:
 * 32 leyes, 169 decretos, 421 resoluciones, 131 circulares y 2 «códigos».
 *
 * Lo que costó averiguar:
 *
 * - **Es un portlet de Liferay**, no una API: `/api/jsonws` devuelve la portada
 *   y no hay endpoint de documentos. Se lee el HTML, que es lo único estable.
 * - **Hay DOS formatos de tabla en el mismo portal.** El de «marco legal»
 *   (filas `td[data-label]`, enlaces relativos `/documents/d/guest/...` que son
 *   PDF de Liferay) y el de las páginas por año (`/normatividad/circulares/2020`,
 *   celdas planas y enlaces a `acortar.link`, que no conviene resolver por
 *   HTTP). El parser acepta los dos: una fila vale si tiene las 5 celdas
 *   esperadas con un enlace en la de «Acceso» o «Enlace de acceso».
 * - **El encabezado no es `<thead>`**: en las páginas por año la primera fila
 *   del `<tbody>` es el rótulo («Tipo de norma», «Norma», «Epígrafe»…), así que
 *   se detecta por contenido en vez de por la etiqueta.
 * - El «número» y el «año» van juntos en la celda «Norma» («0661 del 26 de
 *   junio de 2026», «No 0089», «Circular 0026 de 2020»). El formato varía
 *   muchísimo y no conviene fingir un parseo fino: se entrega como vino.
 * - Los epígrafes de las circulares vienen en MAYÚSCULAS y con erratas de
 *   codificación («RESPE�TANDO»): se normaliza el texto plano pero no se
 *   reescribe el contenido.
 */
import { CanarioError, cargar, sinTildes } from '../../parse.ts'
import { pedir } from '../../http.ts'
import type { OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.mintrabajo.gov.co'
/** «normatividad» responde 302 a esta página, que es la que trae las tablas. */
const RUTA = '/web/guest/marco-legal'

export type ActoMintrabajo = {
  tipo: string
  numero: string
  anio: string
  /** Como la publica el portal, sin normalizar. */
  fecha: string
  epigrafe: string
  /** Enlace de descarga tal como lo publica la fila (PDF de Liferay, acortador…). */
  url: string
}

/**
 * Número y año dentro de la celda «Norma» («0661 del 26 de junio de 2026»,
 * «No. 3462», «Circular 0026 de 2020»).
 *
 * La alternativa `^` es lo que rescata a los decretos: su celda empieza por el
 * número pelado, sin palabra delante, y exigir el rótulo los devolvía todos como
 * «Decreto  de 2026», sin número con el que citarlos ni con el que filtrar.
 */
const NUMERO = /(?:^|\b(?:n[°o]\.?|no\.?|circular|decreto|resoluci[oó]n|ley)\s*)([\d]{2,6})\b/i
const ANIO = /\b((?:19|20)\d{2})\b/
/** «Circular 0026 de 2020», «0661 del 26 de junio de 2026»: aquí el año es de verdad el año. */
const ANIO_TRAS_DE = /\bde\s+((?:19|20)\d{2})\b/i

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Las páginas por año («circulares/2020») usan celdas planas; marco-legal usa `td[data-label]`. */
const celda = ($tr: ReturnType<ReturnType<typeof cargar>>, i: number): string => {
  const conLabel = $tr.find('td[data-label]').eq(i)
  if (conLabel.length) return limpio(conLabel.text())
  return limpio($tr.find('td').eq(i).text())
}

export async function buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
  const url = `${BASE}${RUTA}`
  const r = await pedir(url, 90_000)
  // El 302 lo deja `pedir` sin seguir: si algún día llega aquí con la redirección
  // en la mano, la página cambió y un vacío se leería como "no hay normativa".
  if (r.status === 302) {
    throw new CanarioError('la página de normatividad del Mintrabajo redirige (302) a otra ruta')
  }
  if (r.status !== 200) throw new Error(`El portal del Mintrabajo respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  // Con 755 filas y 1,36 MB la página es pesada; si el marcador de filas no
  // aparece, el portlet cambió y no se puede distinguir vacío de estructura rota.
  const filas = $('table tbody tr')
  const conNorma = filas.filter((_, tr) => {
    const $tr = $(tr)
    return $tr.find('td').length >= 5 && /norma|circular|decreto|resoluci[oó]n|ley/i.test(limpio($tr.text()))
  })
  if (!conNorma.length) throw new CanarioError('no se encontró ninguna fila de norma en el marco legal')

  const items: ActoMintrabajo[] = []
  conNorma.each((_, tr) => {
    const $tr = $(tr)
    const tipo = celda($tr, 0)
    const norma = celda($tr, 1)
    const epigrafe = celda($tr, 2)
    const fecha = celda($tr, 3)
    // El enlace puede no estar en la última celda («Descargar» sin href en
    // algunas filas viejas): se busca en toda la fila y se descarta si no hay.
    const href = $tr.find('a[href]').attr('href') ?? ''
    if (!tipo || !norma || !href) return
    const numero = norma.match(NUMERO)?.[1] ?? ''
    // El año puede ir en la celda «Norma» o solo en la fecha («No. 3462»). Pero
    // hay números que PARECEN año: «Ley 1929» daba "Ley 1929 de 1929" cuando la
    // fila decía 2018 en su fecha. Solo vale como año el que va tras «de», o uno
    // suelto que no sea el propio número; si no, manda la fecha.
    const suelto = norma.match(ANIO)?.[0] ?? ''
    const anio =
      norma.match(ANIO_TRAS_DE)?.[1] ??
      (suelto && suelto !== numero ? suelto : (fecha.match(ANIO)?.[0] ?? ''))
    items.push({
      tipo: limpio(tipo),
      numero,
      anio,
      fecha,
      epigrafe,
      url: href.startsWith('http') ? href : new URL(href, BASE).toString(),
    })
  })

  let resultantes = items
  if (opts.anio) resultantes = items.filter((x) => x.anio === String(opts.anio))
  if (opts.texto?.trim()) {
    const aguja = sinTildes(opts.texto.trim()).toLowerCase()
    resultantes = resultantes.filter((x) =>
      sinTildes(`${x.tipo} ${x.numero} ${x.anio} ${x.fecha} ${x.epigrafe}`.toLowerCase()).includes(aguja),
    )
  }
  const omitidas = conNorma.length - items.length
  // El portal entrega la tabla entera de una vez, así que el recorte es nuestro:
  // sin él se devolvían las 745 filas pidiera lo que pidiera quien consulta.
  const tope = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  const notas = [
    omitidas > 0 ? `Se omitieron ${omitidas} filas del portal sin enlace de descarga.` : '',
    resultantes.length > tope ? `Coinciden ${resultantes.length}; se muestran ${tope}. Sube limite para ver más.` : '',
  ].filter(Boolean)
  return {
    items: resultantes.slice(0, tope),
    total: resultantes.length,
    url,
    ...(notas.length ? { nota: notas.join(' ') } : {}),
  }
}

export default {
  id: 'mintrabajo',
  nombre: 'Ministerio del Trabajo',
  sector: 'trabajo, empleo y seguridad social',
  portal: 'https://www.mintrabajo.gov.co/web/guest/normatividad',
  advertencia:
    'Cubre solo lo que el Mintrabajo publica en su marco legal (leyes, decretos, resoluciones y circulares ' +
    'del Ministerio). No cubre conceptos, doctrina, ni la normativa de otras entidades. El enlace de cada ' +
    'fila es de descarga (PDF o acortador): este adaptador NO lee el texto del documento. El número sale de la ' +
    'celda «Norma» del portal y a veces el propio portal lo escribe mal: la fila "Ley 2021 de 2021" enlaza el PDF ' +
    'de la Ley 2101 de 2021. Antes de citar un número, ábrelo.',
  buscar,
} satisfies import('../sectorial.ts').Adaptador