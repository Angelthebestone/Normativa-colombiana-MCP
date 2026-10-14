import { sinTildes } from '../../../nucleo/parse.ts'

export type Providencia = {
  id: string
  sentencia: string
  tipo: string
  fecha: string
  publicacion: string
  tema: string
  sintesis: string
  magistrados: string[]
  expediente: string
  ruta: string
  url: string
}


/** C = constitucionalidad, T = tutela, SU = unificación, A = auto. */
export type TipoProvidencia = 'C' | 'T' | 'SU' | 'A'

/**
 * Cómo se llama en la práctica cada tipo de providencia: quien pide «tutela» o «auto»
 * no está equivocado, y rechazarlo con un error de esquema (o, peor, pasarlo al
 * portal tal cual) es un fallo evitable. Lo desconocido se deja tal cual para que el
 * esquema lo rechace listando los valores válidos.
 */
const SINONIMOS_TIPO: Record<string, TipoProvidencia> = {
  c: 'C',
  constitucionalidad: 'C',
  't': 'T',
  tutela: 'T',
  tutelas: 'T',
  su: 'SU',
  unificacion: 'SU',
  'sentencia de unificacion': 'SU',
  a: 'A',
  auto: 'A',
  autos: 'A',
}

export const normalizarTipo = (v: unknown): unknown =>
  typeof v === 'string' ? (SINONIMOS_TIPO[sinTildes(v).toLowerCase().trim()] ?? v) : v

export const prefijo = (p: Providencia): string =>
  (p.sentencia.match(/^\s*(SU|C|T|A)\b/i)?.[1] ?? '').toUpperCase()
