import { AsyncLocalStorage } from 'node:async_hooks'
import { request } from 'node:https'
import { pipeline } from 'node:stream'
import { rootCertificates } from 'node:tls'
import { createGunzip, createInflate } from 'node:zlib'
import { GLOBALSIGN_OV, GODADDY_G2, SECTIGO_EV, SECTIGO_OV } from './ca.ts'
import {
  cabecerasCondicionales,
  esDescargaCacheable,
  guardarCopia,
  identidadDeNorma,
  obtenerCopia,
  refrescarCopia,
  ttlDeNorma,
  type Copia,
} from './cache.ts'
import { diagnosticarRespuesta, fechaCorta, rotuloCopia } from './portal-roto.ts'

/**
 * Raíces de Node más los intermedios que funcionpublica.gov.co,
 * suin-juriscol.gov.co, sic.gov.co y corteconstitucional.gov.co omiten. La
 * verificación del certificado sigue ACTIVA: solo se completa una cadena que
 * el servidor envía incompleta.
 * Nunca usar rejectUnauthorized:false — este MCP entrega información legal y
 * la autenticidad de la fuente es parte del producto.
 */
const CA = [...rootCertificates, SECTIGO_OV, SECTIGO_EV, GLOBALSIGN_OV, GODADDY_G2]

/**
 * Contadores de red del proceso: peticiones, bytes, URLs repetidas y copias
 * servidas sin salir a la red. Los repetidos se cuentan por URL, que es como se
 * mide cuánto se vuelve a descargar la misma norma en una sesión.
 */
let totalPeticiones = 0
let totalBytes = 0
let totalCopias = 0
let totalRepetidas = 0
const pedidas = new Map<string, number>()

export function redResumen(): { peticiones: number; bytes: number; repetidas: number; copias: number } {
  return { peticiones: totalPeticiones, bytes: totalBytes, repetidas: totalRepetidas, copias: totalCopias }
}

function anotarRed(bytes: number): void {
  totalPeticiones += 1
  totalBytes += bytes
}

/** Una URL que ya se había pedido en este proceso: la métrica de lo repetido. */
function anotarUrl(url: string): void {
  const n = (pedidas.get(url) ?? 0) + 1
  pedidas.set(url, n)
  if (n > 1) totalRepetidas += 1
}

/** esbuild la sustituye desde package.json; sin empaquetar no existe. */
declare const __VERSION__: string | undefined
export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev'

const UA = `normativa-colombia-mcp/${VERSION} (+https://github.com/Angelthebestone/Normativa-colombiana-MCP)`

/**
 * Seams de diagnóstico, apagados por defecto (nadie los define en producción):
 * `FUENTE_CAIDA=host[,host]` hace fallar ese host como si el portal estuviera
 * caído —es la única forma de verificar que la respuesta degradada va rotulada,
 * porque los portales públicos no se caen cuando una prueba los necesita— y
 * `TTL_COPIA_MS=n` fuerza el TTL de las copias, para no esperar horas a que
 * venzan.
 */
const caidaForzada = (host: string): boolean => (process.env['FUENTE_CAIDA'] ?? '').split(',').includes(host)

/** TTL de la copia: el de la clase de norma, salvo que se fije por opción o seam. */
function ttlDe(url: string, texto: string, fecha: number, explicito?: number): number {
  if (explicito !== undefined) return explicito
  const bruto = process.env['TTL_COPIA_MS']
  const forzado = bruto === undefined ? Number.NaN : Number(bruto)
  if (Number.isFinite(forzado)) return forzado
  const ident = identidadDeNorma(url, texto.slice(0, 8000))
  return ttlDeNorma(ident.tipo, ident.anio, fecha)
}

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
  /** El cuerpo salió de una copia en memoria: no se pidió a la fuente. */
  deCache?: boolean
  /** La fuente contestó 304: la copia sigue vigente, comprobado, no supuesto. */
  revalidada?: boolean
  /** La fuente no respondió y se sirvió una copia: el llamador DEBE rotularlo. */
  degradada?: boolean
  /** Epoch ms de la consulta a la fuente que produjo el texto servido. */
  fechaCopia?: number
  /** Texto listo para pegar delante de la respuesta; vacío si no hay nada que decir. */
  avisoCopia?: string
  /** La fuente reenvió el documento y el texto ya no es el de la copia anterior. */
  cambio?: boolean
}

/**
 * Opciones de `pedir`. Van aparte de los argumentos posicionales para no tocar
 * las cuarenta llamadas que ya existen.
 */
export type OpcionesPedir = {
  /** TTL explícito de la copia; si no, sale del tipo y el año de la norma. */
  ttlMs?: number
  /**
   * Si la fuente no responde y hay copia, devolver la copia con su rótulo en vez
   * de fallar. Apagado por defecto **a propósito**: entregar una copia que el
   * llamador no va a rotular es peor que devolver un vacío.
   */
  degradarDesdeCopia?: boolean
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

// --- presupuesto de tiempo por llamada -----------------------------------

/**
 * Presupuesto de tiempo de UNA llamada a herramienta, propagado por contexto
 * asíncrono para no pasarlo de mano en mano por cuarenta firmas.
 *
 * Justificación medida (2026-09-16, `scripts/medir.ts --recorridos`): el paso
 * más lento de los ocho recorridos fue un `obtener_documento` de 3.845 ms y el
 * p95 de los diez y nueve pasos quedó por debajo de 4 s; lo caro de verdad son
 * la búsqueda de la DIAN (~20 s por el diseño de su endpoint, no admite tope) y
 * el Decreto 1083 (~8 s). Un techo de 45 s deja entrar ambos con holgura y corta
 * el caso que el usuario no tolera: minuto y medio de espera para acabar en
 * error, habiendo podido devolver lo que ya estaba reunido.
 */
const presupuesto = new AsyncLocalStorage<number>()

export class PresupuestoAgotado extends Error {
  constructor(ms: number) {
    super(
      `Se agotó el presupuesto de ${Math.round(ms / 1000)} s para esta llamada: ` +
        `se cortó para no hacer esperar más a cambio de nada. ` +
        `Vuelve a pedirlo con menos pasos o más estrecho (un artículo, una fuente).`,
    )
    this.name = 'PresupuestoAgotado'
  }
}

/** Corre `fn` con `ms` de presupuesto para todas las peticiones que lance. */
export function conPresupuesto<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return presupuesto.run(Date.now() + ms, fn)
}

/** Ms que quedan del presupuesto en curso, o null si no hay ninguno puesto. */
export function presupuestoRestante(): number | null {
  const hasta = presupuesto.getStore()
  return hasta === undefined ? null : hasta - Date.now()
}

/** Recorta el `timeout` de una petición a lo que queda de presupuesto. */
function timeoutEfectivo(timeout: number): number {
  const queda = presupuestoRestante()
  if (queda === null) return timeout
  if (queda <= 0) throw new PresupuestoAgotado(0)
  return Math.max(1000, Math.min(timeout, queda))
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
  if (caidaForzada(new URL(url).host)) {
    return Promise.reject(new Error('FUENTE_CAIDA: host marcado como caído por el seam de diagnóstico'))
  }
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
  opciones: OpcionesPedir = {},
): Promise<Respuesta> {
  const host = new URL(url).host
  const esGet = cuerpo === undefined
  anotarUrl(url)

  // La copia se mira antes que el breaker: si el texto ya está y sigue fresco,
  // no hay motivo para hablar con nadie.
  const copia = esGet ? obtenerCopia(url) : null
  const desdeCopia = (c: Copia, degradada: boolean, revalidada: boolean): Respuesta => {
    totalCopias += 1
    return {
      status: c.status,
      cuerpo: c.cuerpo,
      cookies: '',
      cabeceras: c.cabeceras,
      deCache: true,
      ...(degradada ? { degradada: true } : {}),
      ...(revalidada ? { revalidada: true } : {}),
      fechaCopia: c.fecha,
      avisoCopia: degradada
        ? rotuloCopia(host, c.fecha)
        : `(servido de una copia consultada el ${fechaCorta(c.fecha)}, sin volver a la fuente)`,
    }
  }

  if (copia && Date.now() < copia.vence) return desdeCopia(copia, false, false)

  // Degradar es opt-in: el que sirve la copia es quien tiene que rotularla, y
  // `pedir` no puede saber si su llamador lo hará.
  const degradarO = (): Respuesta | null =>
    copia && opciones.degradarDesdeCopia ? desdeCopia(copia, true, false) : null

  // Fuente degradada: no se pega a la red, se declara el estado y cuándo
  // reintentar. Las excepciones del breaker no entran en el circuito de
  // reintentos por 429/503, que solo se alimenta de respuestas reales.
  const est = estadoDe(host)
  if (est.degradado) {
    const d = degradarO()
    if (d) return d
    throw errorDegradado(host, est.reintentaEnMs!)
  }

  for (let intento = 0; ; intento++) {
    const t0 = Date.now()
    const condicionales = copia ? cabecerasCondicionales(copia) : {}
    let r: Cruda
    try {
      r = await enCola(host, () =>
        crudo(url, timeoutEfectivo(timeout), accept, { ...extra, ...condicionales }, cuerpo),
      )
    } catch (e) {
      const d = degradarO()
      if (d) return d
      throw e
    }
    if (process.env['MEDIR_RED']) {
      process.stderr.write(
        `${JSON.stringify({ red: Date.now() - t0, host, url, status: r.status, bytes: r.datos.length, copia: Boolean(copia), ts: new Date().toISOString() })}\n`,
      )
    }

    // 304: la copia sigue vigente, y eso está comprobado, no supuesto. Se le
    // pone la fecha de hoy porque es la que el usuario va a leer; el cuerpo es
    // el mismo y por eso la respuesta no cambia.
    if (r.status === 304 && copia) {
      restablecer(host)
      anotarRed(0)
      const fecha = Date.now()
      refrescarCopia(url, fecha, fecha + ttlDe(url, copia.cuerpo, fecha, opciones.ttlMs))
      return desdeCopia({ ...copia, fecha }, false, true)
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
      const d = degradarO()
      if (d) return d
      throw new Error(
        `El portal está limitando las consultas (${r.status}). Espera un momento y vuelve a intentarlo.`,
      )
    }

    const texto = decodificar(r.datos, r.contentType)
    // Un portal que se apunta a sí mismo (el 301 de SUIN) o que sirve su página
    // de mantenimiento no está respondiendo, aunque el código HTTP no lo diga:
    // cuenta para el breaker igual que un 5xx. La respuesta se devuelve tal cual
    // —la fuente decide qué hacer con un 301— pero el host queda marcado.
    const diag = diagnosticarRespuesta(url, r.status, r.cabeceras, texto)
    if (r.status >= 500 || diag.roto) {
      anotarFallo(host)
    } else {
      restablecer(host)
    }
    if (r.status >= 500) {
      const d = degradarO()
      if (d) return d
      throw new Error(`El portal respondió ${r.status}.`)
    }

    anotarRed(r.datos.length)
    const resp: Respuesta = { status: r.status, cuerpo: texto, cookies: r.cookies, cabeceras: r.cabeceras }

    // Solo se guardan documentos: congelar una búsqueda escondería lo que se
    // publique después.
    if (esGet && esDescargaCacheable(url, 'GET', r.contentType)) {
      const fecha = Date.now()
      if (copia && copia.cuerpo !== texto) resp.cambio = true
      guardarCopia(url, {
        cuerpo: texto,
        status: r.status,
        cabeceras: r.cabeceras,
        fecha,
        vence: fecha + ttlDe(url, texto, fecha, opciones.ttlMs),
      })
    }
    return resp
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
    const r = await enCola(host, () => crudo(url, timeoutEfectivo(timeout), accept, {}))
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
