/** `obtener_documento` con fuente="sectorial": PDF, Word o página de un regulador. */
import { avisoSinTexto } from '../../nucleo/parse/pdf.ts'
import { cargar, textoDe } from '../../nucleo/parse/limpieza.ts'
import { trocear } from '../../nucleo/parse/fragmentos.ts'
import { pedir as pedirHttp } from '../../nucleo/http.ts'
import { extraerTextoWord } from '../../fuentes/sectorial/word.ts'
import { textoDePdfSectorial, avisoEscaneo } from '../../fuentes/sectorial/pdf.ts'
import { adaptador, ids } from '../../fuentes/sectorial.ts'
import type { DepsLectura, Resueltas } from './esquema.ts'
import { conMenciones, cuerpo, pasajes, sinTexto } from './formato.ts'

/** Cómo se extrae el texto de un enlace sectorial, según el formato del archivo. */
function esFormatoWord(url: string): boolean {
  const nombre = url.split(/[?#]/)[0]!.toLowerCase()
  return nombre.endsWith('.doc') || nombre.endsWith('.docx') || nombre.endsWith('.zip')
}
const esPdf = (url: string): boolean => url.split(/[?#]/)[0]!.toLowerCase().endsWith('.pdf')

/**
 * Sectorial sin entero ni ruta_destino: extrae el texto (PDF o Word) y lo
 * trocea como el resto de fuentes, con la advertencia de la fuente siempre
 * presente y las menciones a otras normas detectadas al final.
 */
export async function sectorialDocumento(p: Resueltas, tope: number, deps: DepsLectura = {}): Promise<string> {
  if (!p.entidad || !p.url) throw new Error('Para fuente="sectorial" hacen falta entidad y url.')
  const a = adaptador(p.entidad)
  if (!a) {
    // Sin los ids a la vista, el usuario solo sabe que se equivocó. Se listan.
    return (
      `No hay un regulador sectorial llamado "${p.entidad}". Los ids válidos son: ${ids().join(', ')}. ` +
      `Cada uno con su sector, en describir_fuentes; los actos de uno concreto, en buscar_normativa_sectorial.`
    )
  }
  const cab = `Fuente: ${a.nombre} (${a.sector}).\nQué NO cubre: ${a.advertencia}`
  if (esPdf(p.url)) {
    const r = await textoDePdfSectorial(a, p.url, {
      ...(deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {}),
      ...(deps.extraerPdf ? { extraer: deps.extraerPdf } : {}),
    })
    if ('escaneo' in r) return `${cab}\n\n${avisoEscaneo(r.url)}`
    return `${cab}\n${conMenciones(cuerpo(trocear(r.texto, p.desde, tope), r.url, p), r.texto)}`
  }
  if (esFormatoWord(p.url)) {
    const r = await extraerTextoWord(a, p.url, {
      ...(deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {}),
      ...(deps.descomprimirZip ? { descomprimirZip: deps.descomprimirZip } : {}),
    })
    if ('sinTexto' in r) {
      return `${cab}\n\n${avisoSinTexto(0, r.url)} (los .doc binarios de Office no se pueden leer aquí).`
    }
    return `${cab}\n${conMenciones(cuerpo(trocear(r.texto, p.desde, tope), r.url, p), r.texto)}`
  }
  // El resto de formatos (HTML de un normograma, sobre todo) se lee como página.
  const r = await pedirHttp(p.url, 90_000)
  if (r.status !== 200) throw new Error(`El enlace respondió ${r.status}: no se pudo leer ${p.url}.`)
  const texto = textoDe(cargar(r.cuerpo), 'body')
  if (texto.length < 200) return `${cab}\n\n${sinTexto(texto.length, p.url)}`
  if (p.buscar_en_texto) return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, p.url, `${cab}\n`)
  return `${cab}\n${conMenciones(cuerpo(trocear(texto, p.desde, tope), p.url, p), texto)}`
}
