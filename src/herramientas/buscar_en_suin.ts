/**
 * `buscar_en_suin`: el corpus histórico de SUIN-Juriscol (MinJusticia), incluidos
 * documentos que el Gestor no tiene. Reutiliza `buscar` de `fuentes/suin.ts`; aquí
 * solo van el esquema y el texto de la respuesta.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { conAlternativas } from '../nucleo/alternativas.ts'
import { sinTildes } from '../nucleo/parse.ts'
import { vacio } from '../nucleo/vacio.ts'
import { terminosSignificativos } from '../fuentes/gestor.ts'
import * as suin from '../fuentes/suin.ts'

export const TITULO = 'Buscar en SUIN-Juriscol'

export const DESCRIPCION =
  'Busca en los 56.832 documentos de SUIN-Juriscol (MinJusticia) por título, epígrafe, materia o entidad ' +
  'emisora: leyes, decretos y resoluciones desde 1844, incluidos documentos que el Gestor Normativo no tiene. ' +
  'Devuelve título, epígrafe, enlace y la vigencia del BUSCADOR, que NO es fiable (contradice la ficha). ' +
  'NO busca dentro del articulado ni sirve para citas exactas ("LEY 909 DE 2004" no devuelve nada): para ' +
  'una cita, y para el estado real de vigencia, ' +
  'usa resolver_cita. vigencia y sector acotan la búsqueda de texto, no la sustituyen; para el tramo ' +
  'siguiente repite la misma llamada con desde = desde + limite. ' +
  'SU ÍNDICE TIENE HUECOS: "Teletrabajo" devuelve cero pese a estar en el título de la Ley 1221 de 2008, y ' +
  'una frase larga empareja por palabras comunes. Ante un vacío, NO concluyas que no existe: prueba ' +
  'buscar_por_tema.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

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

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

/** `deps.buscar` inyecta SUIN para probar sin red. */
export async function escribir(
  { texto, vigencia, sector, desde, limite }: Params,
  deps: { buscar?: typeof suin.buscar } = {},
): Promise<string> {
  // Idea 5 — si la búsqueda rinde cero, se prueba el sinónimo del tesauro y
  // se anuncia: el índice de SUIN tiene huecos conocidos ("Teletrabajo" da 0
  // pese a existir la Ley 1221 de 2008), así que el vacío no es palabra final.
  // Una variante sustituye a lo pedido, así que solo vale lo que la contiene
  // entera: «trabajo remoto» arrastraba 15 documentos que solo dicen «trabajo».
  const { items, variantesUsadas } = await conAlternativas(
    (t) =>
      (deps.buscar ?? suin.buscar)({ texto: t, vigencia, sector, desde, limite }).then((r) => {
        if (t === texto) return r.items
        const terminos = terminosSignificativos(t)
        return r.items.filter((d) => {
          const heno = sinTildes(`${d.titulo} ${d.epigrafe}`).toLowerCase()
          return terminos.every((x) => heno.includes(x))
        })
      }),
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
        'citas exactas no funcionan ahí. Para una norma concreta usa resolver_cita. Su índice tiene huecos ' +
        '("Teletrabajo" da 0 pese a estar en el título de la Ley 1221 de 2008): un vacío no prueba que no exista; ' +
        'prueba buscar_por_tema.',
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
