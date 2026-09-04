/**
 * `historial_norma`: la cadena de reformas que el Gestor anota sobre una norma,
 * estructurada como lista navegable (acción → norma → artículo afectado → nota
 * literal citable). NO deduce vigencia: las notas son literales del portal y el
 * estado actual se consulta con resolver_cita.
 *
 * Reutiliza `historial()` de parse.ts (que ya parsea las tres formas de nota) y
 * la resolución de citas de comparar_articulos (parsearCita → gestor.buscar →
 * obtenerNorma). No reimplementa nada.
 */
import { z } from 'zod'

import { historial, type Cambio } from '../nucleo/parse.ts'
import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Historial de reformas de una norma'

export const DESCRIPCION =
  'Devuelve la cadena de reformas que el Gestor anota sobre una norma: qué norma la modificó, adicionó, ' +
  'derogó, sustituyó... y qué artículo afectó cada cambio, con la nota literal citable. Son las notas del ' +
  'portal, no una deducción de vigencia: el estado actual se consulta con resolver_cita.'

const esquema = z.object({
  cita: z.string().describe('Cita de la norma, ej. "Ley 100 de 1993"'),
  articulo: z
    .string()
    .optional()
    .describe('Filtra a los cambios que afectaron ese artículo (ej. "6"); sin él se devuelven todos'),
  desde: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Cuántos cambios saltarse antes de empezar (los demás no caben en la respuesta)'),
  limite: z.coerce.number().int().min(1).max(100).default(20).describe('Cuántos cambios mostrar (hasta 100)'),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

/**
 * Formatea la cadena de reformas. Exportada para testearla sin red con fixtures
 * del texto del Gestor.
 */
export function formatearHistorial(
  cambios: Cambio[],
  titulo: string,
  url: string,
  opts: { articulo?: string | undefined; desde?: number | undefined; limite?: number | undefined } = {},
): string {
  const porArticulo = opts.articulo ? cambios.filter((c) => c.articulo.replace(/\.$/, '') === opts.articulo!.replace(/\.$/, '')) : cambios
  if (opts.articulo && !porArticulo.length) {
    return (
      `${titulo} (${url})\n\nEl Gestor anota ${cambios.length} cambio(s) sobre esta norma, pero ninguno sobre el ` +
      `artículo ${opts.articulo}. Eso NO equivale a que siga intacto: el portal no siempre anota las reformas; ` +
      `la vigencia se consulta con resolver_cita.`
    )
  }
  if (!porArticulo.length) {
    return (
      `${titulo} (${url})\n\nEl Gestor no anota reformas sobre esta norma. Eso NO equivale a que esté intacta: ` +
      `el portal no siempre anota las reformas; la vigencia se consulta con resolver_cita.`
    )
  }
  const desde = Math.max(0, opts.desde ?? 0)
  const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  const tramo = porArticulo.slice(desde, desde + limite)
  if (!tramo.length) {
    return (
      `${titulo} (${url})\n\nEl filtro reúne ${porArticulo.length} cambio(s)` +
      `${opts.articulo ? ` sobre el artículo ${opts.articulo}` : ''}, pero "desde" (${desde}) está más allá del final. ` +
      `Pide un "desde" menor.`
    )
  }
  const fin = desde + tramo.length
  const ambito = opts.articulo ? ` sobre el artículo ${opts.articulo}` : ''
  return (
    `${titulo} (${url})\n\n${porArticulo.length} cambio(s) anotado(s) en el texto del portal${ambito}; ` +
    `se muestran ${desde + 1}–${fin}:\n\n` +
    tramo
      .map(
        (c) =>
          `- ${c.accion.toUpperCase()}${c.norma ? ` por ${c.norma} de ${c.anio}` : ''}` +
          `${c.articulo ? `, artículo ${c.articulo}` : ''}\n  Nota literal: «${c.literal}»`,
      )
      .join('\n') +
    (fin < porArticulo.length ? `\n\nQuedan ${porArticulo.length - fin}: repite con desde=${fin}.` : '') +
    `\n\nSon las notas literales del portal, citadas tal cual, en el orden en que aparecen en el documento. ` +
    `No están ordenadas por fecha ni se deduce cuál rige hoy: para el estado actual usa resolver_cita.`
  )
}

export async function escribir({ cita, articulo, desde, limite }: Params): Promise<string> {
  const c = parsearCita(cita)
  if (!c) {
    return `No reconocí «${cita}» como una cita del Gestor Normativo. Escríbela como "Ley 100 de 1993" o "Decreto 1072 de 2015".`
  }
  const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return (
        `La cita «${cita}» es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años ` +
        `distintos. Repite con el año, por ejemplo «${ambiguos[0]!.titulo}».`
      )
    }
  }
  const primero = r.items[0]
  if (!primero) {
    return `No encontré la norma «${cita}» en el Gestor Normativo. Prueba con resolver_cita.`
  }
  const n = await gestor.obtenerNorma(primero.id)
  return formatearHistorial(historial(n.texto), n.titulo, n.url, { articulo, desde, limite })
}
