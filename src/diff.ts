/**
 * Diferencia entre dos versiones de un artículo: qué cambió y de qué clase.
 */
import { sinTildes } from './parse.ts'

type Clasificacion = 'plazo' | 'sancion' | 'excepcion' | 'sujeto' | 'no clasificado'

/**
 * Se evalúan en orden y gana la primera coincidencia: un plazo dentro de un
 * texto que además menciona una sanción sigue siendo, sobre todo, un plazo.
 */
const REGLAS: [Clasificacion, RegExp][] = [
  ['plazo', /\bdentro de (los|las)? ?\d+ (dias|meses|anos|semanas|horas)\b/],
  ['sancion', /(sancion|multa|amonestacion|comparendo)/],
  ['excepcion', /(excepto|salvo|no aplica|excepcion)/],
  ['sujeto', /(debera|esta obligado|le corresponde a)/],
]

export function clasificarDiferencia(fragmento: string): Clasificacion {
  const f = sinTildes(fragmento).toLowerCase()
  for (const [clase, re] of REGLAS) if (re.test(f)) return clase
  return 'no clasificado'
}

const lineas = (texto: string): string[] =>
  texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * LCS clásico con matriz (O(n·m), sin dependencias). Lo que está en el LCS se
 * conserva; el resto de `b` son añadidos y el resto de `a`, eliminados.
 */
export function diffArticulos(a: string, b: string): { anadidos: string[]; eliminados: string[] } {
  const A = lineas(a)
  const B = lineas(b)
  const n = A.length
  const m = B.length

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = A[i] === B[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }

  // Caminata por la matriz para saber qué líneas de cada lado quedan en el LCS.
  const lcsA = new Set<number>()
  const lcsB = new Set<number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      lcsA.add(i)
      lcsB.add(j)
      i++
      j++
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      i++ // A[i] sobra: queda como eliminado
    } else {
      j++ // B[j] sobra: queda como añadido
    }
  }

  const anadidos: string[] = []
  const eliminados: string[] = []
  for (let k = 0; k < m; k++) if (!lcsB.has(k)) anadidos.push(B[k]!)
  for (let k = 0; k < n; k++) if (!lcsA.has(k)) eliminados.push(A[k]!)
  return { anadidos, eliminados }
}
