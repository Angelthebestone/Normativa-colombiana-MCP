/** `obtener_documento` con fuente="dian" y fuente="creg": páginas de normograma leídas como texto. */
import { cargar, textoDe, trocear } from '../../nucleo/parse.ts'
import { pedir as pedirHttp } from '../../nucleo/http.ts'
import * as dian from '../../fuentes/normograma.ts'
import * as creg from '../../fuentes/creg.ts'
import type { Resueltas } from './esquema.ts'
import { cuerpo, pasajes, sinTexto } from './formato.ts'

export async function dianDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.link) throw new Error('Para fuente="dian" hace falta link.')
  const url = dian.urlDocumento(p.link)
  const r = await pedirHttp(url, 90_000)
  if (r.status !== 200) {
    return `No encontré el documento "${p.link}" en el normograma de la DIAN. Verifica el link con buscar_normativa_tributaria.`
  }
  const texto = textoDe(cargar(r.cuerpo), 'body')
  if (texto.length < 200) return `${p.link}\n\n${sinTexto(texto.length, url)}`
  if (p.buscar_en_texto) return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, url, `${p.link}\n`)
  return `${p.link}\n${cuerpo(trocear(texto, p.desde, tope), url, p)}`
}

export async function cregDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.ruta) throw new Error('Para fuente="creg" hace falta ruta.')
  const d = await creg.obtenerTexto(p.ruta)
  if (d.texto.length < 200) return `${p.ruta}\n\n${sinTexto(d.texto.length, d.url)}`
  if (p.buscar_en_texto) return pasajes(d.texto, p.buscar_en_texto, p.max_pasajes, tope, d.url, `${p.ruta}\n`)
  return `${p.ruta}\n${cuerpo(trocear(d.texto, p.desde, tope), d.url, p)}`
}
