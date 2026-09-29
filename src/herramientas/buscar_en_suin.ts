/**
 * `buscar_en_suin`: el corpus histórico de SUIN-Juriscol (MinJusticia), incluidos
 * documentos que el Gestor no tiene. Reutiliza `buscar` de `fuentes/suin.ts`; aquí
 * solo van el esquema y el texto de la respuesta.
 */
import { z } from 'zod'

import { alcance } from '../nucleo/alcance.ts'
import { conAlternativas } from '../nucleo/alternativas.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as suin from '../fuentes/suin.ts'

export const TITULO = 'Buscar en SUIN-Juriscol'

export const DESCRIPCION =
  'Busca en los 56.832 documentos de SUIN-Juriscol (MinJusticia) por título, epígrafe, materia o entidad ' +
  'emisora: leyes, decretos y resoluciones desde 1844, incluidos documentos que el Gestor Normativo no tiene. ' +
  'NO busca dentro del articulado ni sirve para citas exactas ("LEY 909 DE 2004" no devuelve nada): para una ' +
  'cita usa resolver_cita. El campo de vigencia que devuelve es el del BUSCADOR y NO es fiable: contradice la ' +
  'ficha del propio documento; para el estado real usa resolver_cita. ' +
  'SU ÍNDICE TIENE HUECOS: "Teletrabajo" devuelve cero pese a estar en el título de la Ley 1221 de 2008, y ' +
  'una frase larga empareja por palabras comunes. Ante un vacío, NO concluyas que no existe: prueba ' +
  'buscar_por_tema.'

const esquema = z.object({
  texto: z.string().describe('Palabras del título, epígrafe o materia. Ej.: "servicio militar", "Buenaventura"'),
  vigencia: z
    .enum(['Vigente', 'Vigencia en Estudio', 'Compilado', 'Derogado', 'No vigente', 'Declarado Inexequible', 'Sustituido'])
    .optional()
    .describe('Filtra por el estado que declara el BUSCADOR, que no siempre coincide con la ficha'),
  sector: z.string().optional().describe('Sector administrativo, ej. "Hacienda y Crédito Público"'),
  desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar'),
  limite: z.coerce.number().int().min(1).max(50).default(15),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export async function escribir({ texto, vigencia, sector, desde, limite }: Params): Promise<string> {
  // Idea 5 — si la búsqueda rinde cero, se prueba el sinónimo del tesauro y
  // se anuncia: el índice de SUIN tiene huecos conocidos ("Teletrabajo" da 0
  // pese a existir la Ley 1221 de 2008), así que el vacío no es palabra final.
  const { items, variantesUsadas } = await conAlternativas(
    (t) => suin.buscar({ texto: t, vigencia, sector, desde, limite }).then((r) => r.items),
    texto,
    1,
  )
  const r = { items, total: items.length }
  const avisoAlternativa = variantesUsadas.length
    ? `La búsqueda de "${texto}" no rindió resultados; se usó «${variantesUsadas[0]}». Si no es lo que buscabas, ` +
      `no concluyas que el documento no existe: el índice de SUIN tiene huecos.\n\n`
    : ''
  if (!r.total) {
    return vacio(
      `documentos en SUIN para "${texto}"`,
      'El buscador de SUIN solo indexa título, epígrafe, materia y entidad: no busca dentro del articulado, y las ' +
        'citas exactas no funcionan ahí. Para una norma concreta usa resolver_cita.',
    )
  }
  if (!r.items.length) {
    return vacio(`documentos a partir de la posición ${desde}`, `La búsqueda reúne ${r.total}; pide un "desde" menor.`)
  }
  const fin = desde + r.items.length
  return (
    `${alcance([{ clave: 'suin', detalle: `${r.total} documento(s)` }])}\n\n` +
      `${avisoAlternativa}${r.total} documento(s) en SUIN-Juriscol; se muestran ${desde + 1}–${fin}.\n\n` +
      r.items
        .map(
          (d) =>
            `- ${d.titulo} (${d.subtipo})\n  ${d.epigrafe || '(sin epígrafe)'}\n` +
            `  Vigencia SEGÚN EL BUSCADOR: ${d.vigencia || '(sin dato)'}\n  ${d.url}`,
        )
        .join('\n') +
      (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : '') +
      `\n\nATENCIÓN: la vigencia de esta lista es la del índice de búsqueda y contradice la ficha del documento ` +
      `(la Ley 74 de 1923 figura aquí como "Vigencia en Estudio" y su ficha dice DEROGADO). Para el estado real ` +
      `de una norma, pídela por su cita con resolver_cita. Ese camino tiene un tope, y este ejemplo lo enseña: ` +
      `resolver_cita solo alcanza lo que estén el Gestor Normativo o el índice de leyes de SUIN, y la Ley 74 de ` +
      `1923 no está en ninguno, así que responderá que no la encuentra. Cuando pase eso, el único estado fiable ` +
      `es el de la ficha del documento, en el enlace de arriba.`
  )
}
