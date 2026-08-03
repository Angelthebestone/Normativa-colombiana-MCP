/**
 * CREG — Comisión de Regulación de Energía y Gas.
 *
 * Su «Gestor Normativo Alejandría 2.0» no es el software de Función Pública
 * —ningún marcador coincide— sino un sitio de páginas estáticas. Eso, que suena
 * peor, resulta ser lo mejor de las cuatro fuentes sectoriales:
 *
 * - **El texto está en HTML**, en `docs/resolucion_creg_101-104_2026.htm`, no en
 *   PDF. Es la única de las cuatro cuyo articulado se puede leer aquí.
 * - **Publica la vigencia como estructura**, cosa rarísima en Colombia: mantiene
 *   dos compilaciones cronológicas separadas, una de resoluciones «no derogadas
 *   expresamente o anuladas» y otra de derogadas. No es un campo por norma, pero
 *   es un dato oficial y verificable, y se traslada tal cual sin convertirlo en
 *   un sí o un no.
 * - Sin buscador ni API: se descarga la compilación entera —unos 72 KB— y se
 *   filtra aquí. Es una sola petición por consulta.
 *
 * ponytail: se leen las dos compilaciones cronológicas y no las temáticas ni las
 * «resoluciones únicas» (que son refundidos). Si hiciera falta buscar dentro de
 * un refundido, el salto siguiente es `obtenerTexto` sobre su `.htm`, que ya
 * está resuelto.
 */
import { CanarioError, cargar, sinTildes, textoDe } from '../parse.ts'
import { pedir } from '../http.ts'

const BASE = 'https://gestornormativo.creg.gov.co/gestor/entorno/'

/** Las dos compilaciones cronológicas, que es donde vive la señal de vigencia. */
export const COMPILACIONES = {
  vigentes: 'resoluciones_por_orden_cronologico_no_derogadas.html',
  derogadas: 'resoluciones_por_orden_cronologico_derogadas.html',
  todas: 'resoluciones_por_orden_cronologico.html',
} as const
export type Compilacion = keyof typeof COMPILACIONES

export type ResolucionCreg = {
  numero: string
  anio: string
  epigrafe: string
  /** Cómo la clasifica la compilación de la que salió, literal. */
  estadoSegunCompilacion: string
  ruta: string
  url: string
}

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

const ROTULO: Record<Compilacion, string> = {
  vigentes: 'No derogada expresamente ni anulada, según la compilación cronológica de la CREG',
  derogadas: 'Derogada o anulada, según la compilación cronológica de la CREG',
  todas: 'La compilación consultada no distingue el estado',
}

/**
 * Las entradas no están en una tabla: son enlaces a `docs/resolucion_creg_*.htm`
 * y el número, el año y el epígrafe viven en el texto que los acompaña. Se lee
 * por el enlace, que es lo único estable, y de su nombre salen número y año.
 */
/**
 * Cada compilación se publica por AÑO, con el año como sufijo del fichero. La
 * página sin sufijo trae solo el año en curso —20 resoluciones—, mientras que
 * `..._no_derogadas_2025.html` trae 118. Sin esto, buscar en la CREG solo
 * miraba el año corriente y devolvía "no encontré" para todo lo anterior.
 */
const paginaDe = (compilacion: Compilacion, anio?: string): string => {
  const base = COMPILACIONES[compilacion]
  return anio && anio !== String(new Date().getFullYear()) ? base.replace(/\.html$/, `_${anio}.html`) : base
}

export async function buscar(
  compilacion: Compilacion,
  filtro?: string,
  limite = 20,
  anio?: string,
): Promise<{ total: number; items: ResolucionCreg[]; pagina: string }> {
  const pagina = paginaDe(compilacion, anio)
  const r = await pedir(`${BASE}${pagina}`, 60_000)
  if (r.status === 404) {
    throw new Error(
      `La CREG no publica la compilación "${compilacion}" para el año ${anio}. Cubre desde 1994 hasta hoy.`,
    )
  }
  if (r.status !== 200) throw new Error(`El gestor normativo de la CREG respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  const enlaces = $('a[href*="docs/resolucion_creg_"]')
  if (!enlaces.length) {
    throw new CanarioError(`la compilación "${compilacion}" de la CREG no trae enlaces a resoluciones`)
  }

  const vistos = new Set<string>()
  const todas: ResolucionCreg[] = []
  enlaces.each((_, a) => {
    const $a = $(a)
    const ruta = $a.attr('href') ?? ''
    if (!ruta || vistos.has(ruta)) return
    vistos.add(ruta)
    // docs/resolucion_creg_101-104_2026.htm → número 101-104, año 2026
    const m = ruta.match(/resolucion_creg_([\d_-]+)_(\d{4})\.htm/i)
    // El epígrafe acompaña al enlace; el contenedor varía, así que se toma el
    // bloque de texto del ancestro más cercano que diga algo.
    const cerca = limpio($a.parent().text()) || limpio($a.text())
    todas.push({
      numero: (m?.[1] ?? '').replace(/_/g, '-'),
      anio: m?.[2] ?? '',
      // El texto viene precedido del nombre de un icono de Material Symbols
      // ("menu_book"), que la página usa como tipografía y el extractor ve como
      // una palabra más. Se quita junto con el rótulo de la propia resolución.
      epigrafe: cerca
        .replace(/^(?:menu_book|local_library|early_on|vertical_align_top)\s*/i, '')
        .replace(/^Resoluci[óo]n\s+[\d_-]+\s+de\s+\d{4}\s*(?:CREG)?\s*/i, '')
        .slice(0, 600),
      estadoSegunCompilacion: ROTULO[compilacion],
      ruta,
      url: new URL(ruta, BASE).toString(),
    })
  })

  const q = filtro ? sinTildes(filtro).toLowerCase().trim() : ''
  const items = q
    ? todas.filter((x) => sinTildes(`${x.numero} ${x.anio} ${x.epigrafe}`).toLowerCase().includes(q))
    : todas
  return { total: items.length, items: items.slice(0, limite), pagina }
}

/** Texto de una resolución. Es la única fuente sectorial que lo publica en HTML. */
export async function obtenerTexto(ruta: string): Promise<{ texto: string; url: string }> {
  const limpia = ruta.replace(/^.*?(docs\/)/, '$1').replace(/[^\w./-]/g, '')
  if (!/^docs\/resolucion_creg_[\w.-]+\.htm$/i.test(limpia)) {
    throw new Error(`Ruta de resolución CREG inválida: ${ruta}. Debe ser como "docs/resolucion_creg_101-104_2026.htm".`)
  }
  const url = new URL(limpia, BASE).toString()
  const r = await pedir(url, 60_000)
  if (r.status !== 200) throw new Error(`La CREG respondió ${r.status} para ${limpia}.`)
  const $ = cargar(r.cuerpo)
  // `main` deja fuera la cabecera de Alejandría, que son 3.000 caracteres de
  // menú y de textos alternativos de vídeos que no existen.
  return { texto: textoDe($, 'main') || textoDe($, 'body'), url }
}
