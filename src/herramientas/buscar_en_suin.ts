/**
 * `buscar_en_suin`: el buscador de SUIN-Juriscol (MinJusticia) —normas,
 * reglamentos técnicos por materia y la jurisprudencia que SUIN registra—,
 * incluidos documentos que el Gestor no tiene. Reutiliza `buscar` de
 * `fuentes/suin.ts`; aquí solo van el esquema y el texto de la respuesta.
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
  'Busca en el índice del buscador de SUIN-Juriscol (MinJusticia, unos 103.000 documentos hasta 2026) por ' +
  'tipo, número, año, título, epígrafe, materia, sector o entidad. coleccion elige qué se busca: "normas" ' +
  '(por defecto: leyes, decretos, resoluciones, circulares, directivas… desde 1844), o la jurisprudencia que ' +
  'SUIN registra porque afectó la vigencia de alguna norma: "corte-constitucional", "consejo-estado" o ' +
  '"corte-suprema". Los reglamentos técnicos se buscan por materia (ej. "Bebidas alcohólicas"). Cada ' +
  'resultado trae el estado de vigencia de su ficha, el enlace y el id con el que obtener_documento ' +
  '(fuente="suin") lee el texto. NO busca dentro del articulado. vigencia, sector y materia acotan la ' +
  'búsqueda; para el tramo siguiente repite la misma llamada con desde = desde + limite. Ante un vacío, NO ' +
  'concluyas que no existe: prueba buscar_por_tema.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  texto: z
    .string()
    .default('')
    .describe('Palabras del tipo, número, año, título, epígrafe o materia. Ej.: "servicio militar", "ley 909 2004"'),
  coleccion: z
    .enum(Object.keys(suin.COLECCIONES) as [suin.Coleccion, ...suin.Coleccion[]])
    .default('normas')
    .describe('normas, o la jurisprudencia de la corte-constitucional, el consejo-estado o la corte-suprema'),
  vigencia: z
    .enum([
      'Vigente',
      'Vigencia en Estudio',
      'Derogado',
      'Compilado',
      'Declarado Inexequible',
      'No vigente',
      'Declarado Nulo',
      'Derogado Parcialmente',
      'Vigente Parcial',
      'Suspendido Provisionalmente',
      'Inexequible parcialmente',
      'Sustituido',
    ])
    .optional()
    .describe('Filtra por el estado de vigencia de la ficha (solo normas)'),
  sector: z.string().optional().describe('Sector administrativo, ej. "Hacienda y Crédito Público"'),
  materia: z
    .string()
    .optional()
    .describe('Materia de SUIN; los reglamentos técnicos van por la suya, ej. "Bebidas alcohólicas"'),
  desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar'),
  limite: z.coerce.number().int().min(1).max(50).default(15),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

/** `deps.buscar` inyecta SUIN para probar sin red. */
export async function escribir(
  { texto, coleccion, vigencia, sector, materia, desde, limite }: Params,
  deps: { buscar?: typeof suin.buscar } = {},
): Promise<string> {
  if (!texto.trim() && !materia && !vigencia && !sector) {
    throw new Error('Indica texto, materia, vigencia o sector: sin ninguno no hay nada que buscar en SUIN.')
  }
  // Si la búsqueda rinde cero, se prueba el sinónimo del tesauro y se anuncia.
  // Una variante sustituye a lo pedido, así que solo vale lo que la contiene
  // entera: «trabajo remoto» arrastraba 15 documentos que solo dicen «trabajo».
  let total = 0
  const { items, variantesUsadas } = await conAlternativas(
    (t) =>
      (deps.buscar ?? suin.buscar)({ texto: t, coleccion, vigencia, sector, materia, desde, limite }).then((r) => {
        if (t === texto) {
          total = r.total
          return r.items
        }
        const terminos = terminosSignificativos(t)
        const validos = r.items.filter((d) => {
          const heno = sinTildes(`${d.titulo} ${d.epigrafe}`).toLowerCase()
          return terminos.every((x) => heno.includes(x))
        })
        if (!total) total = validos.length
        return validos
      }),
    texto,
    1,
  )
  const avisoAlternativa = variantesUsadas.length
    ? `La búsqueda de "${texto}" no rindió resultados; se usó «${variantesUsadas[0]}». Si no es lo que buscabas, ` +
      `no concluyas que el documento no existe.\n\n`
    : ''
  const que = coleccion === 'normas' ? 'documentos' : `providencias (${coleccion})`
  if (!total) {
    return vacio(
      `${que} en SUIN para "${texto}"`,
      'El buscador de SUIN indexa tipo, número, año, título, epígrafe, materia y entidad: no busca dentro del ' +
        'articulado. Para una norma concreta usa resolver_cita; un vacío no prueba que no exista: prueba ' +
        'buscar_por_tema.',
    )
  }
  if (!items.length) {
    return vacio(`${que} a partir de la posición ${desde}`, `La búsqueda reúne ${total}; pide un "desde" menor.`)
  }
  const fin = desde + items.length
  const normas = coleccion === 'normas'
  return (
    `${alcance([{ clave: 'suin', detalle: `${total} ${que}` }])}\n\n` +
    `${avisoAlternativa}${total} ${que} en SUIN-Juriscol; se muestran ${desde + 1}–${fin}.\n\n` +
    items
      .map(
        (d) =>
          `- ${d.titulo}${d.subtipo ? ` (${d.subtipo})` : ''}\n` +
          `  ${normas ? '' : 'Norma demandada: '}${d.epigrafe || '(sin dato)'}\n` +
          (normas
            ? `  Estado de vigencia (ficha SUIN): ${d.vigencia || '(sin dato en la ficha)'}${d.entidad ? ` · ${d.entidad}` : ''}\n`
            : d.entidad
              ? `  Ponente: ${d.entidad}\n`
              : '') +
          `  ${d.url}\n  Para leer: obtener_documento con fuente="suin", id="${d.id}"`,
      )
      .join('\n') +
    (fin < total ? `\n\nQuedan ${total - fin}: repite con desde=${fin}.` : '') +
    (normas
      ? '\n\nEl estado es el campo de la ficha de SUIN, copiado tal cual: "Vigencia en Estudio" no es "vigente", y ' +
        'un estado vacío es que la ficha no lo trae, no que la norma rija.'
      : '')
  )
}
