/**
 * Palabras vacías del español para filtrar términos de búsqueda y consulta.
 * La comparación ignora tildes y mayúsculas, porque las consultas llegan sin
 * ellas y los portales indexan sin ellas.
 */
import { sinTildes } from './parse.ts'

export const STOPWORDS_ES: ReadonlySet<string> = new Set([
  // artículos
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  // contracciones
  'al', 'del',
  // preposiciones
  'a', 'ante', 'bajo', 'con', 'contra', 'de', 'desde', 'durante', 'en', 'entre',
  'hacia', 'hasta', 'mediante', 'para', 'por', 'según', 'sin', 'sobre', 'tras',
  // conjunciones
  'e', 'o', 'u', 'y', 'ni', 'que', 'como', 'cuando', 'donde', 'mientras', 'aunque', 'pero', 'sino',
  // pronombres átonos y relativos
  'me', 'te', 'se', 'nos', 'os', 'lo', 'le', 'les', 'cual', 'cuales', 'quien', 'quienes',
  // demostrativos
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella', 'aquellos',
  'aquellas',
  // posesivos átonos
  'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'nuestro', 'nuestra', 'vuestro',
  // indefinidos frecuentes
  'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'mismos', 'mismas', 'cada', 'todo', 'toda',
  'todos', 'todas',
  // adverbios frecuentes
  'no', 'si', 'ya', 'mas', 'menos', 'muy', 'también', 'solo', 'aun', 'así',
  // verbos auxiliares comunes
  'es', 'son', 'fue', 'era', 'ser', 'será', 'estar', 'está', 'están', 'han', 'ha', 'he', 'haber',
  'había', 'habrá', 'hay', 'hubo',
])

/** `true` si `t` es una palabra vacía, comparando sin tildes y en minúsculas. */
export const esStopword = (t: string): boolean => STOPWORDS_ES.has(sinTildes(t).toLowerCase())

/** Devuelve los tokens que no son palabras vacías, en su forma original. */
export function filtrarStopwords(tokens: string[]): string[] {
  return tokens.filter((t) => !esStopword(t))
}
