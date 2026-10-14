import { sinTildes } from '../../../nucleo/parse.ts'
import { terminosSignificativos } from '../../gestor/index.ts'

export type Titulacion = { problema: string; respuesta: string; nota: string }
export type Providencia = {
  radicado: string
  fecha: string
  ponente: string
  sala: string
  clase: string
  actor: string
  demandado: string
  titulaciones: Titulacion[]
  /** Ficha del proceso en SAMAI: es el enlace citable, no el del buscador. */
  url: string
  /**
   * Token firmado que el propio buscador emite para VER la providencia. Es la
   * única vía a su texto: la ficha del proceso pide una verificación anti-robot
   * y este camino, que el portal publica en sus resultados, no pide nada.
   * Caduca en una hora, así que no es citable: se regenera repitiendo la búsqueda.
   */
  token: string
}

/** Texto de una providencia sobre el que se filtra: problema jurídico, respuesta y nota. */
const textoDe = (p: Providencia): string =>
  p.titulaciones.map((t) => `${t.problema} ${t.respuesta} ${t.nota}`).join(' ')

/**
 * Filtro local AND. SAMAI une los términos con OR, así que el filtro que exige
 * TODOS los términos va aquí, después de la consulta, sobre el texto que el
 * buscador sí publica en cada resultado (problema jurídico, respuesta y nota).
 * Las vacías no se exigen: "nulidad electoral" no debe descartar una providencia
 * por no traer la palabra "de".
 */
export function contienenTodas(items: Providencia[], frase: string): { items: Providencia[]; exigidos: string[]; omitidos: number } {
  const exigidos = terminosSignificativos(frase)
  if (exigidos.length < 2) return { items, exigidos, omitidos: 0 }
  const quedan = items.filter((p) => {
    const heno = sinTildes(textoDe(p)).toLowerCase()
    return exigidos.every((t) => heno.includes(t))
  })
  return { items: quedan, exigidos, omitidos: items.length - quedan.length }
}
