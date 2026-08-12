/**
 * normograma.info — el producto que la DIAN usa para publicar su normativa.
 *
 * Es un buscador JSON, la forma más barata de integrar, y cubre lo tributario,
 * aduanero y cambiario, que ninguna otra fuente del MCP toca.
 *
 * Dos cosas verificadas a mano que conviene no olvidar:
 *
 * - El certificado NO cubre `www.normograma.info`, solo el dominio pelado.
 * - Buscador y documentos viven en sitios distintos: el endpoint JSON responde
 *   en la instancia `prueba-dian` de normograma.info, mientras que el texto de
 *   los documentos está en normograma.dian.gov.co. En producción el mismo
 *   `Buscar.ashx` da 404 (y 500 en la raíz), así que no hay alternativa.
 *
 * ponytail: la búsqueda depende de una instancia llamada "prueba". Si un día
 * deja de responder, el canario lo dirá y habrá que buscar el buscador nuevo;
 * no se puede evitar hoy porque producción no expone ninguno.
 */
import { CanarioError } from '../nucleo/parse.ts'
import { pedir } from '../nucleo/http.ts'

const BUSCADOR = 'https://normograma.info/prueba-dian/buscador/Buscar.ashx'
const DOCS = 'https://normograma.dian.gov.co/dian/compilacion/docs'

export type DocDian = {
  nombre: string
  epigrafe: string
  entidad: string
  tipo: string
  anio: string
  numero: string
  extracto: string
  link: string
  url: string
}

/** El buscador devuelve el resaltado con entidades HTML y <b>; se limpia. */
const limpio = (s: unknown): string =>
  typeof s === 'string'
    ? s
        .replace(/<[^>]+>/g, '')
        .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : ''

type Crudo = {
  nombre?: string
  texto?: string
  link?: string
  entidad?: string
  epigrafe?: string
  tipo?: string
  year?: string
  numero?: string
}

export const urlDocumento = (link: string): string => `${DOCS}/${link.replace(/^\/+/, '')}`

/**
 * ponytail: caché por término con TTL de 30 minutos.
 *
 * El endpoint devuelve SIEMPRE el resultado completo —3,16 MB y ~20 s para
 * "retención"— y no admite tope: se probaron max, top, limite, rows, pagina/tam
 * y start/count, y los siete devuelven los mismos 6.651 elementos. Sin caché,
 * pedir la segunda página volvía a bajar los 3 MB.
 *
 * El TTL existe porque una respuesta congelada para siempre es peor que una
 * caída declarada: el normograma publica normas nuevas con frecuencia, y la
 * caché no debe enmascararlas indefinidamente. Cuando expira se refresca; si la
 * red cae en ese momento, se sirve la caché obsoleta ROTULADA como tal.
 */
const TTL_CACHE = 30 * 60 * 1000
type Entrada = { valor: DocDian[]; expira: number }
const cache = new Map<string, Entrada>()

/**
 * Busca en el normograma de la DIAN. La respuesta no admite tope, así que se
 * recorta aquí después de leerla. Devuelve marcas opcionales de procedencia:
 * `deCache` (se sirvió de la caché, dentro del TTL), `caducada` (había caché
 * pero expiró y se refrescó) y `obsoleta` (la red cayó y se sirvió la caché
 * vencida, rotulada, en vez de fallar).
 */
export async function buscar(
  texto: string,
  limite = 15,
  desde = 0,
  deps: {
    pedir?: (url: string, timeout?: number, accept?: string) => Promise<{ status: number; cuerpo: string }>
    ahora?: () => number
  } = {},
): Promise<{ total: number; items: DocDian[]; deCache?: boolean; caducada?: boolean; obsoleta?: boolean }> {
  const pedirBusqueda = deps.pedir ?? pedir
  const ahora = deps.ahora ?? Date.now
  const q = texto.trim()
  if (!q) throw new Error('Indica un término para buscar en el normograma de la DIAN.')

  const clave = q.toLowerCase()
  const guardado = cache.get(clave)
  if (guardado && ahora() < guardado.expira) {
    return { total: guardado.valor.length, items: guardado.valor.slice(desde, desde + limite), deCache: true }
  }
  const vencida = guardado ? guardado.valor : null

  let r: { status: number; cuerpo: string }
  try {
    r = await pedirBusqueda(`${BUSCADOR}?texto=${encodeURIComponent(q)}`, 90_000, 'application/json,*/*')
  } catch (e) {
    // Red caída con caché vencida: se sirve la obsoleta, declarada, en vez de
    // tumbar la consulta; sin caché se relanza el error normal.
    if (vencida) {
      return { total: vencida.length, items: vencida.slice(desde, desde + limite), deCache: true, caducada: true, obsoleta: true }
    }
    throw e
  }
  if (r.status !== 200) {
    if (vencida) {
      return { total: vencida.length, items: vencida.slice(desde, desde + limite), deCache: true, caducada: true, obsoleta: true }
    }
    throw new CanarioError(`el buscador de la DIAN respondió ${r.status}`)
  }

  // El backend devuelve HTTP 200 con el literal (sin comillas, no es JSON)
  // `No se encontraron resultados.` cuando no hay coincidencias: es un vacío
  // legítimo, no un cambio de estructura.
  if (/no se encontraron resultados/i.test(r.cuerpo)) {
    cache.set(clave, { valor: [], expira: ahora() + TTL_CACHE })
    return { total: 0, items: [], caducada: Boolean(vencida) }
  }

  let j: unknown
  try {
    j = JSON.parse(r.cuerpo)
  } catch {
    throw new CanarioError('el buscador de la DIAN no devolvió JSON')
  }
  if (!Array.isArray(j)) throw new CanarioError('la respuesta del buscador de la DIAN no es una lista')
  // Un array vacío es un resultado legítimo; lo que no puede pasar es que los
  // elementos dejen de traer nombre y link, que es de lo que todo depende.
  const items = j as Crudo[]
  if (items.length && !(items[0]?.nombre && items[0]?.link)) {
    throw new CanarioError('los resultados de la DIAN ya no traen nombre y link')
  }

  const limpios: DocDian[] = items.map((d) => ({
    nombre: limpio(d.nombre),
    epigrafe: limpio(d.epigrafe),
    entidad: limpio(d.entidad),
    tipo: limpio(d.tipo),
    anio: limpio(d.year),
    numero: limpio(d.numero),
    extracto: limpio(d.texto),
    link: d.link ?? '',
    url: urlDocumento(d.link ?? ''),
  }))

  cache.set(clave, { valor: limpios, expira: ahora() + TTL_CACHE })
  return { total: limpios.length, items: limpios.slice(desde, desde + limite), caducada: Boolean(vencida) }
}
