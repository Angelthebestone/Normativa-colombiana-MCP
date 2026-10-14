/**
 * Genera datos/indice-suin.json: mapea "ley 909 2004" → id de SUIN-Juriscol.
 *
 * Hasta el 2026-09-16 esto era un crawl de ~11.700 páginas `viewDocument.asp`
 * de tres horas, porque el sitemap solo traía ids y había que abrir cada
 * documento para leer su título. El buscador nuevo consulta un índice de
 * Elasticsearch público con tipo, número y año de cada documento: el índice se
 * arma paginando esa consulta, en una docena de peticiones.
 *
 * Solo leyes, como antes: el índice sirve a `buscarEnIndice`, que resuelve una
 * cita escrita como texto sin salir a la red. La vigencia de cualquier norma,
 * decretos incluidos, ya la pide `ficha()` en vivo por tipo, número y año.
 *
 * FUSIONA con el índice anterior en vez de reemplazarlo: una ley que el índice
 * vivo deje de traer no debe desaparecer del buscador sin red. Donde los dos
 * tienen la ley, manda el nuevo, con el id de `visualizacion`, que es el mismo
 * id clásico. Desde el 2026-10-14 el índice es `documents_pdn` (11.726 leyes,
 * hasta 2026); `documents_stg`, el anterior, se cortaba en 2020.
 *
 * Uso: node scripts/generar-indice-suin.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pedirJson } from '../src/nucleo/http.ts'
import { claveSuin, fichasDe, type RespuestaFichas } from '../src/fuentes/suin/index.ts'

const FICHAS = 'https://lexis.minjusticia.gov.co/elasticsearch/documents_pdn/_search'
const SALIDA = fileURLToPath(new URL('../datos/indice-suin.json', import.meta.url))
const PAGINA = 1000

const previas = ((): Record<string, string> => {
  try {
    return (JSON.parse(readFileSync(SALIDA, 'utf8')) as { normas: Record<string, string> }).normas
  } catch {
    return {}
  }
})()
const normas: Record<string, string> = {}
let despues: number | undefined
let leidas = 0
for (;;) {
  const json = await pedirJson<RespuestaFichas>(
    FICHAS,
    {
      size: PAGINA,
      _source: ['id', 'visualizacion', 'tipo', 'subtipo', 'numero', 'anio', 'epigrafe', 'estado'],
      query: { term: { 'tipo.keyword': 'LEY' } },
      sort: [{ id: 'asc' }],
      ...(despues === undefined ? {} : { search_after: [despues] }),
    },
    60_000,
  )
  // Un número que no es número ("LEY NaN 1936") no se puede citar: fuera.
  for (const f of fichasDe(json)) if (/^\d+$/.test(f.numero)) normas[claveSuin(f.tipo, f.numero, f.anio)] = f.id
  // Se pagina por los hits crudos y no por las fichas: una fila sin número ni
  // año se descarta como ficha, y contarla de menos cortaría la paginación.
  const hits = json.hits?.hits ?? []
  leidas += hits.length
  console.log(`${leidas} leyes leídas`)
  const ultimo = hits.at(-1)?.sort?.[0]
  if (hits.length < PAGINA || ultimo === undefined) break
  despues = ultimo
}

if (Object.keys(normas).length < 10_000) {
  // El índice trae 11.726 leyes (medido el 2026-10-14). Muchas menos es una
  // consulta que cambió, no un corpus que encogió: no se sobrescribe.
  throw new Error(`solo ${Object.keys(normas).length} leyes: la consulta pudo cambiar; no se escribe el índice`)
}
const soloPrevias = Object.keys(previas).filter((k) => !(k in normas)).length
mkdirSync(dirname(SALIDA), { recursive: true })
writeFileSync(
  SALIDA,
  JSON.stringify({ generado: new Date().toISOString().slice(0, 10), fuente: [FICHAS], normas: { ...previas, ...normas } }),
)
console.log(
  `Índice escrito: ${Object.keys(normas).length} leyes del índice nuevo + ${soloPrevias} que solo tenía el anterior → ${SALIDA}`,
)
