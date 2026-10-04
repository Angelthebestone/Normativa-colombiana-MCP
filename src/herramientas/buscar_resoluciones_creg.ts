/**
 * `buscar_resoluciones_creg`: resoluciones de la Comisión de Regulación de
 * Energía y Gas. Es la única fuente sectorial cuyo texto se puede leer aquí y la
 * única que publica una señal de vigencia, en compilaciones separadas de no
 * derogadas y derogadas; esa señal se traslada literal.
 *
 * Reutiliza `buscar` de `fuentes/creg.ts`, que es quien habla con el portal.
 * Aquí solo va el esquema y el texto de la respuesta.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as creg from '../fuentes/creg.ts'

export const TITULO = 'Buscar resoluciones de la CREG (energía y gas)'

export const DESCRIPCION =
  'Resoluciones de la Comisión de Regulación de Energía y Gas: tarifas, conexión, comercialización, plantas ' +
  'solares y gas natural. Devuelve número, año, epígrafe, el estado según la compilación y la ruta para leer ' +
  'el texto con obtener_documento (fuente="creg"): es la ÚNICA fuente sectorial con texto legible aquí. ' +
  'Cada consulta recorre UNA compilación de UN año: texto filtra dentro de ese año (por número, año o ' +
  'epígrafe, nunca por el contenido), así que para una resolución antigua pasa anio aunque ya pongas su ' +
  'número en texto; "todas" junta vigentes y derogadas de ese mismo año. La señal de vigencia se traslada ' +
  'literal, no la conviertas en un sí o un no. Para la UPME usa buscar_normativa_upme; para leyes o ' +
  'decretos nacionales, resolver_cita.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  texto: z.string().optional().describe('Filtra por número, año o epígrafe. Ej.: "solar", "gas natural", "101-104"'),
  compilacion: z
    .enum(['vigentes', 'derogadas', 'todas'])
    .default('vigentes')
    .describe('"vigentes" = las que la CREG lista como no derogadas expresamente ni anuladas'),
  anio: z
    .string()
    .regex(/^\d{4}$/)
    .optional()
    .describe('Año de cuatro dígitos, desde 1994. SIN ÉL solo se mira el año en curso, que trae muy pocas.'),
  limite: z.coerce.number().int().min(1).max(50).default(15).describe('Cuántas resoluciones mostrar (hasta 50)'),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ texto, compilacion, anio, limite }: Params): Promise<string> {
  const r = await creg.buscar(compilacion, texto, limite, anio)
  if (!r.items.length) {
    return vacio(
      `resoluciones de la CREG${texto ? ` que coincidan con "${texto}"` : ''} en la compilación "${compilacion}"` +
        ` del año ${anio ?? new Date().getFullYear()}`,
      'La CREG publica una compilación POR AÑO y sin el parámetro anio solo se mira el año en curso, que apenas ' +
        'trae unas decenas. Repite indicando el año (desde 1994). La búsqueda es sobre número, año y epígrafe: ' +
        'la CREG no ofrece búsqueda dentro del texto.',
      alcance([{ clave: 'creg', detalle: '0 resoluciones' }]),
    )
  }
  return (
    `${alcance([{ clave: 'creg', detalle: `${r.items.length} resolución(es)` }])}\n\n` +
    `${r.total} resolución(es) en la compilación "${compilacion}" de la CREG (${r.pagina}); ` +
    `se muestran ${r.items.length}.\n\n` +
    r.items
      .map(
        (x) =>
          `- Resolución CREG ${x.numero} de ${x.anio}\n` +
          `  ${x.epigrafe || '(sin epígrafe)'}\n` +
          `  Estado: ${x.estadoSegunCompilacion}\n` +
          `  Texto completo: obtener_documento con fuente="creg" y ruta="${x.ruta}"`,
      )
      .join('\n') +
    `\n\nEse "Estado" es la clasificación de la propia compilación de la CREG, no un campo de vigencia por norma: ` +
    `dilo como lo que es y verifica en el texto si el aparte que te interesa sigue rigiendo.` +
    (anio ? '' : `\nSe consultó solo el año en curso: indica anio para buscar en años anteriores.`)
  )
}
