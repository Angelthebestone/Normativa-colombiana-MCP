/**
 * Descarga un documento a disco con el transporte de `http.ts`, sin
 * sobrescribir silenciosamente y con un nombre de archivo derivado de la URL.
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pedirBytes } from './http.ts'

export type ResultadoDescarga = { rutaAbsoluta: string; bytes: number }

/** Extensión que se añade cuando el nombre del pathname no trae ninguna. */
const EXTENSION_POR_TIPO: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/html': '.html',
}

const extSegunTipo = (contentType: string): string =>
  EXTENSION_POR_TIPO[contentType.split(';')[0]!.trim().toLowerCase()] ?? ''

/** Caracteres de control: no pueden ir en un nombre de archivo. */
// eslint-disable-next-line no-control-regex -- el rango de control es el objetivo
const CONTROL = new RegExp('[\u0000-\u001f\u007f]', 'g')

/**
 * Nombre de archivo derivado del pathname de la URL: sin separadores, sin
 * `..`, sin caracteres de control ni espacios, y con extensión según el tipo
 * cuando la URL no la trae. Nunca devuelve vacío ni empieza por punto.
 */
export function nombreSeguro(url: string, contentType = ''): string {
  let bruto: string
  try {
    bruto = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    return 'archivo' // URL sin nombre aprovechable (o codificación rota)
  }
  const limpio = bruto
    .replace(/[\\/]/g, '_')
    .replace(/\.\./g, '_')
    .replace(CONTROL, '_')
    .replace(/[ ]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .replace(/^_+|_+$/g, '')
    .slice(0, 120)
  if (!limpio) return 'archivo'
  return /\.\w+$/.test(limpio) ? limpio : limpio + extSegunTipo(contentType)
}

const existe = async (ruta: string): Promise<boolean> => {
  try {
    await access(ruta)
    return true
  } catch {
    return false
  }
}

/** Nombre con sufijo numérico que no exista en disco: `norma.pdf` → `norma_1.pdf`. */
async function sinColision(archivo: string): Promise<string> {
  const sinExt = archivo.replace(/\.\w+$/, '')
  const ext = archivo.slice(sinExt.length)
  let sufijo = 0
  for (;;) {
    const candidato = sufijo === 0 ? archivo : `${sinExt}_${sufijo}${ext}`
    if (!(await existe(candidato))) return candidato
    sufijo++
  }
}

/**
 * Descarga `url` a `ruta` (directorio) con `pedirBytes` y devuelve la ruta
 * absoluta del archivo escrito y su tamaño. Valida que `url` sea del origen
 * permitido antes de tocar nada; crea el directorio si no existe y, si el
 * archivo ya está, escribe en un nombre con sufijo (`_1`, `_2`…).
 *
 * `pedirBytes` es inyectable para probar sin red ni TLS.
 */
export async function descargarA(
  dominioPermitido: string,
  url: string,
  ruta: string,
  deps: { pedirBytes?: typeof pedirBytes } = {},
): Promise<ResultadoDescarga> {
  let dominio: URL
  try {
    dominio = new URL(url)
  } catch {
    throw new Error(`URL inválida para descargar: ${url}.`)
  }
  if (dominio.origin !== new URL(dominioPermitido).origin) {
    throw new Error(`No se puede descargar de ${dominio.origin}: el dominio permitido es ${dominioPermitido}.`)
  }

  const descargar = deps.pedirBytes ?? pedirBytes
  const r = await descargar(url)
  if (r.status !== 200) throw new Error(`La descarga de ${url} respondió ${r.status}.`)

  try {
    await mkdir(ruta, { recursive: true })
  } catch (e) {
    throw new Error(`No se pudo crear el directorio de descarga ${ruta}: ${(e as Error).message}.`)
  }
  // Con el directorio ya creado, un error aquí significa que no se puede escribir.
  try {
    await writeFile(join(ruta, '.prueba-escritura'), Buffer.from(''))
  } catch (e) {
    throw new Error(`No se puede escribir en ${ruta}: ${(e as Error).message}.`)
  }

  const rutaFinal = await sinColision(join(ruta, nombreSeguro(url, r.contentType)))
  await writeFile(rutaFinal, r.datos)
  return { rutaAbsoluta: resolve(rutaFinal), bytes: r.datos.length }
}
