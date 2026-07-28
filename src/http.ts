import { request } from 'node:https'
import { rootCertificates } from 'node:tls'
import { createGunzip, createInflate } from 'node:zlib'
import { SECTIGO_OV } from './ca.ts'

/**
 * Raíces de Node más el intermedio que funcionpublica.gov.co omite. La
 * verificación del certificado sigue ACTIVA: solo se completa una cadena que el
 * servidor envía incompleta. Nunca usar rejectUnauthorized:false — este MCP
 * entrega información legal y la autenticidad de la fuente es parte del producto.
 */
const CA = [...rootCertificates, SECTIGO_OV]

const UA = 'normativa-colombia-mcp/1.0 (+https://github.com/anfepena/normativa-colombia-mcp)'

/**
 * Máximo dos peticiones por segundo y por dominio. Son portales públicos
 * financiados con impuestos: el MCP debe pesarles menos que una persona
 * navegando, y un ritmo constante evita que un cortafuegos lo tome por abuso.
 */
const MS_ENTRE_PETICIONES = 500
const turnos = new Map<string, Promise<void>>()

function turno(host: string): Promise<void> {
  const anterior = turnos.get(host) ?? Promise.resolve()
  const propio = anterior.then(() => new Promise<void>((r) => setTimeout(r, MS_ENTRE_PETICIONES)))
  turnos.set(host, propio)
  return anterior
}

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

export function pedir(url: string, timeout = 60_000, accept = 'text/html,*/*'): Promise<Respuesta> {
  const host = new URL(url).host
  return turno(host).then(
    () =>
      new Promise<Respuesta>((resolve, reject) => {
        const req = request(
          url,
          { ca: CA, timeout, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Encoding': 'gzip, deflate' } },
          (res) => {
            const enc = String(res.headers['content-encoding'] ?? '')
            const flujo = enc === 'gzip' ? res.pipe(createGunzip()) : enc === 'deflate' ? res.pipe(createInflate()) : res
            const trozos: Buffer[] = []
            flujo.on('data', (c: Buffer) => trozos.push(c))
            flujo.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                cuerpo: decodificar(Buffer.concat(trozos), String(res.headers['content-type'] ?? '')),
              }),
            )
            flujo.on('error', reject)
          },
        )
        req.on('timeout', () => req.destroy(new Error(`tiempo de espera agotado tras ${timeout} ms`)))
        req.on('error', reject)
        req.end()
      }),
  )
}
