import { CanarioError } from '../../nucleo/parse/errores.ts'
import { colapsarEspacios as plano, limpiarTermino } from '../../nucleo/parse/texto.ts'
import { pedirJson } from '../../nucleo/http.ts'
import { COLECCIONES, INDICE, type Coleccion, type RespuestaFichas } from './elasticsearch.ts'
import { enlaceSuin } from './enlace.ts'

/**
 * La búsqueda por texto del portal nuevo: la misma `multi_match` de su caja
 * general sobre `documents_pdn`, acotada a una colección por `configid`.
 * Sustituye al índice de Azure Cognitive Search del front anterior, cuyo campo
 * de vigencia contradecía la ficha (la Ley 74 de 1923 figuraba "Vigencia en
 * Estudio"), que no resolvía citas ("LEY 909 DE 2004" daba cero) y que no
 * encontraba la Ley 1221 de 2008 por "teletrabajo". Aquí, medido el
 * 2026-10-14, las tres cosas salen bien: el `estado` es el de la ficha.
 *
 * `materia` va como frase y no como término exacto: el campo junta varias
 * materias con "|" ("Administrativo general|Laboral administrativo"), y el
 * término exacto del front solo casa con los documentos de una sola.
 */
export type ResultadoSuin = {
  id: string
  titulo: string
  subtipo: string
  epigrafe: string
  /** El `estado` de la ficha; en jurisprudencia no lo hay. */
  vigencia: string
  /** Entidad emisora; en jurisprudencia, el ponente. */
  entidad: string
  url: string
}

/** Campos de la caja general del portal, con sus mismos pesos. */
const CAMPOS_TEXTO = [
  'name^5',
  'epigrafe^2',
  'anio^2',
  'materia^2',
  'tipo',
  'tipodocumento',
  'numero',
  'sector',
  'subtipo',
  'estado',
  'entidad',
  'accionante',
  'demandante',
  'magistradoponente',
  'consejeroponente',
  'magistradosuprema',
  'normademandada',
  'documentofuente',
  'numerodiariooficial',
  'numeroradicacionproceso',
]

/** El cuerpo de la consulta, separado para probarlo sin red. */
export function consultaBusqueda(opts: {
  texto: string
  coleccion?: Coleccion | undefined
  vigencia?: string | undefined
  sector?: string | undefined
  materia?: string | undefined
  desde?: number | undefined
  limite?: number | undefined
}): Record<string, unknown> {
  const texto = limpiarTermino(opts.texto)
  const filtro: Record<string, unknown>[] = [{ term: { configid: COLECCIONES[opts.coleccion ?? 'normas'] } }]
  if (opts.vigencia) filtro.push({ term: { 'estado.keyword': opts.vigencia } })
  if (opts.sector) filtro.push({ term: { 'sector.keyword': opts.sector } })
  const debe: Record<string, unknown>[] = []
  // Las palabras pueden repartirse entre campos (el tipo en `name`, el año en `anio`), pero tienen que estar:
  // con el `or` de la caja del portal, "LEY 909 DE 2004" reunía 89.151 documentos. Hasta dos palabras se exigen
  // todas; con más, tres de cada cuatro, para que una frase larga no se quede en cero por una sola.
  if (texto) {
    debe.push({ multi_match: { query: texto, fields: CAMPOS_TEXTO, type: 'cross_fields', minimum_should_match: '2<75%' } })
  }
  if (opts.materia) debe.push({ match_phrase: { materia: opts.materia } })
  return {
    from: Math.max(0, opts.desde ?? 0),
    size: Math.min(Math.max(opts.limite ?? 15, 1), 50),
    track_total_hits: true,
    query: { bool: { filter: filtro, must: debe } },
  }
}

/** Los resultados de una respuesta del índice; sin `hits.hits` es el portal cambiado. */
export function resultadosDe(json: RespuestaFichas | null | undefined): { total: number; items: ResultadoSuin[] } {
  const hits = json?.hits?.hits
  if (!Array.isArray(hits)) throw new CanarioError('el índice de SUIN no trae hits.hits')
  const t = json?.hits?.total
  const total = typeof t === 'number' ? t : (t?.value ?? hits.length)
  const items = hits
    .map((h) => h._source ?? {})
    .filter((d) => (d.visualizacion ?? d.id) != null)
    .map((d) => {
      const id = String(d.visualizacion ?? d.id)
      const ponente = d.magistradoponente ?? d.consejeroponente ?? d.magistradosuprema ?? ''
      const jurisprudencia = d.configid != null && d.configid !== COLECCIONES.normas
      return {
        id,
        // Al `name` de una providencia le sobran el sello de tiempo del final y los "null" de campos vacíos.
        titulo: plano(
          (jurisprudencia ? (d.name ?? d.titulo ?? '') : (d.titulo ?? d.name ?? ''))
            .replace(/\s+\d{9,}\s*$/, '')
            .replace(/\bnull\b/g, ''),
        ),
        subtipo: plano(d.subtipo ?? ''),
        epigrafe: plano((jurisprudencia ? (d.normademandada ?? d.epigrafe) : d.epigrafe) ?? ''),
        vigencia: plano(d.estado ?? ''),
        entidad: plano(jurisprudencia ? ponente : (d.entidad ?? '')),
        url: enlaceSuin(id),
      }
    })
  return { total, items }
}

export async function buscar(
  opts: Parameters<typeof consultaBusqueda>[0],
  deps: { pedirJson?: (url: string, cuerpo: unknown) => Promise<RespuestaFichas> } = {},
): Promise<{ total: number; items: ResultadoSuin[] }> {
  const json = await (deps.pedirJson ?? ((u, c) => pedirJson<RespuestaFichas>(u, c, 40_000)))(INDICE, consultaBusqueda(opts))
  return resultadosDe(json)
}
