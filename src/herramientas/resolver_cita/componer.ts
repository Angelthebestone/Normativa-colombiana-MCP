import { alcance, type Uso } from '../../nucleo/alcance.ts'
import type { Resuelta } from './resuelta.ts'

/**
 * Línea de alcance de toda la respuesta: una fuente consultada para alguna cita
 * cuenta como consultada, porque la línea describe la respuesta entera y no
 * cada cita. El detalle se acumula: tres normas resueltas en el Gestor son
 * «norma resuelta ×3», no tres menciones del Gestor.
 */
function unirUsos(usos: Uso[]): Uso[] {
  const porClave = new Map<string, Map<string, number>>()
  for (const u of usos) {
    const detalles = porClave.get(u.clave) ?? new Map<string, number>()
    detalles.set(u.detalle ?? '', (detalles.get(u.detalle ?? '') ?? 0) + 1)
    porClave.set(u.clave, detalles)
  }
  return [...porClave].map(([clave, detalles]) => {
    const detalle = [...detalles]
      .filter(([d]) => d)
      .map(([d, n]) => (n > 1 ? `${d} ×${n}` : d))
      .join('; ')
    return detalle ? { clave, detalle } : { clave }
  })
}

/**
 * El bloque de una norma. Con una sola cita, el encabezado es la cita, como
 * siempre; con varias, el título oficial y la lista de citas, para que quien
 * pidió «art. 817 del Estatuto Tributario» reconozca la suya bajo «Decreto Ley
 * 624 de 1989». La ficha va una vez y los artículos en el orden pedido.
 */
function bloqueDeNorma(grupo: Resuelta[]): string {
  const p = grupo[0]!
  const cabecera =
    grupo.length === 1 ? `### ${p.cita}` : `### ${p.titulo ?? p.cita}\nCitas: ${grupo.map((g) => g.cita).join('; ')}`
  const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))]
  const articulos = unicos(grupo.flatMap((g) => g.articulos))
  const pie = unicos(grupo.flatMap((g) => g.pie ?? []))
  return (
    [cabecera, ...unicos(grupo.flatMap((g) => g.avisos)), p.ficha].join('\n') +
    articulos.map((a) => `\n\n${a}`).join('') +
    (pie.length ? `\n\n${pie.join('\n')}` : '')
  )
}

/**
 * El único compositor de `resolver_cita`: la cita suelta y el lote salen por
 * aquí, así que ambas vías dan la misma forma. Primero el alcance, una vez;
 * después un bloque por norma en el orden de su primera cita, y las citas que
 * no resolvieron, cada una en el suyo. `preambulo` son los avisos sobre los
 * parámetros, que se leen antes que los bloques.
 */
export function componer(piezas: Resuelta[], preambulo = ''): string {
  const grupos: Resuelta[][] = []
  const porClave = new Map<string, Resuelta[]>()
  for (const p of piezas) {
    const grupo = p.clave ? porClave.get(p.clave) : undefined
    if (grupo) {
      grupo.push(p)
      continue
    }
    const nuevo = [p]
    grupos.push(nuevo)
    if (p.clave) porClave.set(p.clave, nuevo)
  }
  return `${alcance(unirUsos(piezas.flatMap((p) => p.usos)))}\n\n${preambulo}${grupos.map(bloqueDeNorma).join('\n\n')}`
}
