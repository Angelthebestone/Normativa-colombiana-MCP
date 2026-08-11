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

/** Peticiones HTTP salientes y bytes de cuerpo recibidos (solo para el banco de medición). */
let totalPeticiones = 0
let totalBytes = 0
export function redResumen(): { peticiones: number; bytes: number } {
  return { peticiones: totalPeticiones, bytes: totalBytes }
}
function anotarRed(bytes: number): void {
  totalPeticiones += 1
  totalBytes += bytes
}

/** esbuild la sustituye desde package.json; sin empaquetar no existe. */
declare const __VERSION__: string | undefined
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

const UA = `normativa-colombia-mcp/${VERSION} (+https://github.com/Angelthebestone/Normativa-colombiana-MCP)`

// --- ritmo ---------------------------------------------------------------

/**
 * Una petición por segundo por dominio, sin ráfagas.
 *
 * Ningún portal declara `Crawl-delay`, así que la cifra es criterio propio. La
 * capacidad vale 1 —no 5— porque el lote de citas y las pestañas de la Unidad
 * de Víctimas encadenan varias peticiones a la MISMA fuente en una sola
 * interacción: el techo sostenido ya era 1/s con la ráfaga de 5, pero la ráfaga
 * convierte ese techo en "primera consulta instantánea, después 1/s", y con
 * varios lotes en paralelo (dos clientes del MCP) la ráfaga se repite por
 * cubo. El costo es una demora de 1 s en la primera petición de cada lote.
 *
 * Lo que de verdad impide apilar carga sobre un servicio público es la
 * serialización: una sola petición en vuelo por dominio.
 */
const CAPACIDAD = 1
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

/**
 * Timestamps en que cada petición de `host` recibió su ficha (cuando salió de
 * la cola), para que las pruebas verifiquen el espaciado sin tocar la red.
 */
const despegues = new Map<string, number[]>()

/** Timestamps de salida de `host` en el orden en que ocurrieron. */
export function ritmoPorDominio(host: string): number[] {
  return [...(despegues.get(host) ?? [])]
}

/**
 * Serializa por dominio: nunca hay dos peticiones simultáneas al mismo sitio,
 * y cada una espera su ficha (1/s sostenido) antes de salir a la red.
 * Exportada para que las pruebas midan el ritmo con un `pedir` mockeado.
 */
export async function enCola<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const previa = colas.get(host) ?? Promise.resolve()
  const tarea = previa.then(async () => {
    await ficha(host)
    despegues.set(host, [...(despegues.get(host) ?? []), Date.now()])
    return fn()
  })
  colas.set(
    host,
    tarea.catch(() => {}),
  )
  return tarea
}

// --- circuit breaker por host -------------------------------------------

/**
 * Tres fallos seguidos (error de red o 5xx) en una ventana marcan el host
 * "degradado" durante 60 s: las llamadas en ese tramo ni tocan la red y
 * lanzan un error que declara cuándo se vuelve a intentar. Al vencer la
 * ventana se reintenta y, si acierta, el host se restablece.
 */
const DEGRADADO_MS = 60_000
const UMBRAL_FALLOS = 3

type Breaker = { fallos: number; desde: number; hasta: number | null }
const breakers = new Map<string, Breaker>()

function breaker(host: string): Breaker {
  let b = breakers.get(host)
  if (!b) {
    b = { fallos: 0, desde: Date.now(), hasta: null }
    breakers.set(host, b)
  }
  return b
}

/** Estado declarado de un host: si está degradado y cuándo se vuelve a intentar. */
export function estadoDe(host: string): { degradado: boolean; reintentaEnMs?: number } {
  const b = breaker(host)
  const ahora = Date.now()
  if (b.hasta !== null && ahora >= b.hasta) {
    b.fallos = 0
    b.desde = ahora
    b.hasta = null
  }
  return b.hasta === null ? { degradado: false } : { degradado: true, reintentaEnMs: b.hasta - ahora }
}

/** Anota un fallo de red o 5xx y devuelve el estado resultante del host. */
export function anotarFallo(host: string): void {
  const b = breaker(host)
  const ahora = Date.now()
  if (b.hasta !== null && ahora >= b.hasta) {
    b.fallos = 0
    b.desde = ahora
    b.hasta = null
  }
  b.fallos += 1
  if (b.fallos >= UMBRAL_FALLOS) {
    b.hasta = ahora + DEGRADADO_MS
    b.fallos = 0
  }
}

/** Marca el host como sano tras una petición que sí respondió. */
export function restablecer(host: string): void {
  breakers.delete(host)
}

/** Error con el que se corta la llamada mientras el host está degradado. */
export function errorDegradado(host: string, reintentaEnMs: number): Error {
  return new Error(
    `La fuente ${host} está degradada; reintentando en ${Math.max(1, Math.round(reintentaEnMs / 1000))} s.`,
  )
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

  // Fuente degradada: no se pega a la red, se declara el estado y cuándo
  // reintentar. Las excepciones del breaker no entran en el circuito de
  // reintentos por 429/503, que solo se alimenta de respuestas reales.
  const est = estadoDe(host)
  if (est.degradado) throw errorDegradado(host, est.reintentaEnMs!)

  for (let intento = 0; ; intento++) {
    const t0 = Date.now()
    const r = await enCola(host, () => crudo(url, timeout, accept, extra, cuerpo))
    if (process.env['MEDIR_RED']) {
      process.stderr.write(
        `${JSON.stringify({ red: Date.now() - t0, host, status: r.status, bytes: r.datos.length, ts: new Date().toISOString() })}\n`,
      )
    }

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
    // 5xx: cuenta para el breaker, que tras tres seguidos corta sin pegar a la red.
    if (r.status >= 500) {
      anotarFallo(host)
      throw new Error(`El portal respondió ${r.status}.`)
    }

    restablecer(host)
    anotarRed(r.datos.length)
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
  const est = estadoDe(host)
  if (est.degradado) throw errorDegradado(host, est.reintentaEnMs!)
  try {
    const r = await enCola(host, () => crudo(url, timeout, accept, {}))
    if (r.status >= 500) anotarFallo(host)
    else restablecer(host)
    anotarRed(r.datos.length)
    return { status: r.status, datos: r.datos, contentType: r.contentType }
  } catch (e) {
    // Fallo de red (no una respuesta): cuenta para el breaker.
    if (!(e instanceof Error && /degradada/.test(e.message))) anotarFallo(host)
    throw e
  }
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
