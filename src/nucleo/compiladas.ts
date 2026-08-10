/**
 * Normas compiladas —decretos únicos reglamentarios—: el portal las sirve con
 * las reformas ya incorporadas y son gigantes (el Decreto 1083 de 2015 pesa
 * 925.000 caracteres; el 1625 de 2016 de la DIAN, 6,5 MB), así que no se
 * devuelven enteras y hay que avisarlo con un índice de artículos.
 */
import { indiceArticulos, sinTildes } from './parse.ts'

const UMBRAL_TAMANO = 300_000
const MAX_INDICE = 30

/** ¿La norma es una compilación? Por el título ("único reglamentario", "compilador") o porque el texto no cabe entero. */
export function esCompiladora(titulo: string, tamanoTexto: number): boolean {
  const normalizado = sinTildes(titulo).toLowerCase()
  return (
    normalizado.includes('unico reglamentario') ||
    normalizado.includes('compilador') ||
    tamanoTexto > UMBRAL_TAMANO
  )
}

/**
 * Aviso para una norma compilada: qué es, qué no se devuelve, cómo buscar
 * dentro y el índice de sus primeros artículos para poder pedir el que importa.
 */
export function avisoCompiladora(titulo: string, texto: string): string {
  const lineas = [
    `${titulo} es una norma compilada: su texto ya incorpora las reformas que le han hecho otras normas.`,
    'Por su tamaño el texto íntegro no se devuelve entero.',
    'Usa buscar_en_texto para localizar lo que buscas o pide el artículo concreto.',
  ]
  const indice = indiceArticulos(texto, MAX_INDICE)
  if (indice.length) lineas.push(`Artículos detectados (primeros ${MAX_INDICE}): ${indice.join(', ')}`)
  return lineas.join('\n')
}
