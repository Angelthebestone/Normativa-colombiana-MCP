/** Cita lista para pegar, con la lista de componentes que la fuente no dio. */
export type Cita = { cita: string; faltan: string[] }

/** "a, b y c": la enumeración de un abogado, con "y" antes del último. */
export const enumerar = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)!}`

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])

/**
 * SAMAI publica el ponente en versal ("PABLO ANDRÉS CÓRDOBA ACOSTA"). En un
 * memorial el nombre va como lo escribe una persona, así que se pasa a
 * capitalización de título, con las partículas internas en minúscula. Solo se
 * reescribe lo que venía EN VERSAL: un nombre ya capitalizado ("Jorge Ignacio
 * Pretelt Chaljub") se deja intacto, y nunca se añaden tildes que la fuente no
 * traiga.
 */
export function nombreEnTitulo(s: string): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (!t || !/[A-ZÁÉÍÓÚÑ]/.test(t) || t !== t.toUpperCase()) return t
  return t
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

/**
 * El radicado de SAMAI son 23 dígitos y su forma citable lleva guiones en
 * bloques 5-2-2-3-4-5-2. La segmentación no es un invento: el propio documento
 * imprime el radicado con guiones ("11001-03-26-000-2023-00093-00" para
 * 11001032600020230009300, medido el 2026-09-28 en el auto del 31-08-2023). Un
 * radicado que no tenga 23 dígitos se deja como venga: no se adivina.
 */
export function radicadoConGuiones(r: string): string {
  const d = (r ?? '').replace(/\s+/g, '')
  if (!/^\d{23}$/.test(d)) return d
  return `${d.slice(0, 5)}-${d.slice(5, 7)}-${d.slice(7, 9)}-${d.slice(9, 12)}-${d.slice(12, 16)}-${d.slice(16, 21)}-${d.slice(21)}`
}
