import type { Cambio } from '../../nucleo/parse/historial.ts'

export const ficha = (c: Cambio): string =>
  `${c.accion.toUpperCase()}${c.norma ? ` por ${c.norma}${c.anio ? ` de ${c.anio}` : ''}` : ''}${c.articulo ? `, artículo ${c.articulo}` : ''}`

/**
 * Ordena la cadena por el año de la norma modificadora; los cambios sin año no
 * se pueden fechar, así que van al final en el orden del documento y marcados.
 *
 * `Array.sort` es estable (ES2019), así que los empates de año conservan el
 * orden del documento, que es como `historial()` entrega las notas y lo único
 * que el portal permite afirmar entre dos reformas del mismo año.
 */
export function ordenarCambios(cambios: Cambio[]): Cambio[] {
  const conAnio = cambios.filter((c) => c.anio)
  const sinAnio = cambios.filter((c) => !c.anio)
  return [...conAnio.sort((a, b) => Number(a.anio) - Number(b.anio)), ...sinAnio]
}

/**
 * La reforma más reciente ANOTADA: la última con año de la lista ya ordenada.
 * Una nota sin año no se puede fechar, así que no compite por «más reciente»;
 * sin ninguna con año devuelve null, que es lo único cierto que se puede decir.
 */
export function ultimaReforma(ordenados: Cambio[]): Cambio | null {
  let ultima: Cambio | null = null
  for (const c of ordenados) if (c.anio) ultima = c
  return ultima
}

/**
 * El orden y la página, en un solo sitio: el texto y el json tienen que contar,
 * ordenar y recortar igual, o dejarían de ser la misma respuesta con otro traje.
 * El filtro por artículo ya se hizo antes, sobre el texto del artículo.
 */
export function acotar(cambios: Cambio[], opts: { desde?: number | undefined; limite?: number | undefined }) {
  const ordenados = ordenarCambios(cambios)
  const desde = Math.max(0, opts.desde ?? 0)
  const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  return { ordenados, desde, limite, tramo: ordenados.slice(desde, desde + limite) }
}

/**
 * La reforma más reciente, dicha como lo que es. NUNCA «la que rige»: el portal
 * anota lo que anota —medido el 2026-09-28, la reforma de la Ley 2466 de 2025
 * al literal b) del artículo 23 del CST no está anotada en su página y la del
 * artículo 4 sí—, así que la única frase defendible es «la última anotada».
 */
export function conclusion(ultima: Cambio | null, articulo?: string | undefined): string {
  if (!ultima) return '\n\nNinguna nota trae año: no se puede señalar cuál es la reforma más reciente.'
  const sobre = articulo ? ` sobre el artículo ${articulo}` : ' sobre esta norma'
  return (
    `\n\nReforma más reciente anotada por el portal${sobre}: ${ficha(ultima)} — nota literal: «${ultima.literal}».` +
    (ultima.accion === 'derogado'
      ? `\nATENCIÓN: la última reforma que el portal anota es una DEROGATORIA; no la leas como vigente sin comprobarla.`
      : '') +
    `\nEs la última que el portal ANOTA, no la que rige: el portal no siempre anota todas las reformas, y la ` +
    `vigencia se consulta con resolver_cita.`
  )
}

/**
 * Formatea la cadena de reformas. Exportada para testearla sin red con fixtures
 * del texto del Gestor.
 */
export function formatearHistorial(
  cambios: Cambio[],
  titulo: string,
  url: string,
  opts: { articulo?: string | undefined; desde?: number | undefined; limite?: number | undefined } = {},
): string {
  const { ordenados, desde, tramo } = acotar(cambios, opts)
  if (opts.articulo && !ordenados.length) {
    return (
      `${titulo} (${url})\n\nEl Gestor no anota cambios sobre el artículo ${opts.articulo}. Eso NO equivale a que ` +
      `siga intacto: el portal no siempre anota las reformas; la vigencia se consulta con resolver_cita.`
    )
  }
  if (!ordenados.length) {
    return (
      `${titulo} (${url})\n\nEl Gestor no anota reformas sobre esta norma. Eso NO equivale a que esté intacta: ` +
      `el portal no siempre anota las reformas; la vigencia se consulta con resolver_cita.`
    )
  }
  const fin = desde + tramo.length
  if (!tramo.length) {
    return (
      `${titulo} (${url})\n\nEl filtro reúne ${ordenados.length} cambio(s)` +
      `${opts.articulo ? ` sobre el artículo ${opts.articulo}` : ''}, pero "desde" (${desde}) está más allá del final. ` +
      `Pide un "desde" menor.`
    )
  }
  const ambito = opts.articulo ? ` sobre el artículo ${opts.articulo}` : ''
  const lineas: string[] = []
  let separadas = false
  for (const c of tramo) {
    if (!c.anio && !separadas) {
      lineas.push('', 'Sin año en la nota (no se pueden ordenar por fecha; van al final):')
      separadas = true
    }
    lineas.push(`- ${ficha(c)}${c.anio ? '' : ' — sin año en la nota'}\n  Nota literal: «${c.literal}»`)
  }
  return (
    `${titulo} (${url})\n\n${ordenados.length} cambio(s) anotado(s) en el texto del portal${ambito}; ` +
    `se muestran ${desde + 1}–${fin}:\n\n` +
    lineas.join('\n') +
    (fin < ordenados.length ? `\n\nQuedan ${ordenados.length - fin}: repite con desde=${fin}.` : '') +
    conclusion(ultimaReforma(ordenados), opts.articulo) +
    `\n\nSon las notas literales del portal, ordenadas por el año de la norma que las introduce (los empates ` +
    `conservan el orden del documento). No se deduce cuál rige hoy: para el estado actual usa resolver_cita.`
  )
}
