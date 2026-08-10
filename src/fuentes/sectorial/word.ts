/**
 * Extracción best-effort del texto de un documento Word sectorial.
 *
 * Un `.docx` es un ZIP con `word/document.xml`: se lee el directorio central con
 * un lector ZIP mínimo y se infla con `node:zlib` (built-in, cero dependencias).
 * El `.doc` binario (OLE2) no tiene decodificador aquí (deuda abierta): se
 * devuelve `sinTexto`. Como `pdf.ts`, no cambia el contrato —el adaptador sigue
 * declarando `soportaTexto=false`—, solo permite que la respuesta traiga texto
 * cuando el documento lo permite.
 */
import { inflateRaw } from 'node:zlib'
import { pedirBytes } from '../../nucleo/http.ts'
import type { Adaptador } from '../sectorial.ts'

export type TextoWord = { texto: string; url: string } | { sinTexto: true; url: string }

// --- lector ZIP mínimo ----------------------------------------------------

/** El formato se decide por contenido: las firmas de ZIP y de OLE2 (.doc). */
const esZip = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04
const esOle2 = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0

const leerAscii = (bytes: Uint8Array, desde: number, largo: number): string =>
  new TextDecoder('latin1').decode(bytes.subarray(desde, desde + largo))

/**
 * Fin de directorio central: se escanea hacia atrás porque el comentario del
 * ZIP puede medir hasta 64 KB y desplazar la firma del final del archivo.
 */
function finZip(v: DataView, largo: number): { offCentral: number; tamCentral: number } {
  const tope = Math.max(0, largo - 65557)
  for (let i = largo - 22; i >= tope; i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      return { offCentral: v.getUint32(i + 16, true), tamCentral: v.getUint32(i + 12, true) }
    }
  }
  throw new Error('el archivo no es un ZIP válido (sin fin de directorio central)')
}

/** Los bytes de la entrada `word/document.xml`, sin desinflar. */
function entradaDocumento(bytes: Uint8Array): { datos: Uint8Array; metodo: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const { offCentral, tamCentral } = finZip(v, bytes.length)
  const limite = offCentral + tamCentral
  let p = offCentral
  while (p + 46 <= limite) {
    if (v.getUint32(p, true) !== 0x02014b50) break // no es una entrada del directorio central
    const nlen = v.getUint16(p + 28, true)
    const elen = v.getUint16(p + 30, true)
    const clen = v.getUint16(p + 32, true)
    if (leerAscii(bytes, p + 46, nlen) === 'word/document.xml') {
      const metodo = v.getUint16(p + 10, true)
      if (metodo !== 0 && metodo !== 8) throw new Error(`método de compresión ${metodo} no soportado`)
      const comprimido = v.getUint32(p + 20, true)
      const offLocal = v.getUint32(p + 42, true)
      // El tamaño del directorio central manda aunque la cabecera local use
      // data descriptors (bandera bit 3), donde los tamaños van en cero.
      if (offLocal + 30 > bytes.length || v.getUint32(offLocal, true) !== 0x04034b50) {
        throw new Error('cabecera local de la entrada inválida')
      }
      const desde = offLocal + 30 + v.getUint16(offLocal + 26, true) + v.getUint16(offLocal + 28, true)
      if (desde + comprimido > bytes.length) throw new Error('entrada truncada')
      return { datos: bytes.subarray(desde, desde + comprimido), metodo }
    }
    p += 46 + nlen + elen + clen
  }
  throw new Error('el ZIP no contiene word/document.xml')
}

const inflar = (datos: Uint8Array): Promise<Uint8Array> =>
  new Promise((resolver, rechazar) =>
    inflateRaw(datos, (error, resultado) => (error ? rechazar(error) : resolver(resultado))),
  )

/**
 * Devuelve el XML de `word/document.xml`. Un ZIP roto o sin esa entrada se
 * trata como documento sin texto extraíble, no como fallo del proceso: el
 * aviso manda al enlace.
 */
async function documentoXml(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { datos, metodo } = entradaDocumento(bytes)
    return metodo === 0 ? datos : await inflar(datos)
  } catch {
    return null // ZIP roto o sin word/document.xml: no hay texto que extraer
  }
}

// --- XML a texto ----------------------------------------------------------

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodificarEntidades(s: string): string {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m, e: string) => {
    if (e.startsWith('#')) {
      const hex = e[1] === 'x' || e[1] === 'X'
      const n = Number.parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
    }
    return ENTIDADES[e] ?? m
  })
}

function xmlATexto(xml: string): string {
  const conSaltos = xml
    // Los códigos de campo (TOC, HYPERLINK…) duplican el resultado visible.
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/gi, ' ')
    .replace(/<w:br\b[^>]*\/>/gi, '\n')
    .replace(/<w:tab\b[^>]*\/>/gi, ' ')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodificarEntidades(conSaltos)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// --- extracción -----------------------------------------------------------

/**
 * Intenta extraer el texto de un documento Word sectorial. Detecta el formato
 * por contenido: ZIP es `.docx` (se lee `word/document.xml`), OLE2 es `.doc`
 * binario y se avisa sin texto. Devuelve el texto crudo sin trocear —el
 * handler aplica `trocear`/`fragmentos`— o `{ sinTexto: true }` cuando no hay
 * nada que extraer. Lanza si el dominio no es el permitido, si la descarga
 * falla o si el contenido no es un documento Word reconocible.
 *
 * `pedirBytes` y `descomprimirZip` son inyectables para probar sin red ni TLS.
 */
export async function extraerTextoWord(
  a: Adaptador,
  url: string,
  deps: {
    pedirBytes?: typeof pedirBytes
    descomprimirZip?: (bytes: Uint8Array) => Promise<Uint8Array | null>
  } = {},
): Promise<TextoWord> {
  const descargar = deps.pedirBytes ?? pedirBytes

  let dominio: URL
  try {
    dominio = new URL(url)
  } catch {
    throw new Error(`Enlace Word inválido: ${url}.`)
  }
  if (dominio.origin !== new URL(a.dominioPermitido).origin) {
    throw new Error(`El enlace Word no pertenece al dominio permitido de ${a.nombre} (${a.dominioPermitido}).`)
  }

  const r = await descargar(
    url,
    120_000,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,*/*',
  )
  if (r.status !== 200) throw new Error(`El documento Word respondió ${r.status}.`)
  const bytes = r.datos

  if (esZip(bytes)) {
    const xml = deps.descomprimirZip ? await deps.descomprimirZip(bytes) : await documentoXml(bytes)
    if (!xml) return { sinTexto: true, url }
    const texto = xmlATexto(new TextDecoder('utf-8').decode(xml))
    if (!texto) return { sinTexto: true, url }
    return { texto, url }
  }
  if (esOle2(bytes)) return { sinTexto: true, url }
  throw new Error(`El documento en ${url} no es un .docx (ZIP) ni un .doc binario (OLE2): no se puede extraer su texto.`)
}
