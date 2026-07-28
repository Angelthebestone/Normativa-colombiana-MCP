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

export const UA = 'normativa-colombia-mcp/1.0 (+https://github.com/anfepena/normativa-colombia-mcp)'

export type Respuesta = { status: number; cuerpo: string }

export function pedir(url: string, timeout = 60_000, accept = 'text/html,*/*'): Promise<Respuesta> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      { ca: CA, timeout, headers: { 'User-Agent': UA, Accept: accept, 'Accept-Encoding': 'gzip, deflate' } },
      (res) => {
        const enc = String(res.headers['content-encoding'] ?? '')
        const flujo = enc === 'gzip' ? res.pipe(createGunzip()) : enc === 'deflate' ? res.pipe(createInflate()) : res
        const trozos: Buffer[] = []
        flujo.on('data', (c: Buffer) => trozos.push(c))
        flujo.on('end', () => resolve({ status: res.statusCode ?? 0, cuerpo: Buffer.concat(trozos).toString('utf8') }))
        flujo.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error(`tiempo de espera agotado tras ${timeout} ms`)))
    req.on('error', reject)
    req.end()
  })
}
