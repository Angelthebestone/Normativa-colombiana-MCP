/**
 * `buscar_normativa_tributaria`: el normograma de la DIAN, la única fuente que
 * cubre la materia tributaria, aduanera y cambiaria. Reutiliza `buscar` de
 * `fuentes/normograma.ts`; aquí solo van el esquema y el texto de la respuesta.
 */
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as dian from '../fuentes/normograma.ts'

export const TITULO = 'Buscar normativa tributaria, aduanera y cambiaria (DIAN)'

export const DESCRIPCION =
  'Normograma de la DIAN: decretos, resoluciones, conceptos y circulares en materia tributaria, aduanera y ' +
  'cambiaria, que ninguna otra herramienta cubre. Devuelve el extracto y el enlace; para leer el documento ' +
  'usa obtener_documento con fuente="dian". ' +
  'AVISO: la primera búsqueda de cada término tarda ~20 s (el portal devuelve el resultado completo y no ' +
  'admite tope), pero las páginas siguientes del MISMO término son instantáneas: pagina con desde en vez de ' +
  'lanzar búsquedas nuevas.'

const esquema = z.object({
  texto: z.string().describe('Términos a buscar, ej. "retención en la fuente", "declaración de importación"'),
  desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar'),
  limite: z.coerce.number().int().min(1).max(50).default(15),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ texto, desde, limite }: Params): Promise<string> {
  const r = await dian.buscar(texto, limite, desde)
  if (!r.total) {
    return vacio(`normativa de la DIAN sobre "${texto}"`, 'Prueba con menos palabras o con el término técnico exacto.')
  }
  const items = r.items
  if (!items.length) return vacio(`resultados a partir de la posición ${desde}`, `La búsqueda reúne ${r.total}; pide un "desde" menor.`)
  const fin = desde + items.length
  const cacheNota = r.obsoleta
    ? '\n(red caída: se sirvió la caché vencida de esta búsqueda, rotulada como obsoleta)'
    : r.caducada
      ? '\n(la caché de este término había vencido y se refrescó)'
      : r.deCache
        ? '\n(de caché, dentro de los últimos 30 minutos)'
        : ''
  return (
    `${alcance([{ clave: 'dian', detalle: `${r.total} documento(s)` }])}\n\n` +
      `${r.total} documento(s) en el normograma de la DIAN; se muestran ${desde + 1}–${fin}.${cacheNota}\n\n` +
      items
        .map(
          (d) =>
            `- ${d.nombre}${d.tipo ? ` (${d.tipo}${d.anio ? `, ${d.anio}` : ''})` : ''}\n` +
            `  ${d.epigrafe || '(sin epígrafe)'}\n` +
            (d.entidad ? `  Entidad: ${d.entidad}\n` : '') +
            (d.extracto ? `  «…${d.extracto.slice(0, 240)}…»\n` : '') +
            `  link para obtener_documento con fuente="dian": ${d.link}`,
        )
        .join('\n') +
      (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : '')
  )
}
