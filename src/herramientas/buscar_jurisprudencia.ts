/**
 * `buscar_jurisprudencia`: sentencias y autos de la relatoría de la Corte
 * Constitucional. Reutiliza `buscar` de `fuentes/jurisprudencia/corte.ts`, que es
 * quien habla con la relatoría; aquí solo van el esquema y el texto de la respuesta.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { conAlternativas } from '../nucleo/alternativas.ts'
import { sinTildes } from '../nucleo/parse.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'

export const TITULO = 'Buscar jurisprudencia de la Corte Constitucional'

export const DESCRIPCION =
  'Sentencias y autos de la relatoría de la Corte Constitucional (44.839 providencias, con fallos de 2026 ' +
  'publicados el mismo año). Es la vía para jurisprudencia constitucional: el Gestor tiene muy poca. ' +
  'Devuelve sentencia, tipo, fecha, síntesis y la ruta para obtener_documento con fuente="corte". La ' +
  'relatoría no indexa frases largas: con varias palabras se reintenta con la más distintiva y la respuesta ' +
  'lo anuncia ("se buscó con el núcleo «X»"). Es la CORTE CONSTITUCIONAL: para la Suprema usa ' +
  'buscar_jurisprudencia_suprema; para el Consejo de Estado, buscar_jurisprudencia_consejo_estado.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  termino: z.string().describe('Obligatorio. Términos a buscar en la relatoría, ej. "teletrabajo"'),
  desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha inicial AAAA-MM-DD (por defecto 1992-01-01)'),
  hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha final AAAA-MM-DD'),
  tipos: z
    .preprocess(
      (v) => (Array.isArray(v) ? v.map(corte.normalizarTipo) : v),
      z.array(z.enum(['C', 'T', 'SU', 'A'])),
    )
    .optional()
    .describe(
      'Tipos a incluir; por defecto C, T y SU (doctrina). Los autos (A) son mayoría por volumen y suelen ser ' +
        'trámite: pídelos explícitamente. Se aceptan sus nombres: "tutela", "constitucionalidad", "unificacion", "auto".',
    ),
  limite: z.coerce.number().int().min(1).max(100).default(10).describe('Cuántas providencias mostrar (hasta 100)'),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ termino, desde, hasta, tipos, limite }: Params): Promise<string> {
  const porDefecto: ('C' | 'T' | 'SU')[] = ['C', 'T', 'SU']
  // Idea 5 — si el término rinde poco, se prueba sin tildes y con sinónimo,
  // y la variante usada se anuncia en la respuesta.
  const { items, variantesUsadas, resultado } = await conAlternativas(
    (t) => corte.buscar({ termino: t, desde, hasta, tipos: tipos ?? porDefecto, limite }),
    termino,
    1,
    (r) => r.items,
  )
  // La relatoría no indexa frases largas: si la consulta extensa no rindió,
  // el núcleo devuelve resultados reales. Se anuncia como el resto de variantes.
  const nucleo = resultado?.nucleo
  const r = { items, total: items.length, nota: undefined }
  const avisoAlternativa = variantesUsadas.length
    ? `La búsqueda exacta de "${termino}" no rindió resultados; se usó «${variantesUsadas[0]}». ` +
      `Verifica que sea lo que buscabas.\n\n`
    : nucleo && nucleo !== termino
      ? `La relatoría no indexa la frase completa; se buscó con el núcleo «${nucleo}». Verifica que sea lo que buscabas.\n\n`
      : ''
  if (!r.items.length) {
    return vacio(
      `providencias sobre "${termino}"`,
      'Prueba un término más general o revisa el rango de fechas.',
      alcance([{ clave: 'corte', detalle: '0 providencias' }]),
    )
  }
  // La pertinencia se mide contra lo que REALMENTE se buscó: si la relatoría
  // no indexó la frase y se usó el núcleo, es el núcleo el que debe aparecer
  // en tema/síntesis, no la frase completa (que nadie buscó como tal).
  const aguja = sinTildes(nucleo ?? termino).toLowerCase()
  const menciona = (p: (typeof r.items)[number]) =>
    sinTildes(`${p.tema} ${p.sintesis} ${p.sentencia}`).toLowerCase().includes(aguja)
  const flojas = r.items.filter((p) => !menciona(p)).map((p) => p.sentencia)
  const lista = r.items
    .map(
      (p) =>
        `- ${p.sentencia} (${p.tipo}, ${p.fecha})${menciona(p) ? '' : '  ⚠ no menciona el término'}\n  ${p.tema || '(sin tema)'}\n` +
        (p.sintesis ? `  Síntesis: ${p.sintesis.slice(0, 300)}${p.sintesis.length > 300 ? '…' : ''}\n` : '') +
        `  ruta: ${p.ruta}\n  ${p.url}`,
    )
    .join('\n')
  // La causa que se sugiere tiene que corresponder a lo que realmente se pidió:
  // culpar al filtro de fechas cuando no se envió ninguno manda a quien
  // consulta a quitar algo que no puso.
  const porFechas = Boolean(desde || hasta)
  const aviso = flojas.length
    ? `\n\nAtención: ${flojas.join(', ')} no mencionan "${nucleo ?? termino}" en su tema ni en su síntesis. ` +
      (porFechas
        ? `El buscador de la relatoría pierde precisión al acotar por fechas: prueba sin desde/hasta.`
        : `El buscador de la relatoría indexa el texto completo, así que devuelve providencias donde el término ` +
          `aparece de pasada. Prueba un término más específico${tipos?.length === 1 && tipos[0] === 'A' ? ', o sin restringir a autos, que suelen ser de trámite' : ''}.`)
    : ''
  return (
    `${alcance([{ clave: 'corte', detalle: `${r.items.length} providencia(s)` }])}\n\n` +
      `${avisoAlternativa}${r.total} providencia(s) coinciden; se muestran ${r.items.length}.\n\n${lista}${aviso}\n\n` +
      `Para el texto completo usa obtener_documento con fuente="corte" y la ruta.`
  )
}
