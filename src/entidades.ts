/**
 * Alias de entidades oficiales colombianas: un nombre corto o sigla con el que
 * se pide algo se resuelve al nombre que el catálogo del Gestor Normativo
 * entiende (los nombres largos "legales" el portal los rechaza: "Unidad
 * Administrativa Especial Dirección de Impuestos y Aduanas Nacionales" no
 * aparece en su catálogo, mientras que "Ministerio del Trabajo" sí).
 */
import { sinTildes } from './parse.ts'

export const ALIASES: Record<string, string> = {
  // Los que el catálogo del Gestor tiene con ese nombre exacto.
  mintrabajo: 'Ministerio del Trabajo',
  minhacienda: 'Ministerio de Hacienda y Crédito Público',
  'funcion publica': 'Departamento Administrativo de la Función Pública',
  dafp: 'Departamento Administrativo de la Función Pública',
  minambiente: 'Ministerio de Ambiente y Desarrollo Sostenible',
  minminas: 'Ministerio de Minas y Energía',
  minenergia: 'Ministerio de Minas y Energía',
  mintransporte: 'Ministerio de Transporte',
  minagricultura: 'Ministerio de Agricultura y Desarrollo Rural',
  minjusticia: 'Ministerio de Justicia y del Derecho',
  minsalud: 'Ministerio de Salud y Protección Social',
  mineducacion: 'Ministerio de Educación Nacional',
  mintic: 'Ministerio de Tecnologías de la Información y las Comunicaciones',
  dnp: 'Departamento Nacional de Planeación',
  sena: 'Servicio Nacional de Aprendizaje',
  icbf: 'Instituto Colombiano de Bienestar Familiar',
  // Cortes y reguladores: no los usa el filtro del Gestor, pero se resuelven
  // para anunciar el nombre oficial en las respuestas (describir_fuentes).
  csj: 'Corte Suprema de Justicia',
  'c. suprema': 'Corte Suprema de Justicia',
  'corte suprema': 'Corte Suprema de Justicia',
  'corte constitucional': 'Corte Constitucional',
  cc: 'Corte Constitucional',
  'consejo de estado': 'Consejo de Estado',
  ce: 'Consejo de Estado',
  sic: 'Superintendencia de Industria y Comercio',
  supersociedades: 'Superintendencia de Sociedades',
  upme: 'Unidad de Planeación Minero Energética',
  creg: 'Comisión de Regulación de Energía y Gas',
  anh: 'Agencia Nacional de Hidrocarburos',
  anla: 'Autoridad Nacional de Licencias Ambientales',
  invima: 'Instituto Nacional de Vigilancia de Medicamentos y Alimentos',
  cra: 'Comisión de Regulación de Agua Potable y Saneamiento Básico',
}

/** Nombres que el catálogo del Gestor NO reconoce: no deben inyectarse en buscar_normas. */
export const NO_EN_GESTOR = new Set([
  'dian',
  'superfinanciera',
  'supersalud',
  'superservicios',
  'crc',
  'cra',
])

/** Índice de ALIASES normalizado (sin tildes, minúsculas), construido una sola vez. */
const ALIASES_NORM: Record<string, string> = {}
for (const [alias, oficial] of Object.entries(ALIASES)) ALIASES_NORM[sinTildes(alias).toLowerCase()] = oficial

export function normalizarEntidad(texto: string): { oficial: string; aliasUsado: string | null } {
  const clave = sinTildes(texto.trim().toLowerCase())
  const oficial = ALIASES_NORM[clave]
  return oficial ? { oficial, aliasUsado: texto.trim() } : { oficial: texto.trim(), aliasUsado: null }
}
