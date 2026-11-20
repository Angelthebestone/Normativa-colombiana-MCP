import { X509Certificate } from 'node:crypto'
import { connect, rootCertificates } from 'node:tls'
import {
  GLOBALSIGN_OV,
  GODADDY_G2,
  SECTIGO_EV,
  SECTIGO_OV,
  SECTIGO_OV_R36,
  SSLCOM_TLS_ISSUING_R1,
} from '../ca.ts'
import { LETSENCRYPT_ROOT_YR_CRUZADA, LETSENCRYPT_YR1 } from '../ca_letsencrypt.ts'
import { completarCadena, leerCertificado, type DescargarIntermedio } from './cadena_aia.ts'

const PLAZO_SONDEO_MS = 8_000
const REINTENTO_POR_HOST_MS = 5 * 60_000

/**
 * Respaldo para cuando el intermedio no se puede bajar (una red que bloquea HTTP
 * plano): lo normal es que `aprenderCadena` lo encuentre solo. Nunca usar
 * rejectUnauthorized:false en una petición — este MCP entrega información legal
 * y la autenticidad de la fuente es parte del producto.
 */
let vigentes: string[] = [
  ...rootCertificates,
  SECTIGO_OV,
  SECTIGO_OV_R36,
  SECTIGO_EV,
  GLOBALSIGN_OV,
  GODADDY_G2,
  SSLCOM_TLS_ISSUING_R1,
  LETSENCRYPT_YR1,
  LETSENCRYPT_ROOT_YR_CRUZADA,
]

export const autoridades = (): string[] => vigentes

let raicesDeNode: X509Certificate[] | undefined
const raices = (): X509Certificate[] => (raicesDeNode ??= rootCertificates.map((pem) => new X509Certificate(pem)))

/**
 * El certificado que el portal presenta, para saber dónde declara su emisor.
 * No envía ni recibe datos y se cierra al leerlo; lo único que se usa de él es
 * esa URL, y nada de lo que lleve se da por bueno hasta que lo firme una raíz
 * de Node (`completarCadena`). Por eso es el único sitio donde la verificación
 * se desactiva.
 */
function leerHoja(host: string, puerto: number): Promise<X509Certificate | null> {
  return new Promise((resolve) => {
    const socket = connect({ host, port: puerto, servername: host, rejectUnauthorized: false, timeout: PLAZO_SONDEO_MS })
    const terminar = (hoja: X509Certificate | null): void => {
      socket.destroy()
      resolve(hoja)
    }
    socket.once('secureConnect', () => {
      const { raw } = socket.getPeerCertificate()
      terminar(raw ? leerCertificado(raw) : null)
    })
    socket.once('error', () => terminar(null))
    socket.once('timeout', () => terminar(null))
  })
}

async function aprender(host: string, puerto: number, descargar: DescargarIntermedio): Promise<boolean> {
  const hoja = await leerHoja(host, puerto)
  if (!hoja) return false
  const eslabones = await completarCadena(hoja, { raices: raices(), descargar, ahora: new Date() }).catch(() => null)
  const nuevos = (eslabones ?? []).map((e) => e.toString()).filter((pem) => !vigentes.includes(pem))
  if (!nuevos.length) return false
  vigentes = [...vigentes, ...nuevos]
  process.stderr.write(`${JSON.stringify({ evento: 'cadena_completada', host, eslabones: nuevos.length })}\n`)
  return true
}

const intentos = new Map<string, { resultado: Promise<boolean>; cuando: number }>()

/**
 * Completa la cadena de `host` con los intermedios que su certificado declara
 * (extensión AIA) y devuelve si añadió alguno. Un intento por host cada cinco
 * minutos: las peticiones simultáneas comparten el mismo, y un portal que no se
 * deja completar no se vuelve a sondear en cada llamada.
 */
export function aprenderCadena(host: string, puerto: number, descargar: DescargarIntermedio): Promise<boolean> {
  const previo = intentos.get(host)
  if (previo && Date.now() - previo.cuando < REINTENTO_POR_HOST_MS) return previo.resultado
  const resultado = aprender(host, puerto, descargar)
  intentos.set(host, { resultado, cuando: Date.now() })
  return resultado
}
