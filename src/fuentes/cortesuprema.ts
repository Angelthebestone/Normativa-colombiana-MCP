/**
 * Corte Suprema de Justicia — buscador de providencias.
 *
 * Backend separado del portal (`consultaprovidenciasbk`), encontrado leyendo su
 * bundle, igual que con la Constitucional. Es GraphQL, con la introspección
 * abierta, así que el esquema es verificable y no adivinado.
 *
 * Lo que aporta y ninguna otra fuente da: cada providencia trae la lista de
 * normas que cita, y esas citas encadenan directo con resolver_cita.
 *
 * Dos avisos verificados:
 *
 * - Una ruta inventada NO da 404: devuelve 200 con una página de mantenimiento.
 *   El canario valida la forma del JSON, nunca el código HTTP.
 * - Hay que indicar sala: sin `typeOfQuery` la consulta devuelve `null` en vez
 *   de error. Es la trampa que más tiempo cuesta si no se sabe.
 *
 * ponytail: no se descarga el texto. Las providencias son .docx en el servidor
 * y extraerlo pediría una dependencia nueva para leer OOXML; se entrega la
 * referencia y las normas citadas, que es lo que encadena con el resto del MCP.
 */
import { CanarioError } from '../parse.ts'
import { pedirJson } from '../http.ts'

const API = 'https://consultaprovidenciasbk.cortesuprema.gov.co/api'

/** Salas que expone el buscador; sin una de estas la consulta devuelve null. */
export const SALAS = ['Tutelas', 'Civil', 'Laboral', 'Penal'] as const
export type Sala = (typeof SALAS)[number]

export type Providencia = {
  titulo: string
  sala: string
  clase: string
  magistrado: string
  fecha: string
  anio: number
  ruta: string
  normasCitadas: string[]
}

const CONSULTA =
  'query($q:SearchQuery!){getSearchResult(searchQuery:$q){numOfResults searchResults{' +
  'title id onlinePath doctor fechaCreacion ano autoSentencia leyesOArticulos}}}'

type Cruda = {
  title?: string
  onlinePath?: string
  doctor?: string
  fechaCreacion?: string
  ano?: number
  autoSentencia?: string
  leyesOArticulos?: string[]
}

export async function buscar(opts: {
  texto: string
  sala?: Sala | undefined
  anio?: string | undefined
  magistrado?: string | undefined
  exacto?: boolean | undefined
  desde?: number | undefined
}): Promise<{ total: number; items: Providencia[] }> {
  const texto = opts.texto.trim()
  if (!texto) throw new Error('Indica un término para buscar en la Corte Suprema.')
  const sala = opts.sala ?? 'Tutelas'

  const j = await pedirJson<{
    data?: { getSearchResult?: { numOfResults?: number; searchResults?: Cruda[] } | null }
    errors?: { message?: string }[]
  }>(API, {
    query: CONSULTA,
    variables: {
      q: {
        query: texto,
        // La sala viaja en los dos campos: así la pide su propio front.
        typeOfQuery: sala,
        roomTutelas: sala,
        start: Math.max(0, opts.desde ?? 0),
        isExact: opts.exacto ?? false,
        magistrate: opts.magistrado ?? '',
        year: opts.anio ?? '',
        autoSentencia: '',
        order: '',
        addedQueries: [],
      },
    },
  })

  if (j.errors?.length) throw new CanarioError(`el buscador de la Corte Suprema rechazó la consulta: ${j.errors[0]?.message}`)
  const r = j.data?.getSearchResult
  // `null` sin error es su forma de decir "faltan filtros"; no es "sin resultados".
  if (r === null || r === undefined) {
    throw new CanarioError('la Corte Suprema devolvió una respuesta vacía (suele faltar la sala)')
  }
  if (!Array.isArray(r.searchResults)) throw new CanarioError('la respuesta de la Corte Suprema no trae la lista de providencias')

  return {
    total: typeof r.numOfResults === 'number' ? r.numOfResults : r.searchResults.length,
    items: r.searchResults.map((p) => ({
      titulo: (p.title ?? '').replace(/\.docx?$/i, ''),
      sala,
      clase: p.autoSentencia ?? '',
      magistrado: (p.doctor ?? '').replace(/^Dr[a]?\.\s*/i, ''),
      fecha: (p.fechaCreacion ?? '').slice(0, 10),
      anio: p.ano ?? 0,
      ruta: p.onlinePath ?? '',
      normasCitadas: Array.isArray(p.leyesOArticulos) ? p.leyesOArticulos : [],
    })),
  }
}
