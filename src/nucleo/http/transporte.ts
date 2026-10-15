import { request as pedirHttps } from 'node:https'
import { pipeline, type Readable } from 'node:stream'
import { rootCertificates } from 'node:tls'
import { createGunzip, createInflate } from 'node:zlib'
import { GLOBALSIGN_OV, GODADDY_G2, SECTIGO_EV, SECTIGO_OV, SSLCOM_TLS_ISSUING_R1 } from '../ca.ts'

/**
 * Raíces de Node más los intermedios que funcionpublica.gov.co,
 * suin-juriscol.gov.co, sic.gov.co, corteconstitucional.gov.co y
 * svrpubindc.imprenta.gov.co omiten. La verificación del certificado sigue
 * ACTIVA: solo se completa una cadena que el servidor envía incompleta.
 * Nunca usar rejectUnauthorized:false — este MCP entrega información legal y
 * la autenticidad de la fuente es parte del producto.
 */
const CA = [...rootCertificates, SECTIGO_OV, SECTIGO_EV, GLOBALSIGN_OV, GODADDY_G2, SSLCOM_TLS_ISSUING_R1]

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

export type Cruda = {
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
 *
 * `tope` limita los bytes YA descomprimidos, que son los que ocupan memoria: un
 * gzip de 100 KB puede expandirse a gigas. Al pasarlo se destruye el flujo (y
 * con él el socket) y se rechaza con `TopeExcedido`. Si el `content-length`
 * declarado ya lo supera, se corta sin leer nada.
 */
export function cuerpoDe(res: Readable & { headers: Record<string, unknown> }, tope: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declarado = Number(res.headers['content-length'])
    if (declarado > tope) {
      res.destroy()
      reject(new TopeExcedido(tope, declarado))
      return
    }
    const enc = String(res.headers['content-encoding'] ?? '')
    const descompresor = enc === 'gzip' ? createGunzip() : enc === 'deflate' ? createInflate() : null
    const flujo: Readable = descompresor ? pipeline(res, descompresor, (e) => e && reject(e)) : res
    const trozos: Buffer[] = []
    let leidos = 0
    flujo.on('data', (c: Buffer) => {
      leidos += c.length
      if (leidos > tope) {
        flujo.destroy()
        res.destroy()
        reject(new TopeExcedido(tope, leidos))
        return
      }
      trozos.push(c)
    })
    flujo.on('end', () => resolve(Buffer.concat(trozos)))
    flujo.on('error', reject)
  })
}

/**
 * Topes de cuerpo por clase de recurso. Lo más grande medido: 10,7 MB de HTML
 * (`conceptosfp.php` del Gestor) y 15 MB de PDF (el Diario Oficial del 23/09);
 * los topes dejan el triple de margen y siguen lejos de tumbar el proceso.
 */
export const TOPE_TEXTO = 32 * 1024 * 1024
export const TOPE_BINARIO = 64 * 1024 * 1024

/** La fuente mandó más de lo que el transporte acepta guardar en memoria. No es un fallo del host. */
export class TopeExcedido extends Error {
  readonly tope: number
  readonly bytes: number
  constructor(tope: number, bytes: number) {
    super(
      `La respuesta supera el tope de ${Math.round(tope / 1024 / 1024)} MB (se cortó al llegar a ` +
        `${(bytes / 1024 / 1024).toFixed(1)} MB) y no se descargó entera.`,
    )
    this.name = 'TopeExcedido'
    this.tope = tope
    this.bytes = bytes
  }
}

export async function crudo(
  url: string,
  timeout: number,
  accept: string,
  extra: Record<string, string>,
  tope: number,
  cuerpo?: string,
): Promise<Cruda> {
  if (caidaForzada(new URL(url).host)) {
    return Promise.reject(new Error('FUENTE_CAIDA: host marcado como caído por el seam de diagnóstico'))
  }
  // El Senado solo habla HTTP plano (su puerto 443 no abre, comprobado el 2026-09-28): el mismo
  // transporte, con su ritmo por dominio, reintentos y decodificación, sirve para las dos.
  // `node:http` se importa aquí y no arriba: un `import` estático hace que Node lea todos sus
  // exports al arrancar, y algunos (WebSocket, MessageEvent) cargan `undici` entero, que solo
  // hace falta para el Senado.
  const request = url.startsWith('http:') ? (await import('node:http')).request : pedirHttps
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
        cuerpoDe(res, tope).then(
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
