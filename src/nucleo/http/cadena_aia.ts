import { X509Certificate } from 'node:crypto'

const MAX_ESLABONES = 4
const EMISORES_AIA = /CA Issuers - URI:(\S+)/

export type DescargarIntermedio = (url: URL) => Promise<Buffer>

export type OpcionesCadena = {
  raices: readonly X509Certificate[]
  descargar: DescargarIntermedio
  ahora: Date
}

const estaVigente = (c: X509Certificate, ahora: Date): boolean =>
  new Date(c.validFrom) <= ahora && ahora <= new Date(c.validTo)

function firmadoPor(c: X509Certificate, emisor: X509Certificate, ahora: Date): boolean {
  return c.checkIssued(emisor) && c.verify(emisor.publicKey) && estaVigente(emisor, ahora)
}

/**
 * Dónde dice la hoja que está su emisor. Solo http hacia un nombre de dominio
 * público: el certificado lo presenta el servidor ANTES de que nadie lo haya
 * verificado, así que una IP, `localhost` o un nombre sin punto convertirían la
 * descarga en una petición a la red del usuario. La integridad no depende del
 * canal: lo bajado solo se acepta si lo firma una raíz de Node.
 */
export function urlDelEmisor(c: X509Certificate): URL | null {
  const declarada = EMISORES_AIA.exec(c.infoAccess ?? '')?.[1]
  if (!declarada) return null
  if (!URL.canParse(declarada)) return null
  const url = new URL(declarada)
  const { hostname } = url
  const esNombreDePublico = hostname.includes('.') && !hostname.includes(':') && !/^[\d.]+$/.test(hostname)
  return url.protocol === 'http:' && esNombreDePublico ? url : null
}

export function leerCertificado(bytes: Buffer): X509Certificate | null {
  try {
    return new X509Certificate(bytes)
  } catch {
    return null
  }
}

/**
 * Los intermedios que faltan entre `hoja` y una raíz de `raices`, del más
 * cercano a la hoja al más cercano a la raíz. Lista vacía: la hoja ya cierra
 * con una raíz y no falta nada. `null`: no se pudo cerrar la cadena con
 * eslabones que verifiquen, y no se añade nada de lo bajado.
 *
 * Los eslabones acaban como anclas de confianza en la lista `ca` de TLS, y Node
 * no mira de quién cuelgan: por eso cada uno se verifica aquí, firma incluida,
 * contra la raíz o el eslabón anterior. O(MAX_ESLABONES) descargas.
 */
export async function completarCadena(hoja: X509Certificate, opciones: OpcionesCadena): Promise<X509Certificate[] | null> {
  const { raices, descargar, ahora } = opciones
  const eslabones: X509Certificate[] = []
  let actual = hoja
  for (let i = 0; i < MAX_ESLABONES; i++) {
    if (raices.some((raiz) => firmadoPor(actual, raiz, ahora))) return eslabones
    const url = urlDelEmisor(actual)
    if (!url) return null
    const candidato = leerCertificado(await descargar(url))
    if (!candidato || !candidato.ca || !firmadoPor(actual, candidato, ahora)) return null
    eslabones.push(candidato)
    actual = candidato
  }
  return null
}
