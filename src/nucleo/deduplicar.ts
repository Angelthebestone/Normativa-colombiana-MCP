/**
 * Deduplicación conservadora: conserva la primera entrada por clave normalizada
 * y cuenta las fusionadas. Las claves van sin tildes, en minúsculas y con los
 * espacios colapsados, para que "Ley 100 de 1993" y "LEY 100 DE 1993" (mismo
 * acto, dos enlaces del portal) sean la misma clave.
 */
import { sinTildes } from './parse.ts'

const normaliza = (s: string): string =>
  sinTildes(s)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Devuelve los items sin duplicados (primera ocurrencia gana) y el número de
 * entradas fusionadas. La clave se normaliza con `normalizaClave` si se pasa
 * como string, o con la función que se dé.
 */
export function deduplicar<T>(items: T[], claveFn: (item: T) => string): { items: T[]; duplicados: number } {
  const vistos = new Set<string>()
  const unicos: T[] = []
  let duplicados = 0
  for (const item of items) {
    const clave = normaliza(claveFn(item))
    if (!clave) {
      unicos.push(item) // sin clave no se puede deduplicar: se conserva
      continue
    }
    if (vistos.has(clave)) {
      duplicados++
      continue
    }
    vistos.add(clave)
    unicos.push(item)
  }
  return { items: unicos, duplicados }
}

/** Clave estándar de un acto sectorial: tipo|numero|anio normalizados. */
export const claveActo = (a: { tipo: string; numero: string; anio: string }): string =>
  `${a.tipo}|${a.numero}|${a.anio}`

/**
 * Coeficiente de Dice sobre multiconjuntos de fichas: 2·|A∩B| / (|A|+|B|). Dos
 * vacíos son iguales (1); uno vacío y otro no, nada en común (0). Lo comparten
 * la similitud de epígrafes (fichas = palabras) y la del diff de artículos
 * (fichas = bigramas de caracteres).
 */
export function dice(A: string[], B: string[]): number {
  if (!A.length && !B.length) return 1
  if (!A.length || !B.length) return 0
  const m = new Map<string, number>()
  for (const x of B) m.set(x, (m.get(x) ?? 0) + 1)
  let inter = 0
  for (const x of A) {
    const c = m.get(x) ?? 0
    if (c > 0) {
      inter++
      m.set(x, c - 1)
    }
  }
  return (2 * inter) / (A.length + B.length)
}

/** Similitud léxica simple (Dice sobre palabras, sin dependencias) para comparar epígrafes. */
export function similitudEpigrafes(a: string, b: string): number {
  const palabras = (s: string): string[] => normaliza(s).split(' ').filter(Boolean)
  return dice(palabras(a), palabras(b))
}
