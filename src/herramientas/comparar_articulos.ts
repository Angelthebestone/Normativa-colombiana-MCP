/**
 * Compara el texto de un artículo entre dos normas: quién lo añadió, quién lo
 * eliminó, y una clasificación por patrones de cada diferencia.
 */
import { z } from 'zod'

import { agruparEditoriales, clasificarDiferencia, diffArticulos } from '../diff.ts'
import { idTipo, parsearCita, candidatosAmbiguos } from '../citas.ts'
import { articulo as extraerArticulo, limpiarArticulo } from '../parse.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Comparar dos artículos de normas distintas'

export const DESCRIPCION =
  'Compara el texto de un artículo entre dos normas, marca lo añadido y lo eliminado, clasifica cada ' +
  'diferencia por patrones de texto (plazo, sanción, excepción, sujeto obligado) y detecta cambios ' +
  'editoriales por similitud léxica (Dice bigramas, ≥0,92); lo que no encaja se marca «revisar manualmente». ' +
  'Sin modelo semántico.'

const esquema = z.object({
  norma_a: z.string().describe('Cita de la primera norma, ej. "Ley 909 de 2004"'),
  articulo_a: z.string().describe('Número de artículo de la primera norma, ej. "12"'),
  norma_b: z.string().describe('Cita de la segunda norma, ej. "Decreto 1083 de 2015"'),
  articulo_b: z.string().describe('Número de artículo de la segunda norma, ej. "12"'),
})

/** Shape plano que consume el SDK; los parámetros se infieren del objeto completo. */
export const schema = esquema.shape

type Params = z.infer<typeof esquema>

type Articulo = { texto: string | null; url: string; titulo: string }

const CIERRE =
  'Los cambios «editorial» son léxicos (Dice ≥0,92, sin modelo semántico): «multa»→«sanción pecuniaria» no se detecta como tal y queda en «no clasificado» para revisión manual.'

/**
 * Trae el texto de un artículo de una norma citada. Si la cita o el artículo
 * no se encuentran, devuelve el lado con texto null y una nota clara.
 */
async function articuloDe(cita: string, numero: string): Promise<{ articulo: Articulo; nota: string }> {
  const c = parsearCita(cita)
  if (!c) {
    return {
      articulo: { texto: null, url: '', titulo: '' },
      nota: `No reconocí la cita «${cita}» como una norma del Gestor Normativo.`,
    }
  }
  const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return {
        articulo: { texto: null, url: '', titulo: '' },
        nota: `La cita «${cita}» es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años distintos. Repite con el año, por ejemplo «${ambiguos[0]!.titulo}».`,
      }
    }
  }
  const primero = r.items[0]
  if (!primero) {
    return { articulo: { texto: null, url: '', titulo: '' }, nota: `No encontré la norma «${cita}» en el Gestor Normativo.` }
  }
  const n = await gestor.obtenerNorma(primero.id)
  const texto = extraerArticulo(n.texto, numero)
  if (texto === null) {
    return {
      articulo: { texto: null, url: n.url, titulo: n.titulo },
      nota: `No encontré el artículo ${numero} en «${n.titulo}» (${n.url}).`,
    }
  }
  // Se compara el texto sustantivo, sin las notas entre paréntesis que el
  // portal incrusta (reformas, "Ver sentencia"): son ruido editorial, no contenido.
  return { articulo: { texto: limpiarArticulo(texto), url: n.url, titulo: n.titulo }, nota: '' }
}

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
 */
export async function escribir(params: Params): Promise<string> {
  const { norma_a, articulo_a, norma_b, articulo_b } = params
  const A = await articuloDe(norma_a, articulo_a)
  const B = await articuloDe(norma_b, articulo_b)
  const notas = [A.nota, B.nota].filter(Boolean)
  if (A.articulo.texto === null || B.articulo.texto === null) {
    const lineas = [...notas]
    if (A.articulo.url) lineas.push(`- ${A.articulo.titulo}: ${A.articulo.url}`)
    if (B.articulo.url) lineas.push(`- ${B.articulo.titulo}: ${B.articulo.url}`)
    lineas.push('', CIERRE)
    return lineas.join('\n')
  }
  return [...notas, formatear(diffArticulos(A.articulo.texto, B.articulo.texto), A.articulo, B.articulo)].join('\n')
}
