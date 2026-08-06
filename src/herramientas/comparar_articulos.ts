/**
 * Compara el texto de un artículo entre dos normas: quién lo añadió, quién lo
 * eliminó, y una clasificación por patrones de cada diferencia.
 */
import { z } from 'zod'

import { clasificarDiferencia, diffArticulos } from '../diff.ts'
import { idTipo, parsearCita } from '../citas.ts'
import { articulo as extraerArticulo } from '../parse.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Comparar dos artículos de normas distintas'

export const DESCRIPCION =
  'Compara el texto de un artículo entre dos normas, marca lo añadido y lo eliminado, y clasifica cada ' +
  'diferencia por patrones de texto (plazo, sanción, excepción, sujeto obligado); lo que no encaja se marca ' +
  '«revisar manualmente». La clasificación no es un análisis semántico.'

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
  'La clasificación es por patrones de texto, no es un análisis semántico: lo marcado como «no clasificado» hay que revisarlo manualmente.'

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
  return { articulo: { texto, url: n.url, titulo: n.titulo }, nota: '' }
}

/**
 * Formatea el resultado de una comparación: una línea por diferencia (con su
 * clasificación por patrones), los enlaces de ambas normas y el cierre fijo.
 */
export function formatear(
  comparacion: { anadidos: string[]; eliminados: string[] },
  a: { titulo: string; url: string },
  b: { titulo: string; url: string },
): string {
  const lineas: string[] = []
  for (const f of comparacion.anadidos) lineas.push(`AÑADIDO en ${b.titulo} — ${clasificarDiferencia(f)}: «${f}»`)
  for (const f of comparacion.eliminados) lineas.push(`ELIMINADO de ${a.titulo} — ${clasificarDiferencia(f)}: «${f}»`)
  if (!lineas.length) lineas.push('Los dos artículos son textualmente iguales.')
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
