import { readFileSync } from 'node:fs'

import { sinTildes } from './parse.ts'

// --- índice temático empaquetado -----------------------------------------

// El título solo viene en las ocho primeras normas de cada fila; ver
// scripts/generar-indice.ts. Los ids están todos.
export type Indice = { generado: string; filas: { t: string; s: string; ts: string; n: [string, string?][] }[] }
let indice: Indice | null | undefined

export function cargarIndice(): Indice | null {
  if (indice !== undefined) return indice
  try {
    // El bundle vive en server/index.js y el índice en datos/, junto al manifiesto.
    indice = JSON.parse(readFileSync(new URL('../datos/indice-tematico.json', import.meta.url), 'utf8')) as Indice
  } catch {
    indice = null // sin índice se consulta el portal; no es un fallo fatal
  }
  return indice
}

/**
 * Par tema/subtema del índice que mejor case con el término. Entre varios se
 * prefiere el que agrupa más normas: "teletrabajo" existe como tema propio con
 * 1 documento y como subtema de EMPLEO con 55, y el útil es el segundo.
 */
export function temaDelIndice(termino: string): { t: string; s: string } | null {
  const idx = cargarIndice()
  const q = sinTildes(termino).toLowerCase().trim()
  if (!idx || !q) return null
  const candidatas = idx.filas.filter((f) => sinTildes(f.s).toLowerCase().includes(q))
  if (!candidatas.length) return null
  const exacta = candidatas.filter((f) => sinTildes(f.s).toLowerCase() === q)
  return (exacta.length ? exacta : candidatas).sort((a, b) => b.n.length - a.n.length)[0] ?? null
}

export function frescura(generado: string): string {
  const meses = (Date.now() - Date.parse(generado)) / (30 * 24 * 3600 * 1000)
  return meses > 3
    ? `\n\nAVISO: el índice temático empaquetado se generó el ${generado} (hace ~${Math.round(meses)} meses). Puede faltar normativa reciente; actualiza la extensión.`
    : ''
}
