/**
 * Consulta normativa por nivel de autoridad: delega la búsqueda al Gestor
 * Normativo (constitución, ley, decreto, resolución, concepto) o a la relatoría
 * de la Corte Constitucional (jurisprudencia) y explica el carácter del nivel.
 */
import { z } from 'zod'
import { caracterDelNivel, NIVELES, tipoANivel, type Nivel } from '../jerarquia.ts'
import * as corte from '../fuentes/corte.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Consultar normativa por nivel de autoridad'

export const DESCRIPCION =
  'Busca normativa colombiana por nivel de autoridad (constitución, ley, decreto, resolución, ' +
  'concepto o jurisprudencia) y explica el carácter de cada nivel: vinculante, orientador o ' +
  'informativo. No es asesoría jurídica: verifica siempre en el enlace.'

export const schema = {
  nivel: z.enum(NIVELES).describe('Nivel de autoridad: constitución, ley, decreto, resolución, concepto o jurisprudencia'),
  texto: z.string().min(1).describe('Términos a buscar dentro del nivel, ej. "teletrabajo"'),
  limite: z.coerce.number().int().min(1).max(20).default(10),
}

/** El schema como ZodObject: de él se deriva el tipo de los parámetros resueltos. */
const schemaCompleto = z.object(schema)
type Parametros = z.infer<typeof schemaCompleto>

export type BuscadorNormas = (nivel: Nivel, texto: string, limite: number) => Promise<{ titulo: string; url: string }[]>

export function formatear(items: { titulo: string; url: string }[], nivel: Nivel, texto: string): string {
  if (!items.length) {
    return `No encontré nada de nivel ${nivel} para "${texto}" en las fuentes consultadas. Prueba otro término o usa buscar_por_tema.`
  }
  return (
    items.map((i) => `- ${i.titulo}\n  ${i.url}`).join('\n') +
    `\n\nCarácter: ${caracterDelNivel(nivel)}\n` +
    'Esto no es asesoría jurídica; verifica en el enlace antes de actuar.'
  )
}

async function porGestor(nivel: Nivel, texto: string, limite: number): Promise<{ titulo: string; url: string }[]> {
  const r = await gestor.buscar({ palabras: texto, tipo: tipoANivel(nivel) })
  return r.items.slice(0, limite).map((i) => ({ titulo: i.titulo, url: i.url }))
}

async function porCorte(texto: string, limite: number): Promise<{ titulo: string; url: string }[]> {
  const r = await corte.buscar({ termino: texto, limite })
  return r.items.map((i) => ({ titulo: `${i.sentencia} (${i.tipo}, ${i.fecha})`, url: i.url }))
}

/** La búsqueda es inyectable para probar el formateo sin red. */
export const buscar: BuscadorNormas = async (nivel, texto, limite) =>
  nivel === 'jurisprudencia' ? porCorte(texto, limite) : porGestor(nivel, texto, limite)

export async function escribir({ nivel, texto, limite }: Parametros): Promise<string> {
  return formatear(await buscar(nivel, texto, limite), nivel, texto)
}
