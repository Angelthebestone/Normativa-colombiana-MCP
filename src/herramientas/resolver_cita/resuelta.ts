import type { Uso } from '../../nucleo/alcance.ts'
import type * as gestor from '../../fuentes/gestor/index.ts'
import type * as suin from '../../fuentes/suin/index.ts'

export type OpcionesCita = {
  /** Artículos de la MISMA norma: se resuelve y se descarga una vez, y se extrae cada uno. */
  articulos?: string[] | undefined
  /** Con false se omite el extracto de tema asociado, que es lo más caro de la respuesta. */
  contexto?: boolean | undefined
}

/** Las fuentes que consulta la rama del Gestor, inyectables para probar sin red. */
export type Deps = {
  buscar?: typeof gestor.buscar
  obtenerNorma?: typeof gestor.obtenerNorma
  fichaSuin?: typeof suin.ficha
  documentoSuin?: typeof suin.documento
}

/**
 * Una cita resuelta, antes de darle forma. Cada rama devuelve DATOS y no texto
 * porque la forma depende del resto de la respuesta: en un lote, las citas de
 * la misma norma comparten ficha, y la línea de alcance es una para todas. Con
 * cada rama componiendo su texto, agrupar obligaba a volver a parsear lo que el
 * propio código acababa de escribir.
 */
export type Resuelta = {
  /** La cita tal como llegó: encabeza el bloque cuando la norma se cita una sola vez. */
  cita: string
  /** Identidad de la norma (`gestor:<id>`, `senado:<archivo>`, `corte:<sentencia>`); null si no resolvió. */
  clave: string | null
  /** Título oficial: encabeza el bloque cuando varias citas del lote dan con la misma norma. */
  titulo?: string
  /** Lo que recibe `alcance()`. */
  usos: Uso[]
  /** Lo propio de ESTA cita (equivalencia del código, tipo corregido, artículo ignorado). */
  avisos: string[]
  /** Todo lo que no es artículo: identificación, vigencia, siguiente paso, enlace. */
  ficha: string
  /** Un bloque por artículo pedido, sin la URL de la norma, que ya está en la ficha. */
  articulos: string[]
  /** Advertencias que cierran el bloque, después de los artículos. */
  pie?: string[]
}

/** Una cita sin norma: su bloque propio, con el motivo en la ficha. */
export const sinNorma = (cita: string, usos: Uso[], ficha: string, avisos: string[] = []): Resuelta => ({
  cita,
  clave: null,
  usos,
  avisos,
  ficha,
  articulos: [],
})
