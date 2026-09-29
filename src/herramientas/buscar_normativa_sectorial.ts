/** `buscar_normativa_sectorial`: el contrato común de los reguladores, una sola herramienta. */
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { vacio } from '../nucleo/vacio.ts'
// El esquema se evalúa al importar y `sectorial.ids()` sale del registro: sin
// este import por efecto, el enum de `entidad` queda VACÍO. Lo detectó el
// snapshot de `tools/list` al migrar esta herramienta desde `index.ts`, donde el
// orden lo garantizaba el propio fichero por casualidad.
import '../fuentes/sectorial/registro.ts'
import * as sectorial from '../fuentes/sectorial.ts'



export const TITULO = 'Buscar normativa de un regulador sectorial'

export const DESCRIPCION =
  'Actos administrativos —resoluciones, circulares, acuerdos— de los reguladores y ministerios sectoriales ' +
  'que el Gestor Normativo NO cataloga; elige cuál en `entidad`. CUÁNDO NO USARLA: para leyes y decretos ' +
  'nacionales de cualquier sector usa resolver_cita o buscar_por_tema, que dan texto completo y vigencia; el ' +
  'Decreto Único Reglamentario de cada sector (1071, 1072, 1074, 1076, 1079…) ya está en el Gestor.\n' +
  'Casi todas entregan PDF sin texto extraíble, y la mayoría no publica estado de vigencia; donde aparece ' +
  '(ANM, Supersociedades) es la fila del propio portal, no una verificación: para el estado real de una ley ' +
  'o un decreto, resolver_cita.\n' +
  'LOS FILTROS NO SE COMPORTAN IGUAL EN TODAS: el Invima exige texto o año; la Superfinanciera y la ' +
  'Supertransporte se quedan en el año en curso si no indicas otro; la ANM no aplica el año a las ' +
  'circulares. Cada respuesta dice qué hizo, pero no lo adivines: indica el año si lo esperabas.'

const esquema = z.object({
  entidad: z
    .enum(sectorial.ids() as [string, ...string[]])
    .describe('Regulador a consultar. Usa describir_fuentes para ver qué sector cubre cada uno.'),
  texto: z.string().optional().describe('Filtra por número, año o epígrafe'),
  anio: z.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos'),
  categoria: z
    .string()
    .optional()
    .describe('Tipo de acto o categoría (cada fuente declara cuáles soporta; solo Unidad de Víctimas lo filtra hoy)'),
  solo_entidad: z
    .boolean()
    .optional()
    .describe(
      'Solo INVIMA/Supersalud: excluye la compilación sectorial del normograma (leyes, decretos y sentencias) ' +
        'y deja solo los actos que la entidad expide (Resolución, Circular…).'
    ),
  pagina: z.coerce.number().int().min(1).default(1),
  limite: z.coerce.number().int().min(1).max(100).default(15),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ entidad, texto, anio, pagina, limite, categoria, solo_entidad }: Params): Promise<string> {
  const a = sectorial.adaptador(entidad)
  if (!a) return vacio(`un regulador llamado "${entidad}"`, `Disponibles: ${sectorial.ids().join(', ')}.`)

  const r = await a.buscar({ texto, anio, pagina, limite, categoria, ...(solo_entidad !== undefined ? { solo_entidad } : {}) })
  // Un parámetro mal usado que devuelve resultados SIN filtrar es el peor
  // desenlace: se lee «estos son los actos de esa categoría» y no lo son. El
  // adaptador que sí lo aplica lo dice en su nota (medido: solo Unidad para
  // las Víctimas); el que no, calla. Aquí se convierte ese silencio en aviso.
  const categoriaIgnorada =
    categoria && !/categor[íi]a consultada/i.test(r.nota ?? '')
      ? `\nAVISO: el filtro categoria="${categoria}" NO se aplicó: esta fuente no filtra por categoría (hoy solo ` +
        `lo hace Unidad para las Víctimas). Los actos que siguen NO están acotados por esa categoría.`
      : ''
  // La advertencia de la fuente viaja SIEMPRE, haya resultados o no: es lo que
  // impide que un vacío de un regulador se lea como que la norma no existe.
  // A partir de la segunda página se abrevia: paginar 480 resoluciones de 15 en
  // 15 repetía el párrafo entero 32 veces, y quien pagina ya lo leyó. En un
  // vacío y en la primera página va completa, que son los dos casos en que se
  // puede concluir de más.
  const fuente = `\n\nFuente: ${a.nombre} — ${a.portal}\nQué NO cubre: `
  const completo = `${fuente}${a.advertencia}`
  const cierre =
    pagina > 1 ? `${fuente}lo mismo que declaró la página 1 de esta consulta; pídela con pagina=1 para releerlo.` : completo

  if (!r.items.length) {
    return vacio(
      `actos de ${a.nombre}${texto ? ` que coincidan con "${texto}"` : ''}${anio ? ` de ${anio}` : ''}`,
      `${r.nota ? `${r.nota} ` : ''}Consultado: ${r.url}.${categoriaIgnorada}${completo}`
    )
  }

  // Parques lista dos veces la Ley 1333 de 2009 en la misma página, con fecha y
  // enlace distintos. Son dos filas reales de una página mantenida a mano, no un
  // duplicado nuestro, pero contarlas como dos normas es un error de quien lee.
  const repes = new Map<string, number>()
  for (const d of r.items) {
    const k = `${d.tipo} ${d.numero} de ${d.anio}`.toLowerCase()
    repes.set(k, (repes.get(k) ?? 0) + 1)
  }
  const dobles = [...repes].filter(([, n]) => n > 1).map(([k]) => k)

  return (
    `${alcance([{ clave: 'sectorial', detalle: `${a.nombre}: ${r.items.length} acto(s)` }])}\n\n` +
      `${r.items.length} acto(s) de ${a.nombre} (${a.sector})` +
      (r.total ? ` de ${r.total} que reúne el filtro` : '') +
      `.${r.nota ? `\n${r.nota}` : ''}${categoriaIgnorada}` +
      (dobles.length
        ? `\nEl portal repite en esta misma página ${dobles.length === 1 ? 'una entrada' : `${dobles.length} entradas`} ` +
          `(${dobles.join('; ')}), con fecha o enlace distintos. Son filas suyas, no copias nuestras: son menos ` +
          `normas de las que parecen.`
        : '') +
      `\n\n` +
      r.items
        .map(
          (d) =>
            `- ${d.tipo} ${d.numero}${d.anio ? ` de ${d.anio}` : ''}${d.fecha ? ` (${d.fecha})` : ''}\n` +
            `  ${d.epigrafe || '(sin epígrafe)'}\n` +
            (d.url ? `  ${d.url}` : '  (el portal no publicó enlace para este acto)')
        )
        .join('\n') +
      cierre
  )
}
