/**
 * Las claves de fuente que aceptan `describir_fuentes` y `buscar_normativa_sectorial`.
 *
 * Vive aparte porque la lista se arma en parte desde el registro sectorial, y
 * quien la use tiene que encontrarla ya completa: por eso este módulo importa
 * `registro.ts` por su efecto, en vez de confiar en que lo haya hecho antes
 * quien lo importa. Antes el orden lo garantizaba `index.ts` por casualidad.
 */
import '../fuentes/sectorial/registro.ts'
import * as sectorial from '../fuentes/sectorial.ts'

/**
 * Las claves de `describir_fuentes.fuente`. Los ids de los reguladores salen
 * del registro sectorial para que el catálogo no se duplique en el esquema; los
 * tres alias cortos existen porque el nombre largo de las cortes se escribe de
 * forma natural sin el apellido, y antes se resolvían por coincidencia parcial.
 */
export const ALIAS_FUENTES: Record<string, string> = {
  corte: 'corte-constitucional',
  suprema: 'corte-suprema',
  consejo: 'consejo-de-estado',
}
/** De la clave larga de describir_fuentes a la de FUENTES y la línea de alcance. */
export const ALIAS_INVERSO = Object.fromEntries(Object.entries(ALIAS_FUENTES).map(([k, v]) => [v, k]))
export const CLAVES_FUENTES = [
  'gestor',
  'corte-constitucional',
  'corte-suprema',
  'consejo-de-estado',
  'dian',
  'suin',
  'senado',
  'diario',
  'creg',
  'anh',
  'upme',
  'anla',
  ...sectorial.ids(),
  ...Object.keys(ALIAS_FUENTES),
] as [string, ...string[]]
