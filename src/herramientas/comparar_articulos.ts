/**
 * Compara el texto de un artículo entre dos normas: quién lo añadió, quién lo
 * eliminó, y una clasificación por patrones de cada diferencia.
 *
 * Con `con_reforma=true` responde otra pregunta en una sola llamada: qué cambió
 * el artículo N con su última reforma anotada. Localiza la reforma más reciente
 * que el portal anota sobre el artículo, descarga la norma modificadora y
 * contrasta SU artículo con el texto vigente.
 *
 * Medido el 2026-09-28 contra el Gestor (Ley 909 arts. 2 y 31, CST arts. 23 y 64,
 * Ley 1437 art. 20): la página de una norma CONSOLIDA —publica el texto vigente
 * del artículo, no la redacción anterior—, así que la comparación no es «antes
 * contra después» sino «lo que dispuso la reforma contra lo que la página
 * publica hoy». El texto que trae la norma modificadora puede ser completo
 * (Ley 50 de 1990 art. 1 sobre el CST art. 23) o solo de la parte que toca
 * (Ley 1960 de 2019 art. 6: «el numeral 4»), y de esa distinción depende que el
 * diff sea legible o engañoso; el modo lo declara en cada caso.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { agruparEditoriales, clasificarDiferencia, diffArticulos } from './diff.ts'
import { parsearCita } from '../nucleo/citas.ts'
import { estricto, numeroDeArticulo } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { articuloDe, type Deps } from './comparar_articulos/norma.ts'
import { conReforma } from './comparar_articulos/reforma.ts'

export const TITULO = 'Comparar dos artículos de normas distintas'

export const DESCRIPCION =
  'Compara el texto de un artículo entre dos normas y marca lo añadido y lo eliminado. Clasifica cada ' +
  'diferencia por patrones de texto (plazo, sanción, excepción, sujeto obligado, prohibición u obligación) y ' +
  'detecta cambios editoriales por similitud léxica (Dice bigramas, ≥0,92); lo que no encaja se marca ' +
  '«revisar manualmente». Sin modelo semántico. Con con_reforma=true no hace falta la segunda norma: busca la ' +
  'última reforma que el portal anota al artículo, extrae el artículo de la norma modificadora y lo contrasta ' +
  'con el texto vigente, porque la página consolida y no publica la redacción anterior. Para ver todas las ' +
  'reformas de la norma usa historial_norma; para reunir evidencia de un conflicto entre dos normas enteras, ' +
  'analizar_conflicto.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  norma_a: z.string().describe('Cita de la norma base, ej. "Ley 909 de 2004"'),
  articulo_a: z.preprocess(numeroDeArticulo, z.string()).describe('Número del artículo de la norma base, ej. "31"'),
  norma_b: z
    .string()
    .optional()
    .describe('Cita de la segunda norma, ej. "Decreto 1083 de 2015"; no se usa con con_reforma=true'),
  articulo_b: z.preprocess(numeroDeArticulo, z.string().optional()).describe('Número de artículo de la segunda norma; no se usa con con_reforma=true'),
  con_reforma: z
    .boolean()
    .default(false)
    .describe('true: compara el artículo contra la última reforma que el portal le anota (no pidas norma_b)'),
})

/** Shape plano que consume el SDK; los parámetros se infieren del objeto completo. */
export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>


const CIERRE =
  'Los cambios «editorial» son léxicos (Dice ≥0,92, sin modelo semántico): «multa»→«sanción pecuniaria» no se detecta como tal y queda en «no clasificado» para revisión manual. Igual con la sinonimia de cumplimiento: «queda prohibido»→«se prohíbe» puede no reconocerse si la redacción no casa con los patrones.'


/**
 * Formatea el resultado de una comparación: empareja cambios editoriales por
 * similitud léxica y lista el resto como añadido/eliminado con su patrón.
 */
export function formatear(
  comparacion: { anadidos: string[]; eliminados: string[] },
  a: { titulo: string; url: string },
  b: { titulo: string; url: string },
): string {
  const { editoriales, anadidos, eliminados } = agruparEditoriales(comparacion.anadidos, comparacion.eliminados)
  const lineas: string[] = []
  for (const e of editoriales)
    lineas.push(`EDITORIAL — «${e.de}» → «${e.a}» (sim. ${e.sim.toFixed(2)}, cambio menor)`)
  for (const f of anadidos) lineas.push(`AÑADIDO en ${b.titulo} — ${clasificarDiferencia(f)}: «${f}»`)
  for (const f of eliminados) lineas.push(`ELIMINADO de ${a.titulo} — ${clasificarDiferencia(f)}: «${f}»`)
  if (!lineas.length && !editoriales.length) lineas.push('Los dos artículos son textualmente iguales.')
  lineas.push('', `- ${a.titulo}: ${a.url}`, `- ${b.titulo}: ${b.url}`)
  lineas.push('', CIERRE)
  return lineas.join('\n')
}

/**
 * Compara el texto de un artículo entre dos normas citadas y devuelve las
 * diferencias. Si un lado no se encuentra, se nota y se continúa con el otro.
 * Con `con_reforma=true`, compara contra la última reforma anotada del artículo.
 */
export async function escribir(params: Params, deps: Deps = {}): Promise<string> {
  const { norma_a, articulo_a, norma_b, articulo_b, con_reforma } = params
  if (con_reforma) {
    if (norma_b || articulo_b) {
      return (
        'Con con_reforma=true sobran norma_b y articulo_b: la norma modificadora sale de las notas que el portal ' +
        'anota sobre el artículo. Quítalos para comparar contra la última reforma, o pon con_reforma=false para ' +
        'comparar dos normas distintas.'
      )
    }
    return conReforma(norma_a, articulo_a, deps)
  }
  if (!norma_b || !articulo_b) {
    return (
      'Para comparar dos artículos hacen falta norma_b y articulo_b, por ejemplo "Decreto 1083 de 2015" y "12". ' +
      'Para comparar el artículo con la última reforma que el portal le anota, usa con_reforma=true sin norma_b.'
    )
  }
  const A = await articuloDe(norma_a, articulo_a, deps)
  const B = await articuloDe(norma_b, articulo_b, deps)
  // Solo se consulta el Gestor, y solo por las citas interpretables: dos citas
  // ilegibles no llegan a tocar la red y por eso no se declaran.
  const citas = [norma_a, norma_b].filter((c) => parsearCita(c)).length
  const cabecera = citas
    ? alcance([{ clave: 'gestor', detalle: `${citas} cita(s)` }])
    : 'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).'
  const notas = [A.nota, B.nota].filter(Boolean)
  if (A.articulo.texto === null || B.articulo.texto === null) {
    const lineas = [...notas]
    if (A.articulo.url) lineas.push(`- ${A.articulo.titulo}: ${A.articulo.url}`)
    if (B.articulo.url) lineas.push(`- ${B.articulo.titulo}: ${B.articulo.url}`)
    lineas.push('', CIERRE)
    return `${cabecera}\n\n${lineas.join('\n')}`
  }
  return `${cabecera}\n\n${[...notas, formatear(diffArticulos(A.articulo.texto, B.articulo.texto), A.articulo, B.articulo)].join('\n')}`
}
