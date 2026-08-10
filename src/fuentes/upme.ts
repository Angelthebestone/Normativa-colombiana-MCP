/**
 * UPME — Unidad de Planeación Minero Energética.
 *
 * La única de las fuentes sectoriales que ofrece una API de verdad, y por
 * casualidad: su portal es WordPress y dejó `wp-json` abierto. La normativa no
 * vive en entradas corrientes sino en un tipo de contenido propio,
 * `circular_resolucion` («Circulares o Resoluciones»), que el REST expone
 * paginado y con búsqueda de texto.
 *
 * Dos cosas medidas que condicionan el parser:
 *
 * - **La `date` del REST es la de publicación en el portal, no la de la norma.**
 *   La «Resolución 1163 de 2024» figura con fecha 2025-12-18. El número y el año
 *   reales solo están en el título, así que se leen de ahí y la fecha del portal
 *   se rotula como lo que es.
 * - **El `link` apunta directamente al PDF** en `docs.upme.gov.co`, no a una
 *   ficha. No hay texto que extraer: se entrega la referencia y el enlace.
 *
 * Igual que en la ANH, el listado mezcla regulación con actos de personal
 * («Por la cual se efectúa nombramiento en periodo de prueba»); aquí no hay
 * categoría legible, así que el filtro va por el epígrafe.
 */
import { CanarioError, sinTildes } from '../nucleo/parse.ts'
import { pedir } from '../nucleo/http.ts'

const API = 'https://www.upme.gov.co/wp-json/wp/v2/circular_resolucion'

export type DocumentoUpme = {
  titulo: string
  /** Número y año leídos del título, que es donde constan de verdad. */
  numero: string
  anio: string
  tipo: string
  epigrafe: string
  publicado: string
  url: string
}

const limpiar = (s: string): string =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&#8217;|&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Los actos de personal no son regulación; se pueden pedir, pero no estorban por defecto. */
export const esActoDePersonal = (texto: string): boolean =>
  /\b(nombramiento|encargo|provisionalidad|periodo de prueba|licencia no remunerada|vacaciones|comisi[óo]n de servicios|insubsistente|renuncia)\b/i.test(
    sinTildes(texto),
  )

type Cruda = { title?: { rendered?: string }; excerpt?: { rendered?: string }; date?: string; link?: string }

export async function buscar(opts: {
  texto?: string | undefined
  pagina?: number | undefined
  limite?: number | undefined
}): Promise<{ total: number; paginas: number; items: DocumentoUpme[] }> {
  const p = new URLSearchParams({
    per_page: String(Math.min(Math.max(opts.limite ?? 10, 1), 50)),
    page: String(Math.max(1, Math.trunc(opts.pagina ?? 1))),
  })
  if (opts.texto?.trim()) p.set('search', opts.texto.trim())

  const r = await pedir(`${API}?${p}`, 40_000, 'application/json')
  // Pedir una página más allá del final devuelve 400: es un fin de lista, no un fallo.
  if (r.status === 400) return { total: 0, paginas: 0, items: [] }
  if (r.status !== 200) throw new Error(`El portal de la UPME respondió ${r.status}.`)

  let crudos: Cruda[]
  try {
    crudos = JSON.parse(r.cuerpo) as Cruda[]
  } catch {
    throw new CanarioError('la respuesta de wp-json de la UPME no es JSON')
  }
  if (!Array.isArray(crudos)) throw new CanarioError('wp-json de la UPME no devolvió una lista de documentos')

  const items = crudos.map((c) => {
    const titulo = limpiar(c.title?.rendered ?? '')
    // "Resolución 692 de 2025", "Circular 20241100000904 2024". El tipo se lee
    // con \S y no con \w: "Resolución" lleva tilde y \w la corta en seco.
    const m = titulo.match(/^(\S+)\s+([\d-]+)\s*(?:de\s+)?(\d{4})?/i)
    return {
      titulo,
      tipo: m?.[1] ?? '',
      numero: m?.[2] ?? '',
      anio: m?.[3] ?? '',
      epigrafe: limpiar(c.excerpt?.rendered ?? ''),
      publicado: (c.date ?? '').slice(0, 10),
      url: c.link ?? '',
    }
  })

  return {
    total: Number(r.cabeceras['x-wp-total'] ?? items.length),
    paginas: Number(r.cabeceras['x-wp-totalpages'] ?? 1),
    items,
  }
}
