/**
 * MinAgricultura — Ministerio de Agricultura y Desarrollo Rural.
 *
 * El sitio es TYPO3, no SharePoint como sugería el encargo. Las tres rutas
 * (leyes, decretos, resoluciones) sirven el LISTADO COMPLETO en una sola
 * petición, sin paginación de servidor: medido, 57 leyes, 249 decretos y 1193
 * resoluciones, cada categoría entera en un único HTML. El buscador visible
 * (número/año) es JavaScript que solo oculta tarjetas ya cargadas —el
 * `<select>` de filtro no existe siquiera—, así que aquí se descarga todo y se
 * filtra en el propio adaptador.
 *
 * `OpcionesSectorial` no tiene un `tipo` para elegir categoría (a diferencia
 * de ANH, que sí tiene su propia herramienta con ese parámetro), así que las
 * tres rutas se combinan en una sola respuesta: es la única forma de que
 * "buscar resoluciones de 2023" no se quede callado sobre las leyes o
 * decretos de ese mismo año.
 *
 * Cada `<article class="item_norm">` trae `data-number`/`data-year` ya
 * separados por TYPO3, así que no hace falta adivinarlos del título como en
 * casi toda esta extensión. La fecha completa, en cambio, NO está
 * estructurada: solo el año lo está. Se intenta recuperar el resto (día y
 * mes) quitando el "TIPO NÚMERO" del encabezado del propio portal.
 */
import { CanarioError, cargar, colapsarEspacios, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { Adaptador, ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.minagricultura.gov.co'
const CATEGORIAS: { tipo: string; ruta: string }[] = [
  { tipo: 'Ley', ruta: '/normatividad/leyes' },
  { tipo: 'Decreto', ruta: '/normatividad/decretos' },
  { tipo: 'Resolución', ruta: '/normatividad/resoluciones' },
]

/**
 * "LEY 2337 DE OCTUBRE DE 2023" -> "DE OCTUBRE DE 2023" -> "OCTUBRE DE 2023".
 * "RESOLUCION 000247 DEL 27 JULIO DE 2026" -> "27 JULIO DE 2026".
 * Si el título no empieza por "TIPO [No.] NÚMERO" (pasa con las entradas
 * "ANEXOS RESOLUCION…" que trae el listado de resoluciones), la heurística no
 * aplica y se cae de vuelta al año, que es lo único garantizado.
 *
 * ponytail: es texto libre del portal, no una fecha parseada; si algún día se
 * necesita ordenar por fecha real, hay que resolver día/mes con un parser de
 * fechas en español, no con esta heurística de recorte.
 */
const TIPO_NUM = /^(LEY|DECRETO|RESOLUCI[ÓO]N|ACUERDO)\.?\s*(?:No\.?|N[ÚU]M(?:ERO)?\.?)?\s*[\d.]+\s*/i
function fechaDe(titulo: string, anio: string): string {
  const sinCabecera = colapsarEspacios(titulo.replace(TIPO_NUM, ''))
  if (sinCabecera === colapsarEspacios(titulo)) return anio
  return sinCabecera.replace(/^(DE|DEL)\s+/i, '').trim() || anio
}

async function listar(tipo: string, ruta: string): Promise<ActoSectorial[]> {
  const url = `${BASE}${ruta}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`El portal de MinAgricultura respondió ${r.status} en ${url}.`)

  const $ = cargar(r.cuerpo)
  const arts = $('article.item_norm')
  // El buscador (número/año) tiene que seguir ahí aunque no haya filas: si
  // desaparece, la plantilla cambió y una lista vacía se leería como "no hay
  // normativa" en vez de "esto ya no se puede leer".
  if (!arts.length && !r.cuerpo.includes('cnt_form_search_norm')) {
    throw new CanarioError(`la página ${ruta} de MinAgricultura ya no trae su listado de normas`)
  }

  return arts
    .map((_, el) => {
      const $a = $(el)
      const titulo = colapsarEspacios($a.attr('data-title') ?? '')
      const anio = colapsarEspacios($a.attr('data-year') ?? '')
      const numero = colapsarEspacios($a.attr('data-number') ?? '')
      const epigrafe = colapsarEspacios($a.attr('data-info') ?? '') || titulo
      const href = $a.find('a[itemprop="url"]').first().attr('href') ?? ''
      const acto: ActoSectorial = {
        tipo,
        numero,
        anio,
        fecha: fechaDe(titulo, anio),
        epigrafe,
        url: href ? new URL(href, BASE).toString() : url,
      }
      return acto
    })
    .get()
    .filter((a) => a.numero || a.epigrafe)
}

export default {
  id: 'minagricultura',
  nombre: 'Ministerio de Agricultura y Desarrollo Rural',
  sector: 'agropecuario',
  portal: BASE,
  dominioPermitido: 'https://www.minagricultura.gov.co',
  tiposDocumento: ['Ley', 'Decreto', 'Resolución'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Solo PDF, sin texto articulado: no hay nada que extraer aquí, solo epígrafe y enlace. No publica vigencia. ' +
    'La fecha no viene estructurada: cuando el título del portal no trae un patrón "TIPO NÚMERO DE fecha" ' +
    'reconocible, "fecha" queda reducida al año. Se combinan leyes, decretos y resoluciones en una sola lista ' +
    'porque esta herramienta no tiene un parámetro de tipo; dentro de cada categoría van en el orden del portal ' +
    '(más reciente primero), sin intercalar por fecha entre categorías. Algunas resoluciones enlazan a un ' +
    'SharePoint del Ministerio en vez de a un PDF propio del dominio.',
  async buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
    const listas = await Promise.all(CATEGORIAS.map((c) => listar(c.tipo, c.ruta)))
    let items = listas.flat()

    const aguja = sinTildes(opts.texto?.trim() ?? '').toLowerCase()
    if (aguja) {
      items = items.filter((a) => sinTildes(`${a.tipo} ${a.numero} ${a.epigrafe}`).toLowerCase().includes(aguja))
    }
    const anio = opts.anio?.trim()
    if (anio) items = items.filter((a) => a.anio === anio)

    const total = items.length
    const limite = Math.max(1, Math.trunc(opts.limite ?? 20))
    const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
    items = items.slice((pagina - 1) * limite, (pagina - 1) * limite + limite)

    return {
      items,
      total,
      nota:
        'Combina leyes, decretos y resoluciones del Ministerio; la paginación (pagina/limite) es de esta ' +
        'extensión, no del portal: cada categoría se descarga completa en una sola petición.',
      url: CATEGORIAS.map((c) => `${BASE}${c.ruta}`).join(' , '),
    }
  },
} satisfies Adaptador
