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
 * Abreviaturas jurídicas curadas → desarrollo. La clave va sin tildes y en
 * minúsculas; la expansión, tal como se escribe. Buscar "SMLMV" no debe ir a
 * ciegas: el desarrollo se prueba como término alternativo y se declara.
 */
export const ABREVIATURAS: Record<string, string> = {
  smlmv: 'salario mínimo legal mensual vigente',
  dur: 'decreto único reglamentario',
  cpc: 'código de procedimiento civil',
  cca: 'código contencioso administrativo',
  cpaca: 'código de procedimiento administrativo y de lo contencioso administrativo',
  cgp: 'código general del proceso',
  cp: 'código penal',
  cpt: 'código procesal del trabajo',
  cpl: 'código procesal laboral',
  cst: 'código sustantivo del trabajo',
  cps: 'código procesal penal',
  cet: 'contrato estatal de trabajo',
  cdi: 'convenio para evitar la doble imposición',
  iva: 'impuesto al valor agregado',
  rte: 'régimen tributario especial',
  pnr: 'programa de las naciones unidas para el desarrollo',
}

/**
 * Expansión de una abreviatura en un término. Devuelve la abreviatura exacta
 * que se desarrolló (para declararla) o `undefined` si ninguna palabra del
 * término es una abreviatura conocida: no se inventan expansiones.
 */
export function desarrollarAbreviaturas(termino: string): { abreviatura: string; desarrollo: string } | undefined {
  for (const p of termino.split(/\s+/)) {
    const limpia = p.replace(/[^\w]/g, '')
    if (!limpia) continue
    const desarrollo = ABREVIATURAS[sinTildes(limpia.toLowerCase())]
    if (desarrollo) return { abreviatura: p, desarrollo }
  }
  return undefined
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
  // Una abreviatura se desarrolla y la expansión se prueba también: buscar
  // "SMLMV" a secas no rinde en los portales, que guardan el texto desarrollado.
  const abreviatura = desarrollarAbreviaturas(termino)
  if (abreviatura && !variantes.includes(abreviatura.desarrollo)) variantes.push(abreviatura.desarrollo)

  const aItems = (r: T[] | R): T[] => (itemsDe && r instanceof Object && 'items' in (r as object) ? itemsDe(r as R) : (r as T[]))
  let mejores: T[] = []
  let conQue = termino
  let mejorResultado: R | undefined
  for (const v of variantes) {
    const r = await buscar(v)
    const its = aItems(r)
    // Se declara la variante que rindió y, cuando es una abreviatura, su
    // desarrollo: "buscando también SMLMV = salario mínimo legal mensual vigente".
    const declaracion = v === termino ? [] : [abreviatura && v === abreviatura.desarrollo ? `${v} = ${abreviatura.abreviatura}` : v]
    if (its.length >= umbral) return { items: its, variantesUsadas: declaracion, resultado: r as R }
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
