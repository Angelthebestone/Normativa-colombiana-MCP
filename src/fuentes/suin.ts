/**
 * SUIN-Juriscol (Ministerio de Justicia).
 *
 * Existe por una sola razón: es la única fuente oficial del país que publica el
 * ESTADO DE VIGENCIA como dato. Ni el Gestor Normativo ni la relatoría lo
 * tienen, y por eso hasta ahora ninguna respuesta podía decir si una norma
 * sigue vigente.
 *
 * No tiene buscador utilizable —su Solr no resuelve ni por nombre ni por IP—,
 * así que la norma se localiza contra un índice empaquetado que se genera con
 * scripts/generar-indice-suin.ts. Sin índice, esta fuente simplemente no opina.
 */
import { readFileSync } from 'node:fs'
import { CanarioError, cargar, limpiarTermino, textoDe } from '../parse.ts'
import { pedir } from '../http.ts'

const BASE = 'https://www.suin-juriscol.gov.co'

export const claveSuin = (tipo: string, numero: string, anio: string): string =>
  `${tipo.toLowerCase()} ${Number(numero)} ${anio}`

export type Ficha = { tipo: string; numero: string; anio: string; epigrafe: string; estado: string }

/**
 * Metadatos del documento, leídos del bloque oculto de `<span field="…">` que
 * SUIN incrusta al principio de cada página (45 campos, entre ellos `tipo`,
 * `numero`, `anio`, `epigrafe` y `estado_documento`).
 *
 * Se lee de ahí y no de la prosa por dos razones medidas: la etiqueta visible
 * "ESTADO DE VIGENCIA" falta en documentos antiguos que sí traen el campo —la
 * Ley 74 de 1923 está DEROGADA y no la muestra—, y donde aparecen los dos se
 * contradicen: en la Ley 1541 de 2012 la prosa dice "Vigente" y el campo dice
 * "Vigencia en Estudio". El campo es el dato; la prosa es su maquetación.
 *
 * El estado se devuelve literal, sin reducirlo a un booleano: SUIN distingue
 * "Vigente", "DEROGADO" y "Vigencia en Estudio", y un sí/no inventaría una
 * certeza que la fuente no da.
 */
export function fichaSuin(html: string): Ficha | null {
  const campos: Record<string, string> = {}
  for (const m of html.matchAll(/<span field="([^"]+)">([\s\S]*?)<\/span>/g)) {
    campos[m[1]!] = m[2]!.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }
  const { tipo, numero, anio } = campos
  if (!tipo || !numero || !anio) return null
  return {
    tipo: tipo.toUpperCase(),
    numero: numero.replace(/\D/g, ''),
    anio,
    epigrafe: campos['epigrafe'] ?? '',
    estado: campos['estado_documento'] ?? '',
  }
}

// --- buscador (Azure Cognitive Search) ------------------------------------

/**
 * SUIN no tiene buscador propio, pero su front nuevo consulta un índice de
 * Azure Cognitive Search: 56.832 documentos —no solo leyes— con epígrafe,
 * sector, materia y entidad emisora. Es lo único que permite explorar SUIN por
 * materia, porque el índice empaquetado solo sabe traducir una cita a un id.
 *
 * DOS LÍMITES MEDIDOS, y por eso esto NO sustituye a `vigencia()`:
 *
 * 1. Su campo `vigencia` contradice a la ficha del documento. La Ley 74 de 1923
 *    (id 1622206) aparece aquí como "Vigencia en Estudio" y su ficha dice
 *    DEROGADO. Además solo 82 de 56.832 figuran derogadas (0,14%), cifra
 *    increíble para un corpus que arranca en 1844: parece el estado de la carga
 *    inicial, no el actual. Se devuelve rotulado como dato del buscador.
 * 2. No sirve para resolver citas: "LEY 909 DE 2004" devuelve cero resultados.
 *    Para eso está resolver_cita con el índice.
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
      url: `${BASE}/viewDocument.asp?id=${d.ID ?? ''}`,
    })),
  }
}

// --- índice empaquetado ---------------------------------------------------

type Indice = { generado: string; normas: Record<string, string> }
let indice: Indice | null | undefined

function cargarIndice(): Indice | null {
  if (indice !== undefined) return indice
  // Empaquetado este módulo vive en server/index.js y el índice queda un nivel
  // arriba; sin empaquetar vive en src/fuentes/ y quedan dos. Se prueban ambos.
  for (const rel of ['../datos/indice-suin.json', '../../datos/indice-suin.json']) {
    try {
      indice = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Indice
      return indice
    } catch {
      /* siguiente ubicación */
    }
  }
  indice = null // sin índice no hay vigencia; no es un fallo, es una capacidad ausente
  return indice
}

export type Vigencia = Ficha & { url: string; generado: string; texto: string }

/**
 * Ficha de SUIN para una norma, o `null` si el índice no la tiene. Si SUIN no
 * publica el estado, `estado` viene vacío y la norma se informa igual: callarla
 * entera por un campo ausente equivaldría a decir que no existe.
 */
export async function vigencia(tipo: string, numero: string, anio: string): Promise<Vigencia | null> {
  const idx = cargarIndice()
  const id = idx?.normas[claveSuin(tipo, numero, anio)]
  if (!idx || !id) return null

  const url = `${BASE}/viewDocument.asp?id=${id}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) return null
  const ficha = fichaSuin(r.cuerpo)
  if (!ficha) return null
  // La página trae el articulado completo además de la ficha, así que se
  // devuelve: ya está descargado y es lo único que hay cuando el Gestor no tiene
  // la norma.
  return { ...ficha, url, generado: idx.generado, texto: textoDe(cargar(r.cuerpo), 'body') }
}
