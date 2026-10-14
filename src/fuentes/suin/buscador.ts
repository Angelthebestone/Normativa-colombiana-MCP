import { CanarioError, limpiarTermino } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import { enlaceSuin } from './enlace.ts'

/**
 * El índice de Azure Cognitive Search que consultaba el front anterior de SUIN:
 * 56.832 documentos con epígrafe, sector, materia y entidad emisora. Sigue
 * respondiendo (medido el 2026-09-24) y es lo que permite explorar SUIN por
 * materia; el índice empaquetado solo sabe traducir una cita a un id.
 *
 * DOS LÍMITES MEDIDOS, y por eso esto NO sustituye a `ficha()`:
 *
 * 1. Su campo `vigencia` contradice a la ficha. La Ley 74 de 1923 (id 1622206)
 *    aparece aquí como "Vigencia en Estudio" y su ficha dice "Derogado". Solo
 *    82 de 56.832 figuran derogadas (0,14%): parece el estado de la carga
 *    inicial, no el actual. Se devuelve rotulado como dato del buscador.
 * 2. No sirve para resolver citas: "LEY 909 DE 2004" devuelve cero resultados.
 *    Para eso está `ficha()`.
 *
 * ponytail: la api-key es la que el propio sitio sirve a cualquier visitante en
 * js/buscador.js, y es de solo consulta. Si la rotan, esta búsqueda deja de
 * responder —de ahí el CanarioError, para que se note en vez de parecer que
 * SUIN no tiene nada.
 */
const BUSCADOR = 'https://searchmjd.search.windows.net/indexes/suinjuriscol-index/docs'
const API_KEY = '404481BD9298D9A33EE7215E16757100'

export type ResultadoSuin = {
  id: string
  titulo: string
  subtipo: string
  epigrafe: string
  vigencia: string
  entidad: string
  url: string
}

type RespuestaAzure = {
  '@odata.count'?: number
  value?: {
    ID?: string
    titulo?: string
    subtipo?: string
    epigrafe?: string
    vigencia?: string[]
    entidad_emisora?: string
  }[]
}

export async function buscar(opts: {
  texto: string
  vigencia?: string | undefined
  sector?: string | undefined
  desde?: number | undefined
  limite?: number | undefined
}): Promise<{ total: number; items: ResultadoSuin[] }> {
  const texto = limpiarTermino(opts.texto) || '*'
  const limite = Math.min(Math.max(opts.limite ?? 15, 1), 50)
  const p = new URLSearchParams({
    'api-version': '2019-05-06',
    search: texto,
    $top: String(limite),
    $skip: String(Math.max(0, opts.desde ?? 0)),
    $count: 'true',
    $select: 'ID,titulo,subtipo,epigrafe,vigencia,entidad_emisora',
  })
  // Los filtros son campos de colección; se escriben tal como los espera OData.
  const filtros = [
    opts.vigencia ? `vigencia/any(t: t eq '${opts.vigencia.replace(/'/g, "''")}')` : '',
    opts.sector ? `sector/any(t: t eq '${opts.sector.replace(/'/g, "''")}')` : '',
  ].filter(Boolean)
  if (filtros.length) p.set('$filter', filtros.join(' and '))

  const r = await pedir(`${BUSCADOR}?${p}`, 40_000, 'application/json;odata.metadata=none', { 'api-key': API_KEY })
  if (r.status !== 200) {
    throw new CanarioError(`el buscador de SUIN respondió ${r.status} (la clave pública del portal pudo cambiar)`)
  }
  let j: RespuestaAzure
  try {
    j = JSON.parse(r.cuerpo) as RespuestaAzure
  } catch {
    throw new CanarioError('el buscador de SUIN no devolvió JSON')
  }
  if (!Array.isArray(j.value)) throw new CanarioError('la respuesta del buscador de SUIN no trae la lista de documentos')

  return {
    total: typeof j['@odata.count'] === 'number' ? j['@odata.count'] : j.value.length,
    items: j.value.map((d) => ({
      id: String(d.ID ?? ''),
      titulo: (d.titulo ?? '').replace(/\s+/g, ' ').trim(),
      subtipo: d.subtipo ?? '',
      epigrafe: (d.epigrafe ?? '').replace(/\s+/g, ' ').trim(),
      vigencia: (d.vigencia ?? []).join(', '),
      entidad: d.entidad_emisora ?? '',
      url: enlaceSuin(d.ID ?? ''),
    })),
  }
}
