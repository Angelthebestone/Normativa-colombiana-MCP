/**
 * Los códigos por su nombre.
 *
 * Nadie cita "Decreto 410 de 1971": cita el Código de Comercio. El parser de
 * `citas.ts` solo entiende tipo+número+año, así que la mitad de las consultas
 * reales de un abogado —"art. 191 del Código de Comercio"— no resolvían.
 *
 * Aquí vive la tabla y, con ella, lo que se sabe de la COBERTURA de cada
 * código: el Código Civil no está ni en el Gestor ni en el índice de SUIN, y
 * decir "no encontré la cita" ante "art. 946 del Código Civil" se lee como que
 * la norma no existe. Un código ausente se nombra como ausente.
 */
import { sinTildes } from './parse.ts'

export type Codigo = {
  /** Nombre canónico, como lo escribiría un abogado. */
  nombre: string
  /** Tipo/número/año de la norma que lo contiene, en la forma que entiende el Gestor. */
  tipo: string
  numero: string
  anio: string
  /** Formas con las que se cita. Se comparan sin tildes y en minúsculas. */
  alias: string[]
  /** Si la norma NO está en el corpus, por qué. Se dice en vez de "no encontré". */
  ausente?: string
}

/**
 * Los diez códigos que concentran el litigio. Las siglas solo entran cuando no
 * chocan con otra cosa: "CP" quedó fuera porque es a la vez Código Penal y
 * Constitución Política, y "C.C." porque es también la cédula de ciudadanía.
 */
export const CODIGOS: Codigo[] = [
  {
    nombre: 'Código Civil',
    tipo: 'ley',
    numero: '84',
    anio: '1873',
    alias: ['codigo civil', 'codigo civil colombiano', 'c. civil'],
    ausente:
      'El Código Civil (Ley 84 de 1873) NO está en este corpus: el Gestor Normativo no lo publica y el índice de ' +
      'SUIN empaquetado tampoco lo trae (comprobado el 2026-09-03 por las tres vías: por nombre, por "Ley 84 de ' +
      '1873" y por número+año). No es que el artículo no exista: es que esta instalación no puede leerlo. Quedan ' +
      'fuera de lo verificable aquí la acción reivindicatoria, la responsabilidad civil, la filiación, el divorcio ' +
      'y la prescripción ordinaria: consúltalos en la edición oficial del Código Civil, no en esta respuesta.',
  },
  {
    nombre: 'Código de Comercio',
    tipo: 'decreto',
    numero: '410',
    anio: '1971',
    alias: ['codigo de comercio', 'codigo del comercio', 'c. de co.'],
  },
  {
    nombre: 'Código Sustantivo del Trabajo',
    tipo: 'decreto',
    numero: '2663',
    anio: '1950',
    alias: ['codigo sustantivo del trabajo', 'codigo sustantivo de trabajo', 'cst'],
  },
  {
    nombre: 'Código Procesal del Trabajo y de la Seguridad Social',
    tipo: 'decreto',
    numero: '2158',
    anio: '1948',
    alias: [
      'codigo procesal del trabajo y de la seguridad social',
      'codigo procesal del trabajo',
      'codigo de procedimiento laboral',
      'cpts',
      'cpt',
    ],
  },
  {
    nombre: 'Código Penal',
    tipo: 'ley',
    numero: '599',
    anio: '2000',
    alias: ['codigo penal'],
  },
  {
    nombre: 'Código de Procedimiento Penal',
    tipo: 'ley',
    numero: '906',
    anio: '2004',
    alias: ['codigo de procedimiento penal', 'cpp'],
  },
  {
    nombre: 'Código General del Proceso',
    tipo: 'ley',
    numero: '1564',
    anio: '2012',
    alias: ['codigo general del proceso', 'cgp'],
  },
  {
    nombre: 'Código de Procedimiento Administrativo y de lo Contencioso Administrativo',
    tipo: 'ley',
    numero: '1437',
    anio: '2011',
    alias: ['codigo de procedimiento administrativo y de lo contencioso administrativo', 'cpaca'],
  },
  {
    nombre: 'Código de la Infancia y la Adolescencia',
    tipo: 'ley',
    numero: '1098',
    anio: '2006',
    alias: ['codigo de la infancia y la adolescencia', 'codigo de infancia y adolescencia'],
  },
  {
    nombre: 'Estatuto Tributario',
    tipo: 'decreto',
    numero: '624',
    anio: '1989',
    alias: ['estatuto tributario'],
  },
]

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Un solo regex con todos los alias, de más largo a más corto para que
 * "código de procedimiento penal" gane a "código penal" si alguna vez se
 * solapan. `\b` al final falla con los alias que terminan en punto ("c. de
 * co."), así que el cierre es opcional.
 */
const RE_ALIAS = new RegExp(
  `\\b(${CODIGOS.flatMap((c) => c.alias)
    .sort((a, b) => b.length - a.length)
    .map(escapar)
    .join('|')})(?![\\wáéíóúñ])`,
  'i',
)

const POR_ALIAS = new Map<string, Codigo>()
for (const c of CODIGOS) for (const a of c.alias) POR_ALIAS.set(a, c)

/**
 * Primer código nombrado en el texto, con la posición en la que aparece: quien
 * llama compara esa posición con la de una cita explícita para saber cuál de
 * las dos se está citando ("art. 217 del Código Civil, modificado por la Ley
 * 1060 de 2006" cita el Código; "art. 5 de la Ley 1060 de 2006" cita la ley).
 */
export function codigoCitado(texto: string): { codigo: Codigo; indice: number } | null {
  // `sinTildes` sustituye carácter a carácter, así que los índices del texto
  // normalizado son los del original y la posición sirve para comparar.
  const m = sinTildes(texto).toLowerCase().match(RE_ALIAS)
  if (!m || m.index === undefined) return null
  const codigo = POR_ALIAS.get(m[1]!.toLowerCase())
  return codigo ? { codigo, indice: m.index } : null
}

/** Cómo se cita la norma que contiene el código: "Decreto 410 de 1971". */
export const referencia = (c: Codigo): string =>
  `${c.tipo.charAt(0).toUpperCase()}${c.tipo.slice(1)} ${c.numero} de ${c.anio}`

/** El código que corresponde a un tipo/número/año, si es uno de los de la tabla. */
export const codigoDe = (tipo: string, numero: string, anio: string | undefined): Codigo | undefined =>
  CODIGOS.find(
    (c) => c.numero === numero && c.anio === anio && sinTildes(tipo).toLowerCase().includes(c.tipo),
  )

/** Los códigos que se sabe que NO están en el corpus, para declararlo sin consultar la red. */
export const codigosAusentes = (): Codigo[] => CODIGOS.filter((c) => c.ausente)
