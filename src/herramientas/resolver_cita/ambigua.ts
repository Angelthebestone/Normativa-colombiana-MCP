import type { Cita } from '../../nucleo/citas/index.ts'
import type { Resultado } from '../../nucleo/parse/gestor.ts'
import { sinNorma, type Resuelta } from './resuelta.ts'

/** El número sin año no identifica una norma: se devuelven los candidatos y se pide el año. */
export function normaAmbigua(cita: string, c: Cita, items: Resultado[]): Resuelta | null {
  /**
   * Sin año, el número NO identifica una norma. "Decreto 1072" existe en 2025
   * (tarifas de energía), 2015 (Único Reglamentario del Sector Trabajo), 2004
   * y 1999, y el Gestor devuelve primero el más reciente. Entregar ese como si
   * fuera "el" Decreto 1072 es el error caro de esta herramienta: acierta la
   * forma —es un decreto real con ese número— y falla el fondo, sin que nada
   * en la respuesta invite a sospecharlo. Se devuelven los candidatos y se
   * pide el año, igual que ya se hace cuando el tipo no coincide.
   */
  if (!c.anio) {
    const conAnio = items
      .map((i) => ({ i, anio: i.titulo.match(/\bde\s+(\d{4})\b/i)?.[1] ?? '' }))
      .filter((x) => x.anio)
    if (new Set(conAnio.map((x) => x.anio)).size > 1) {
      return sinNorma(
        cita,
        [{ clave: 'gestor', detalle: `${conAnio.length} candidatos` }],
        `La cita "${cita}" es ambigua: el Gestor tiene ${conAnio.length} normas con ese tipo y número, de años ` +
          `distintos. No se elige una por ti.\n\n` +
          conAnio
            .sort((a, b) => Number(b.anio) - Number(a.anio))
            .map(({ i }) => `- ${i.titulo} (id ${i.id})\n  ${i.url}`)
            .join('\n') +
          `\n\nRepite la cita con el año ("${c.tipo} ${c.numero} de ${conAnio[0]!.anio}")` +
          (c.articulo ? `, conservando el artículo ("art. ${c.articulo} de …")` : '') +
          `. Si no sabes cuál es, díselo a quien pregunta en vez de escoger: el número solo no identifica la norma.`,
      )
    }
  }
  return null
}
