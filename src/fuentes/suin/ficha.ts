import { TTL_BUSQUEDA_MS } from '../../nucleo/cache.ts'
import { CanarioError } from '../../nucleo/parse/errores.ts'
import { sinTildes } from '../../nucleo/parse/texto.ts'
import { pedirJson } from '../../nucleo/http.ts'
import { COLECCIONES, INDICE, type RespuestaFichas } from './elasticsearch.ts'
import { claveSuin, enlaceSuin } from './enlace.ts'

/**
 * Metadatos de un documento de SUIN. El estado se devuelve literal, sin
 * reducirlo a un booleano: SUIN distingue "Vigente", "Derogado", "Vigencia en
 * Estudio", "Compilado"…, y un sí/no inventaría una certeza que la fuente no da.
 *
 * `id` es el de `visualizacion`, que es el id clásico de SUIN (el de
 * `viewDocument.asp?id=` y el del índice empaquetado): el `id` del índice nuevo
 * es otro y difiere en uno para 619 leyes (Ley 1945 de 2019: 30036079 frente a
 * 30036080).
 */
export type Ficha = {
  id: string
  tipo: string
  subtipo: string
  numero: string
  anio: string
  epigrafe: string
  estado: string
  url: string
}

/**
 * Las fichas de una respuesta del índice. Una respuesta sin la lista de
 * resultados es el portal cambiado, no una norma inexistente: se lanza el
 * canario para que se note en vez de leerse como "no consta".
 */
export function fichasDe(json: RespuestaFichas | null | undefined): Ficha[] {
  const hits = json?.hits?.hits
  if (!Array.isArray(hits)) throw new CanarioError('el índice de fichas de SUIN no trae hits.hits')
  return hits
    .map((h) => h._source ?? {})
    .filter((d) => (d.visualizacion ?? d.id) != null && d.tipo && d.numero && d.anio)
    .map((d) => {
      const id = String(d.visualizacion ?? d.id)
      return {
        id,
        tipo: String(d.tipo).toUpperCase(),
        subtipo: String(d.subtipo ?? '').toUpperCase(),
        numero: String(d.numero),
        anio: String(d.anio),
        epigrafe: (d.epigrafe ?? '').replace(/\s+/g, ' ').trim(),
        estado: (d.estado ?? '').trim(),
        url: enlaceSuin(id),
      }
    })
}

// --- ficha por identidad ------------------------------------------------------

/** Los estados de la ficha, para que quien llama los distinga. */
export type EstadoFicha =
  | { ok: true; ficha: Ficha }
  | {
      ok: false
      razon: 'ficha-caida' | 'no-consta'
      /** Qué se vio exactamente: sin esto, una caída del portal y un corte del
       *  cliente se leen igual y no hay nada que comprobar. */
      detalle?: string
    }

const cacheFichas = new Map<string, { estado: EstadoFicha; ts: number }>()
const TTL_FICHA = 30 * 60 * 1000

/** Mayúsculas sin tildes y con los espacios colapsados. */
const normalizaTipo = (s: string): string => sinTildes(s).toUpperCase().replace(/\s+/g, ' ').trim()

/** "01235" y "1235" son el mismo número. */
const sinCeros = (n: string): string => (/^\d+$/.test(n) ? String(Number(n)) : n)

/**
 * ¿Esta ficha ES la norma pedida? Número y año exactos, y el tipo pedido tiene
 * que ser el tipo de la ficha o su subtipo. Con el portal viejo, "Decreto 1235
 * de 2023" devolvía primero "DECRETO 1235 DE 1952": acertar la forma y fallar
 * el fondo. El índice ya filtra por número y año, pero se vuelve a comprobar
 * aquí porque es lo único que separa una vigencia real de una ajena.
 *
 * "Decreto" casa con un DECRETO de subtipo DECRETO LEY: en Colombia los decretos
 * de un año comparten una sola numeración, así que son el mismo documento. Al
 * revés no: "Ley" no casa con un DECRETO LEY.
 */
export function esLaPedida(f: Ficha, tipo: string, numero: string, anio: string): boolean {
  const pedido = normalizaTipo(tipo)
  const tipoOk = pedido === f.tipo || pedido === normalizaTipo(f.subtipo) || pedido.startsWith(`${f.tipo} `)
  return tipoOk && sinCeros(f.numero) === sinCeros(numero) && f.anio === anio
}

/**
 * La ficha de SUIN de una norma por su tipo, número y año, con el estado de
 * vigencia que publica. Cualquier tipo: leyes, decretos, actos legislativos.
 *
 * Tres estados y no un `null`: la ficha, "no consta" (SUIN no tiene esa norma)
 * y "ficha caída" (no se pudo preguntar), porque los dos últimos se leen igual
 * si no se separan y solo el primero es un dato. Se cachea 30 min por norma.
 *
 * `pedirJson` es inyectable para probar los tres estados sin red.
 */
export async function ficha(
  tipo: string,
  numero: string,
  anio: string,
  deps: { pedirJson?: (url: string, cuerpo: unknown) => Promise<RespuestaFichas> } = {},
): Promise<EstadoFicha> {
  const clave = claveSuin(tipo, numero, anio)
  const cache = cacheFichas.get(clave)
  if (cache && Date.now() - cache.ts < (cache.estado.ok ? TTL_FICHA : TTL_BUSQUEDA_MS)) return cache.estado

  let fichas: Ficha[]
  try {
    const json = await (deps.pedirJson ?? ((u, c) => pedirJson<RespuestaFichas>(u, c, 8_000)))(INDICE, {
      size: 10,
      query: {
        bool: {
          filter: [
            { term: { configid: COLECCIONES.normas } },
            { term: { 'numero.keyword': sinCeros(numero) } },
            { term: { 'anio.keyword': anio } },
          ],
        },
      },
    })
    fichas = fichasDe(json)
  } catch (e) {
    // Con un corte de 8 s: la ficha es un complemento de la respuesta, y un
    // portal caído tardaba ~21 s en fallar por el ETIMEDOUT del sistema.
    return { ok: false, razon: 'ficha-caida', detalle: (e as Error).message }
  }
  const f = fichas.find((x) => esLaPedida(x, tipo, numero, anio))
  // Se recuerda el veredicto firme, la ficha y también el «no consta» (sin esto se volvía a preguntar en
  // cada herramienta); nunca la ficha caída, que se devolvió arriba.
  const estado: EstadoFicha = f ? { ok: true, ficha: f } : { ok: false, razon: 'no-consta' }
  cacheFichas.set(clave, { estado, ts: Date.now() })
  return estado
}

