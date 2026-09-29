/**
 * `buscar_normativa_anh`: resoluciones, acuerdos y circulares de la Agencia
 * Nacional de Hidrocarburos. Es un corte sectorial: la ANH publica en PDF, así
 * que solo se entrega el epígrafe y los enlaces, y por defecto se ocultan los
 * actos de personal, que son dos de cada tres.
 *
 * Reutiliza `buscar` de `fuentes/anh.ts`, que es quien habla con el portal.
 * Aquí solo va el esquema y el texto de la respuesta.
 */
import { z } from 'zod'

import { alcance } from '../nucleo/alcance.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as anh from '../fuentes/anh.ts'

export const TITULO = 'Buscar normativa de la ANH (hidrocarburos)'

export const DESCRIPCION =
  'Resoluciones, acuerdos y circulares de la Agencia Nacional de Hidrocarburos (785 documentos): contratos ' +
  'de exploración y producción, regalías, fiscalización y reservas. ÚSALA para hidrocarburos y regalías; NO ' +
  'devuelve el texto (publica en PDF), solo el epígrafe, el PDF y la ficha. Para leyes o decretos nacionales ' +
  'de cualquier sector usa resolver_cita. Por defecto OCULTA los actos de personal, que son dos de cada ' +
  'tres; pídelos con incluir_administrativos=true si de verdad los buscas.'

const esquema = z.object({
  texto: z.string().optional().describe('Palabra clave, ej. "regalías", "fiscalización"'),
  tipo: z.enum(Object.keys(anh.TIPOS) as [anh.TipoAnh, ...anh.TipoAnh[]]).optional(),
  numero: z.coerce.string().regex(/^\d+$/).optional().describe('Número del acto, como texto'),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha inicial AAAA-MM-DD'),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha final AAAA-MM-DD'),
  pagina: z.coerce.number().int().min(1).max(40).default(1).describe('Página de 20; hay 40 en total sin filtros'),
  incluir_administrativos: z
    .boolean()
    .default(false)
    .describe('Incluir nombramientos, encargos y demás actos de personal. Por defecto se ocultan.'),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export async function escribir({
  texto,
  tipo,
  numero,
  desde,
  hasta,
  pagina,
  incluir_administrativos,
}: Params): Promise<string> {
  const r = await anh.buscar({ texto, tipo, numero, desde, hasta, pagina })
  const ocultos = incluir_administrativos ? [] : r.items.filter((d) => anh.ES_ADMINISTRATIVO(d.categoria))
  const items = incluir_administrativos ? r.items : r.items.filter((d) => !anh.ES_ADMINISTRATIVO(d.categoria))

  if (!items.length) {
    return vacio(
      `normativa de la ANH en la página ${r.pagina}`,
      ocultos.length
        ? `Las ${ocultos.length} de esta página son actos de personal y se ocultaron; pide incluir_administrativos=true para verlos, o avanza de página.`
        : 'Prueba otra página, otro tipo o quita los filtros.',
    )
  }
  return (
    `${alcance([{ clave: 'anh', detalle: `${items.length} acto(s)` }])}\n\n` +
    `${items.length} documento(s) de la ANH en la página ${r.pagina}` +
    (ocultos.length ? ` (se ocultaron ${ocultos.length} actos de personal)` : '') +
    `.\n\n` +
    items
      .map(
        (d) =>
          `- ${d.tipo} ${d.numero} (${d.fecha})${d.categoria ? ` — ${d.categoria}` : ''}\n` +
          `  ${d.epigrafe || '(sin epígrafe)'}\n` +
          (d.urlPdf ? `  PDF: ${d.urlPdf}\n` : '') +
          `  Ficha: ${d.urlFicha}`,
      )
      .join('\n') +
    `\n\nEl texto completo no se puede leer aquí: la ANH publica en PDF y esta extensión no extrae su texto. ` +
    `El epígrafe de arriba es el del propio portal, citable tal cual.`
  )
}
