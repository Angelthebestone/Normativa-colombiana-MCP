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
export async function conAlternativas<T>(
  buscar: (termino: string) => Promise<T[]>,
  termino: string,
  umbral: number,
): Promise<{ items: T[]; variantesUsadas: string[] }> {
  const variantes: string[] = [termino]
  const sinTildesTermino = sinTildes(termino)
  if (sinTildesTermino !== termino) variantes.push(sinTildesTermino)
  const sinonimo = TESAURO[sinTildesTermino.toLowerCase()]?.[0]
  if (sinonimo && !variantes.includes(sinonimo)) variantes.push(sinonimo)

  let mejores: T[] = []
  let conQue = termino
  for (const v of variantes) {
    const r = await buscar(v)
    if (r.length >= umbral) return { items: r, variantesUsadas: v === termino ? [] : [v] }
    if (r.length > mejores.length) {
      mejores = r
      conQue = v
    }
  }
  return { items: mejores, variantesUsadas: conQue === termino ? [] : [conQue] }
}
