import { request } from 'node:https'
import { pipeline } from 'node:stream'
import { rootCertificates } from 'node:tls'
import { createGunzip, createInflate } from 'node:zlib'
import { GLOBALSIGN_OV, SECTIGO_EV, SECTIGO_OV } from './ca.ts'

/**
 * Raíces de Node más los intermedios que funcionpublica.gov.co,
 * suin-juriscol.gov.co y sic.gov.co omiten. La verificación del certificado
 * sigue ACTIVA: solo se completa una cadena que el servidor envía incompleta.
 * Nunca usar rejectUnauthorized:false — este MCP entrega información legal y
 * la autenticidad de la fuente es parte del producto.
 */
const CA = [...rootCertificates, SECTIGO_OV, SECTIGO_EV, GLOBALSIGN_OV]

/** esbuild la sustituye desde package.json; sin empaquetar no existe. */
declare const __VERSION__: string | undefined
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

const UA = `normativa-colombia-mcp/${VERSION} (+https://github.com/Angelthebestone/Normativa-colombiana-MCP)`

// --- ritmo ---------------------------------------------------------------

/**
 * Una petición por segundo sostenida y ráfagas de hasta cinco, por dominio.
 *
 * Ninguno de los dos portales declara `Crawl-delay`, así que la cifra es
 * criterio propio: una interacción real encadena entre dos y cuatro peticiones
 * (resolver la cita, traer la norma; o buscar, resolver el subtema, reconsultar)
 * y con cinco fichas salen sin demora perceptible, mientras el techo sostenido
 * queda por debajo de lo que genera una persona navegando.
 *
 * Más importante que la tasa: una sola petición en vuelo por dominio. Eso es lo
 * que impide apilar carga sobre un servicio público.
 */
const CAPACIDAD = 5
const RELLENO_MS = 1000

type Cubo = { fichas: number; ultimo: number }
const cubos = new Map<string, Cubo>()
const colas = new Map<string, Promise<unknown>>()

const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function ficha(host: string): Promise<void> {
  const c = cubos.get(host) ?? { fichas: CAPACIDAD, ultimo: Date.now() }
  cubos.set(host, c)

  const ahora = Date.now()
  c.fichas = Math.min(CAPACIDAD, c.fichas + (ahora - c.ultimo) / RELLENO_MS)
  c.ultimo = ahora

  if (c.fichas < 1) {
    await pausa((1 - c.fichas) * RELLENO_MS)
    c.fichas = 1
    c.ultimo = Date.now()
  }
  c.fichas -= 1
}

/** Serializa por dominio: nunca hay dos peticiones simultáneas al mismo sitio. */
function enCola<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const previa = colas.get(host) ?? Promise.resolve()
  const tarea = previa.then(async () => {
    await ficha(host)
    return fn()
  })
  colas.set(
    host,
    tarea.catch(() => {}),
  )
  return tarea
}

// --- decodificación ------------------------------------------------------

export type Respuesta = {
  status: number
  cuerpo: string
  cookies: string
  /** Cabeceras en minúscula; la UPME publica el total en `x-wp-total`. */
  cabeceras: Record<string, string>
}

/**
 * Decodifica según lo que declare el documento. La relatoría de la Corte sirve
 * windows-1252 sin decirlo en la cabecera, y leerlo como UTF-8 convierte
 * "Reiteración" en "Reiteraci�n": inaceptable en un texto que alguien va a citar.
 */
export function decodificar(datos: Buffer, contentType = ''): string {
  const declarado =
    contentType.match(/charset=["']?([\w-]+)/i)?.[1] ??
    datos.subarray(0, 4096).toString('latin1').match(/charset=["']?([\w-]+)/i)?.[1]

  const juego = (declarado ?? '').toLowerCase()
  if (juego && !/utf-?8/.test(juego)) {
    try {
      return new TextDecoder(juego).decode(datos)
    } catch {
      /* juego desconocido: seguimos con la detección por contenido */
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(datos)
  } catch {
    // Bytes que no son UTF-8 válido: en la práctica siempre es cp1252.
    return new TextDecoder('windows-1252').decode(datos)
  }
}

// --- petición ------------------------------------------------------------

type Cruda = {
  status: number
  datos: Buffer
  contentType: string
  retryAfter: string
  cookies: string
  /** Cabeceras de respuesta: UPME publica el total de resultados en `x-wp-total`. */
  cabeceras: Record<string, string>
}

/**
 * Junta el cuerpo de una respuesta, descomprimiéndolo si viene comprimido.
 *
 * Va con `pipeline` y no con `pipe` porque `pipe` NO propaga el error del
 * origen. Medido con un servidor que corta la conexión a mitad del cuerpo gzip:
 * `res` emitía 'error' (ECONNRESET) sin nadie escuchando —en Node eso es una
 * excepción no capturada que se lleva por delante el servidor MCP entero— y el
 * descompresor no emitía ni 'end' ni 'error', así que la promesa quedaba
 * colgada para siempre y con ella la cola de ese dominio. El `timeout` de la
 * petición tampoco rescataba: ya no vuelve a dispararse una vez empezada la
 * respuesta.
 *
 * Está separada de `crudo` para poder probarla sin levantar un TLS con
 * certificado propio, que es lo único que impedía cubrir este caso.
 */
export function cuerpoDe(res: NodeJS.ReadableStream & { headers: Record<string, unknown> }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const enc = String(res.headers['content-encoding'] ?? '')
    const descompresor = enc === 'gzip' ? createGunzip() : enc === 'deflate' ? createInflate() : null
    const flujo: NodeJS.ReadableStream = descompresor
      ? pipeline(res, descompresor, (e) => e && reject(e))
      : res
    const trozos: Buffer[] = []
    flujo.on('data', (c: Buffer) => trozos.push(c))
    flujo.on('end', () => resolve(Buffer.concat(trozos)))
    flujo.on('error', reject)
  })
}

function crudo(
  url: string,
  timeout: number,
  accept: string,
  extra: Record<string, string>,
  cuerpo?: string,
): Promise<Cruda> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        ca: CA,
        timeout,
        method: cuerpo === undefined ? 'GET' : 'POST',
        headers: {
          'User-Agent': UA,
          Accept: accept,
          'Accept-Encoding': 'gzip, deflate',
          // El tipo del cuerpo se puede sobrescribir desde `extra`: SAMAI exige
          // un formulario, no JSON.
          ...(cuerpo === undefined
            ? {}
            : { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(cuerpo)) }),
          ...extra,
        },
      },
      (res) => {
        cuerpoDe(res).then(
          (datos) =>
            resolve({
              status: res.statusCode ?? 0,
              datos,
              contentType: String(res.headers['content-type'] ?? ''),
              retryAfter: String(res.headers['retry-after'] ?? ''),
              cookies: (res.headers['set-cookie'] ?? []).map((c) => c.split(';')[0]).join('; '),
              cabeceras: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')]),
              ),
            }),
          reject,
        )
      },
    )
    req.on('timeout', () => req.destroy(new Error(`tiempo de espera agotado tras ${timeout} ms`)))
    req.on('error', reject)
    if (cuerpo !== undefined) req.write(cuerpo)
    req.end()
  })
}

/** `Retry-After` puede venir en segundos o como fecha HTTP. */
function esperaSugerida(cabecera: string): number {
  if (!cabecera) return 0
  const segundos = Number(cabecera)
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000)
  const fecha = Date.parse(cabecera)
  return Number.isNaN(fecha) ? 0 : Math.max(0, fecha - Date.now())
}

const ESPERA_MAXIMA_MS = 30_000

export async function pedir(
  url: string,
  timeout = 60_000,
  accept = 'text/html,*/*',
  /** Cabeceras extra; hoy solo la `api-key` que exige el buscador de SUIN. */
  extra: Record<string, string> = {},
  /** Si viene, la petición es POST con este cuerpo JSON. */
  cuerpo?: string,
): Promise<Respuesta> {
  const host = new URL(url).host

  for (let intento = 0; ; intento++) {
    const r = await enCola(host, () => crudo(url, timeout, accept, extra, cuerpo))

    // Si el portal pide calma, se le hace caso en vez de insistir al mismo ritmo.
    if ((r.status === 429 || r.status === 503) && intento === 0) {
      const espera = Math.min(esperaSugerida(r.retryAfter) || 2000, ESPERA_MAXIMA_MS)
      await pausa(espera)
      // Se vacía el cubo: veníamos yendo más rápido de lo que el sitio tolera.
      cubos.set(host, { fichas: 0, ultimo: Date.now() })
      continue
    }
    if (r.status === 429 || r.status === 503) {
      throw new Error(
        `El portal está limitando las consultas (${r.status}). Espera un momento y vuelve a intentarlo.`,
      )
    }

    return {
      status: r.status,
      cuerpo: decodificar(r.datos, r.contentType),
      cookies: r.cookies,
      cabeceras: r.cabeceras,
    }
  }
}

/**
 * Los mismos bytes, sin decodificar. Existe para los PDF: pasarlos por
 * `decodificar` los destruye —es texto lo que espera— y bajarlos con un `fetch`
 * suelto se salta el ritmo por dominio, los reintentos y la cadena de
 * certificados que este módulo aporta.
 */
export async function pedirBytes(
  url: string,
  timeout = 90_000,
  accept = 'application/pdf,*/*',
): Promise<{ status: number; datos: Buffer; contentType: string }> {
  const host = new URL(url).host
  const r = await enCola(host, () => crudo(url, timeout, accept, {}))
  return { status: r.status, datos: r.datos, contentType: r.contentType }
}

/**
 * POST de JSON y respuesta JSON, para las fuentes que hablan GraphQL. Comparte
 * el ritmo, la serialización por dominio y la cadena TLS de `pedir`.
 */
export async function pedirJson<T>(url: string, cuerpo: unknown, timeout = 40_000): Promise<T> {
  const r = await pedir(url, timeout, 'application/json', {}, JSON.stringify(cuerpo))
  // Un backend que responde 200 con una página de mantenimiento es real: la
  // Corte Suprema lo hace. Por eso se valida que sea JSON, no el código HTTP.
  try {
    return JSON.parse(r.cuerpo) as T
  } catch {
    throw new Error(`${new URL(url).host} respondió algo que no es JSON (estado ${r.status}).`)
  }
}
