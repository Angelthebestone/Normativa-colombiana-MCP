import { articulo as extraerArticulo, sinTildes } from './parse.ts'

/** false si la URL no parsea; true solo si el hostname coincide, sin 'www.' ni puerto. */
export function validarUrl(url: string, dominioEsperado: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  return hostname.toLowerCase().replace(/^www\./i, '') === dominioEsperado.toLowerCase().replace(/^www\./i, '')
}

/** Escapa el término para poder usarlo como literal dentro de un RegExp. */
function escaparRe(termino: string): string {
  return termino.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * true solo si el número (y el año, cuando se pide) aparece como palabra
 * completa en el título, sin importar tildes ni mayúsculas.
 */
export function validarNumeroAnio(titulo: string, numero: string, anio?: string): boolean {
  const plano = sinTildes(titulo).toLowerCase()
  if (!new RegExp(`\\b${escaparRe(sinTildes(numero).toLowerCase())}\\b`).test(plano)) return false
  if (anio !== undefined && !new RegExp(`\\b${escaparRe(sinTildes(anio).toLowerCase())}\\b`).test(plano)) return false
  return true
}

/** true si `articulo` de parse.ts encuentra el artículo pedido y trae texto. */
export function validarArticulo(texto: string, articulo: string): boolean {
  const extraido = extraerArticulo(texto, articulo)
  return extraido !== null && extraido.trim() !== ''
}

export function clasificarValidacion(
  comprobaciones: { nombre: string; ok: boolean }[],
): 'cita validada' | 'cita parcialmente validada' | 'no fue posible validar' {
  // `every` devuelve true sobre un array vacío, así que cubre ambos casos.
  if (comprobaciones.every((c) => !c.ok)) return 'no fue posible validar'
  if (comprobaciones.every((c) => c.ok)) return 'cita validada'
  return 'cita parcialmente validada'
}
