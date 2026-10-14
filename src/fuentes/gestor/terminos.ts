import { limpiarTermino, sinTildes } from '../../nucleo/parse/texto.ts'
import { type Resultado } from '../../nucleo/parse/gestor.ts'
import { esStopword } from '../../nucleo/stopwords.ts'


/**
 * El buscador une los términos con OR y no descarta vacías: `auxilio de
 * conectividad` devuelve 176 documentos solo por culpa del `de`, mientras que
 * `auxilio` devuelve 9. Quitarlas es lo que separa una búsqueda útil del ruido.
 */
export function quitarStopwords(frase: string): { usadas: string; descartadas: string[] } {
  const palabras = limpiarTermino(frase).split(' ').filter(Boolean)
  const utiles = palabras.filter((p) => !esStopword(p))
  const descartadas = palabras.filter((p) => esStopword(p))
  return { usadas: (utiles.length ? utiles : palabras).join(' '), descartadas }
}

/**
 * Términos significativos (sin vacías, sin tildes, en minúsculas) de una
 * frase. Cuando todas las palabras son vacías no queda nada que exigir.
 */
export function terminosSignificativos(frase: string): string[] {
  const { usadas, descartadas } = quitarStopwords(frase)
  const palabras = limpiarTermino(frase).split(' ').filter(Boolean)
  if (descartadas.length && descartadas.length === palabras.length) return []
  return [...new Set(usadas.split(' ').filter(Boolean).map((t) => sinTildes(t).toLowerCase()))]
}

/**
 * Pertinencia por fila: qué términos significativos aparecen de verdad en el
 * extracto temático de cada resultado. El portal une con OR, así que un
 * resultado puede venir por un solo término; marcarlo evita que dos
 * resultados se lean como igual de pertinentes cuando uno ni menciona el tema.
 */
export function pertinenciaDe(items: Resultado[], frase: string): Map<string, { menciona: string[]; omite: string[] }> {
  const exigidos = terminosSignificativos(frase)
  const mapa = new Map<string, { menciona: string[]; omite: string[] }>()
  for (const i of items) {
    const heno = sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase()
    mapa.set(i.id, {
      menciona: exigidos.filter((t) => heno.includes(t)),
      omite: exigidos.filter((t) => !heno.includes(t)),
    })
  }
  return mapa
}

/**
 * Filtro local AND sobre lo que el portal devolvió con OR. Sobre título y
 * resumen, sin tildes y en minúsculas: los resultados de esta herramienta solo
 * traen esos dos campos, y ahí es donde el usuario busca.
 */
export function contienenTodos(items: Resultado[], frase: string): { items: Resultado[]; exigidos: string[]; omitidos: number } {
  const exigidos = terminosSignificativos(frase)
  if (exigidos.length < 2) return { items, exigidos, omitidos: 0 }
  const quedan = items.filter((i) => {
    const heno = sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase()
    return exigidos.every((t) => heno.includes(t))
  })
  return { items: quedan, exigidos, omitidos: items.length - quedan.length }
}
