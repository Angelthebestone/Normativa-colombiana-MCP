/**
 * Supertransporte — Superintendencia de Transporte de Colombia.
 *
 * El portal es WordPress (Avada) y el REST (`/index.php/wp-json/`) está abierto,
 * pero la normativa NO vive en un tipo de contenido propio: vive en páginas de
 * listado que mezclan texto libre, iframes y PDFs. Medido en agosto de 2026:
 *
 * - `resoluciones-generales/{anio}` trae las resoluciones del año en
 *   `div.tab-resolutions > div.resolution` (título, fecha, epígrafe, PDF), con
 *   paginación SOLO en cliente (`pagination.js` muestra de 10 en 10; el HTML
 *   trae todas). La página de 2024 trae 18.
 * - `circulares/{anio}` y «derogatorias» usan bloques `<p>` en `fusion-text`
 *   con el mismo patrón (título, fecha, epígrafe, PDF) pero SIN clase estable:
 *   hay que leerlos por el enlace a `/documentos/`.
 * - La «Biblioteca Jurídica» es un iframe a una SPA en
 *   `bibliotecajuridica.supertransporte.gov.co:3000`, cuyo backend
 *   (`172.27.244.20:8090/baranda/api/v1/`) es una IP privada: NO es viable
 *   desde aquí. El adaptador se queda con los listados públicos.
 *
 * Regla de la casa: si la estructura cambia (p. ej. desaparecen los
 * `.resolution` o los enlaces a `/documentos/`), se lanza `CanarioError` y no
 * una lista vacía: un vacío se leería como "esa norma no existe".
 */
import { CanarioError, cargar, sinTildes } from '../../parse.ts'
import { pedir } from '../../http.ts'
import type { ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.supertransporte.gov.co'
/** Resoluciones por año; el listado trae todas las del año en el HTML. */
const RUTA_RESOLUCIONES = '/index.php/resoluciones-generales/'

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Año más creíble de un texto (el de una fecha «31 de Diciembre 2024» o del título). */
const anioDe = (s: string): string => s.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''

/** El epígrafe es el párrafo largo (body-1); el título corto va en el enlace. */
function leerResolution($: ReturnType<typeof cargar>, nodo: ReturnType<ReturnType<typeof cargar>>): ActoSectorial | null {
  const $n = nodo
  // El enlace del icono (imagen) viene primero; el del título es a.boton-enlace-activo.
  const a = $n.find('a.boton-enlace-activo[href*="/documentos/"]').first()
  const href = a.attr('href') ?? ''
  if (!href) return null
  const titulo = limpio(a.text())
  const parrafos = $n
    .find('p')
    .map((_, p) => limpio($(p).text()))
    .get()
    .filter(Boolean)
  const fecha = parrafos.find((t) => /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i.test(t)) ?? ''
  const epigrafe = parrafos.find((t) => t && t !== fecha) ?? ''
  // El tipo se lee del título ("Supertransporte expide la Resolución 14306 de 2024").
  const tipo = titulo.match(/\b(?:la\s+)?(resoluci[oó]n|circular|decreto|ley)\b/i)?.[1] ?? 'Resolución'
  const numero = titulo.match(/(?:resoluci[oó]n|circular|decreto|ley)\s*(?:n[°o]\.?|no\.?)?\s*([\d]{2,6})/i)?.[1] ?? ''
  return {
    tipo,
    numero,
    anio: anioDe(`${titulo} ${fecha}`),
    fecha: fecha.replace(/^Fecha de resoluci[oó]n:\s*/i, ''),
    epigrafe,
    url: href.startsWith('http') ? href : new URL(href, BASE).toString(),
  }
}

export async function buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
  const anio = opts.anio ?? String(new Date().getFullYear())
  const url = `${BASE}${RUTA_RESOLUCIONES}${anio}/`
  const r = await pedir(url, 60_000)
  // Un 404 es una señal de que el año no existe, no de que no haya resultados.
  if (r.status === 404) throw new Error(`La Supertransporte no publica resoluciones del año ${anio} en su portal.`)
  if (r.status !== 200) throw new Error(`El portal de la Supertransporte respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  // Las resoluciones viven en este contenedor con paginación en cliente.
  const resoluciones = $('.tab-resolutions .resolution')
  if (!resoluciones.length) {
    throw new CanarioError('no se encontró el listado de resoluciones (.tab-resolutions .resolution)')
  }
  const items = resoluciones
    .map((_, r) => leerResolution($, $(r)))
    .get()
    .filter((x): x is ActoSectorial => x !== null)
  if (!items.length) throw new CanarioError('el listado de resoluciones no trajo ninguna fila con enlace')

  let resultantes = items
  if (opts.texto?.trim()) {
    const aguja = sinTildes(opts.texto.trim()).toLowerCase()
    resultantes = resultantes.filter((x) =>
      sinTildes(`${x.tipo} ${x.numero} ${x.anio} ${x.fecha} ${x.epigrafe}`.toLowerCase()).includes(aguja),
    )
  }
  // El listado llega completo en una página, así que el recorte lo hacemos aquí:
  // sin esto se devolvían las 25 filas aunque se pidieran 5.
  const tope = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  return {
    items: resultantes.slice(0, tope),
    total: resultantes.length,
    url,
    ...(resultantes.length > tope
      ? { nota: `Coinciden ${resultantes.length}; se muestran ${tope}. Sube limite para ver más.` }
      : {}),
  }
}

export default {
  id: 'supertransporte',
  nombre: 'Superintendencia de Transporte',
  sector: 'transporte, tránsito e infraestructura',
  portal: 'https://www.supertransporte.gov.co/index.php/transparencia-normatividad/',
  advertencia:
    'Cubre las resoluciones y circulares que la Supertransporte publica por año en su portal (resoluciones ' +
    'generales y circulares). NO cubre la Biblioteca Jurídica (un iframe a una aplicación con backend de ' +
    'acceso restringido), ni las circulares conjuntas con otras entidades, ni documentos sin listado anual. ' +
    'Los enlaces son PDF: este adaptador no lee el texto del documento.',
  buscar,
} satisfies import('../sectorial.ts').Adaptador
