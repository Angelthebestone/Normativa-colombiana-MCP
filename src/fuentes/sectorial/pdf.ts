/**
 * Extracción best-effort del texto de un PDF sectorial.
 *
 * Casi todos los reguladores sectoriales publican PDF y declaran
 * `soportaTexto=false`: el epígrafe es lo único que viaja. Pero ~40% de esos
 * PDF son textuales (no escaneos), y `unpdf` —ya en devDependencies y bundlado
 * solo si se importa— puede leerlos. Este helper hace ese intento respetando
 * el dominio permitido del adaptador y el ritmo/CA de `http.ts`.
 *
 * No cambia el contrato: el adaptador sigue declarando `soportaTexto=false`;
 * esto solo permite que la respuesta de lectura traiga texto extraído además
 * del epígrafe cuando el PDF lo permite.
 */
import { avisoSinTexto, pdfEsEscaneo } from '../../nucleo/parse.ts'
import { pedirBytes } from '../../nucleo/http.ts'
import type { Adaptador } from '../sectorial.ts'

export type TextoPdf = { texto: string; url: string } | { escaneo: true; url: string }

/**
 * Intenta extraer el texto de un PDF sectorial. Devuelve el texto crudo (sin
 * trocear: el handler aplica `trocear`/`fragmentos` como en el resto), o
 * `{ escaneo: true }` cuando el PDF es una imagen y no hay nada que extraer.
 * Lanza si el dominio no es el permitido por el adaptador o si la descarga
 * falla: el epígrafe y el aviso quedan en manos del handler.
 *
 * `pedirBytes` y `extraer` son inyectables para probar sin red ni TLS.
 */
export async function textoDePdfSectorial(
  a: Adaptador,
  url: string,
  deps: {
    pedirBytes?: typeof pedirBytes
    extraer?: (bytes: Uint8Array) => Promise<string>
  } = {},
): Promise<TextoPdf> {
  const descargar = deps.pedirBytes ?? pedirBytes
  const extraerTexto = deps.extraer

  let dominio: URL
  try {
    dominio = new URL(url)
  } catch {
    throw new Error(`Enlace PDF inválido: ${url}.`)
  }
  if (dominio.origin !== new URL(a.dominioPermitido).origin) {
    throw new Error(`El enlace PDF no pertenece al dominio permitido de ${a.nombre} (${a.dominioPermitido}).`)
  }

  const r = await descargar(url, 120_000)
  if (r.status !== 200) throw new Error(`El PDF respondió ${r.status}.`)
  const bytes = r.datos

  // Un PDF sin fuentes incrustadas y con páginas de imagen es un escaneo: no
  // hay texto que extraer, y afirmar lo contrario sería inventar contenido.
  if (pdfEsEscaneo(bytes.toString('latin1'))) return { escaneo: true, url }

  // `unpdf` es ~200 KB y solo lo necesita esta ruta: se carga en diferido para
  // que ninguna otra consulta pague ese peso al arrancar.
  let texto: string
  if (extraerTexto) {
    texto = await extraerTexto(new Uint8Array(bytes))
  } else {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const doc = await getDocumentProxy(new Uint8Array(bytes))
    const r2 = await extractText(doc, { mergePages: true })
    texto = r2.text
  }
  texto = texto.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  if (!texto) return { escaneo: true, url }
  return { texto, url }
}

/** El aviso de escaneo, con la URL del visor. */
export function avisoEscaneo(url: string): string {
  return avisoSinTexto(0, url, true)
}
