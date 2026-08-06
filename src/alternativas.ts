import { sinTildes } from './parse.ts'

/** Sinónimos jurídicos curados, claves normalizadas (minúsculas y sin tildes). */
export const TESAURO: Record<string, string[]> = {
  cesantias: ['auxilio de cesantía'],
  teletrabajo: ['trabajo remoto'],
  despido: ['terminación del contrato'],
  retencion: ['retención en la fuente'],
  iva: ['impuesto al valor agregado'],
  pension: ['pensión de vejez'],
  salud: ['sistema general de seguridad social en salud'],
  contratacion: ['contratación estatal'],
  licencia: ['licencia ambiental'],
  vigencia: ['vigencia fiscal'],
  jornada: ['jornada de trabajo'],
  salario: ['salario mínimo legal mensual vigente'],
  arbitraje: ['laudo arbitral'],
  estabilidad: ['fuero de estabilidad laboral'],
  presupuesto: ['presupuesto general de la nación'],
}

/**
 * Reintenta una búsqueda que rinde poco: primero sin tildes y luego con el
 * primer sinónimo del tesauro. Cada variante usada se declara en
 * variantesUsadas; nunca se ejecuta una búsqueda alternativa en silencio.
 */
export async function conAlternativas<T, R = T[]>(
  buscar: (termino: string) => Promise<T[] | R>,
  termino: string,
  umbral: number,
  /** Devuelve los "items" (para medir el umbral) desde un resultado compuesto. */
  itemsDe?: (r: R) => T[],
): Promise<{ items: T[]; variantesUsadas: string[]; resultado?: R }> {
  const variantes: string[] = [termino]
  const sinTildesTermino = sinTildes(termino)
  if (sinTildesTermino !== termino) variantes.push(sinTildesTermino)
  const sinonimo = TESAURO[sinTildesTermino.toLowerCase()]?.[0]
  if (sinonimo && !variantes.includes(sinonimo)) variantes.push(sinonimo)

  const aItems = (r: T[] | R): T[] => (itemsDe && r instanceof Object && 'items' in (r as object) ? itemsDe(r as R) : (r as T[]))
  let mejores: T[] = []
  let conQue = termino
  let mejorResultado: R | undefined
  for (const v of variantes) {
    const r = await buscar(v)
    const its = aItems(r)
    if (its.length >= umbral) return { items: its, variantesUsadas: v === termino ? [] : [v], resultado: r as R }
    // La primera variante (la original) puede traer metadatos útiles —como el
    // `nucleo` que la relatoría usó— incluso cuando rinde 0. Se conservan.
    if (v === termino || its.length > mejores.length) {
      mejores = its
      conQue = v
      mejorResultado = r as R
    }
  }
  return { items: mejores, variantesUsadas: conQue === termino ? [] : [conQue], ...(mejorResultado !== undefined ? { resultado: mejorResultado } : {}) }
}
