import { LEXIS } from './enlace.ts'

/** El índice de Elasticsearch del buscador nuevo de SUIN: fichas y búsqueda. */
export const INDICE = `${LEXIS}/elasticsearch/documents_pdn/_search`

/** Las colecciones del índice, por su `configid`. */
export const COLECCIONES = {
  normas: 30,
  'corte-constitucional': 200,
  'consejo-estado': 100,
  'corte-suprema': 300,
} as const
export type Coleccion = keyof typeof COLECCIONES

/** Un documento del índice, con los campos que se usan. */
export type DocIndice = {
  id?: number | string
  visualizacion?: number | string | null
  configid?: number | null
  name?: string | null
  titulo?: string | null
  tipo?: string | null
  subtipo?: string | null
  numero?: string | null
  anio?: string | null
  epigrafe?: string | null
  estado?: string | null
  entidad?: string | null
  sector?: string | null
  normademandada?: string | null
  magistradoponente?: string | null
  consejeroponente?: string | null
  magistradosuprema?: string | null
}


/** La forma que se espera del índice; `fichasDe` y `resultadosDe` comprueban lo que usan. */
export type RespuestaFichas = {
  hits?: {
    total?: { value?: number } | number
    hits?: {
      /** Solo en consultas ordenadas: lo usa la paginación del generador del índice. */
      sort?: number[]
      _source?: DocIndice
    }[]
  }
}
