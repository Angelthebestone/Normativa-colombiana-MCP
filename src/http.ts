import { request } from 'node:https'
import { rootCertificates } from 'node:tls'
import { createGunzip, createInflate } from 'node:zlib'
import { SECTIGO_EV, SECTIGO_OV } from './ca.ts'

/**
 * Raíces de Node más los intermedios que funcionpublica.gov.co y
 * suin-juriscol.gov.co omiten. La verificación del certificado sigue ACTIVA:
 * solo se completa una cadena que el servidor envía incompleta. Nunca usar
 * rejectUnauthorized:false — este MCP entrega información legal y la
 * autenticidad de la fuente es parte del producto.
 */
const CA = [...rootCertificates, SECTIGO_OV, SECTIGO_EV]

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

export type Respuesta = { status: number; cuerpo: string }

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

type Cruda = { status: number; datos: Buffer; contentType: string; retryAfter: string }

function crudo(url: string, timeout: number, accept: string, extra: Record<string, string>): Promise<Cruda> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { ca: CA, timeout, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Encoding': 'gzip, deflate', ...extra } },
      (res) => {
        const enc = String(res.headers['content-encoding'] ?? '')
        const flujo = enc === 'gzip' ? res.pipe(createGunzip()) : enc === 'deflate' ? res.pipe(createInflate()) : res
        const trozos: Buffer[] = []
        flujo.on('data', (c: Buffer) => trozos.push(c))
        flujo.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            datos: Buffer.concat(trozos),
            contentType: String(res.headers['content-type'] ?? ''),
            retryAfter: String(res.headers['retry-after'] ?? ''),
          }),
        )
        flujo.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`tiempo de espera agotado tras ${timeout} ms`)))
    req.on('error', reject)
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
): Promise<Respuesta> {
  const host = new URL(url).host

  for (let intento = 0; ; intento++) {
    const r = await enCola(host, () => crudo(url, timeout, accept, extra))

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

    return { status: r.status, cuerpo: decodificar(r.datos, r.contentType) }
  }
}
