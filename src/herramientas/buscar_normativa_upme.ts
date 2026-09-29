/**
 * `buscar_normativa_upme`: circulares y resoluciones de la Unidad de Planeación
 * Minero Energética. Sus documentos son PDF y su fecha es la de publicación en
 * la web, no la de la norma: eso va advertido en la respuesta.
 *
 * Reutiliza `buscar` de `fuentes/upme.ts`, que es quien habla con el portal.
 * Aquí solo va el esquema y el texto de la respuesta.
 */
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as upme from '../fuentes/upme.ts'

export const TITULO = 'Buscar circulares y resoluciones de la UPME'

export const DESCRIPCION =
  'Circulares y resoluciones de la Unidad de Planeación Minero Energética: convocatorias de transmisión y de ' +
  'gas, planes de expansión y actos administrativos. NO devuelve el texto: son PDF. ' +
  'OJO CON LAS FECHAS: la fecha que publica su portal es la de PUBLICACIÓN EN LA WEB, no la de la norma — la ' +
  '"Resolución 1163 de 2024" figura publicada en 2025. El número y el año reales están en el título.'

const esquema = z.object({
  texto: z.string().optional().describe('Términos a buscar, ej. "transmisión", "plan de expansión"'),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(50).default(10),
  incluir_administrativos: z
    .boolean()
    .default(false)
    .describe('Incluir nombramientos y demás actos de personal. Por defecto se ocultan.'),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ texto, pagina, limite, incluir_administrativos }: Params): Promise<string> {
  const r = await upme.buscar({ texto, pagina, limite })
  const ocultos = incluir_administrativos ? [] : r.items.filter((d) => upme.esActoDePersonal(d.epigrafe))
  const items = incluir_administrativos ? r.items : r.items.filter((d) => !upme.esActoDePersonal(d.epigrafe))

  if (!items.length) {
    return vacio(
      `circulares o resoluciones de la UPME${texto ? ` sobre "${texto}"` : ''}`,
      ocultos.length
        ? `Las ${ocultos.length} de esta página son actos de personal y se ocultaron; usa incluir_administrativos=true.`
        : r.procedencia === 'portal'
          ? `El buscador del portal no devolvió resultados para "${texto}" en el HTML de ?q= (ni el REST). Prueba un término más general.`
          : `El buscador de la UPME es el de WordPress y solo indexa el título y el resumen. Prueba un término más general.`,
    )
  }
  return (
    `${alcance([{ clave: 'upme', detalle: `${items.length} documento(s)` }])}\n\n` +
    `${r.total} documento(s) en la UPME (${r.paginas} página(s)); se muestran ${items.length} de la página ${pagina}` +
    (ocultos.length ? `, ocultando ${ocultos.length} acto(s) de personal` : '') +
    (r.procedencia === 'portal'
      ? '\nResultados del buscador del portal (indexa el contenido de los PDF), no del REST.'
      : '') +
    `.\n\n` +
    items
      .map(
        (d) =>
          `- ${d.titulo}${d.anio ? '' : ' (el título no trae año)'}\n` +
          `  ${d.epigrafe || '(sin resumen)'}\n` +
          `  Publicado en el portal: ${d.publicado} — NO es la fecha de la norma\n` +
          `  PDF: ${d.url}`,
      )
      .join('\n') +
    (pagina < r.paginas ? `\n\nHay más: repite con pagina=${pagina + 1}.` : '')
  )
}
