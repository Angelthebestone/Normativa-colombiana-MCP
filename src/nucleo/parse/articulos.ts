/**
 * true si lo que precede a un encabezado lo anuncia como texto citado. El
 * anuncio puede cerrar en dos puntos ("…quedará así:") o en punto ("…el cual
 * quedará así."): la Ley 2418 de 2024 anuncia con punto sus seis artículos que
 * transcriben, y sin aceptarlo `articulo()` devolvía solo el anuncio, sin el
 * articulado transcrito (medido el 2026-09-28 contra el portal).
 */
const abreBloqueCitado = (previo: string): boolean =>
  previo.trimEnd().endsWith(':') || /quedar[áa]n? as[íi]\.$/.test(previo.trimEnd())

/**
 * Números que un encabezado de sustitución anuncia: "Los artículos 217 y 218
 * del Código Civil quedarán así:" → {217, 218}. Sirve para no cortar el
 * artículo en medio del bloque que transcribe.
 */
// El número de un artículo: 217, 2.2.1.3.1, 771-5, 217A.
const NUM_ARTICULO = String.raw`[\d.]+(?:-\d+)?[A-Za-z]?`
const RE_ANUNCIADOS = new RegExp(
  String.raw`\bart[íi]culos?\s+((?:${NUM_ARTICULO})(?:\s*(?:,|y|e)\s*${NUM_ARTICULO})*)`,
  'gi',
)
const RE_NUM_SUELTO = new RegExp(NUM_ARTICULO, 'g')

function articulosAnunciados(intro: string): Set<string> {
  const nums = new Set<string>()
  for (const m of intro.matchAll(RE_ANUNCIADOS))
    for (const n of m[1]!.match(RE_NUM_SUELTO) ?? []) nums.add(n.replace(/\.$/, ''))
  return nums
}

/**
 * Índice de artículos, para que Claude sepa qué pedir sin traerse la norma entera.
 *
 * El encabezado tiene que abrir renglón. Sin esa exigencia, las referencias
 * cruzadas dentro de las notas —"modificado por el artículo 21 de la Ley 1955"—
 * entraban como artículos propios, y en el Decreto 1083 de 2015, que numera
 * 2.2.1.3.1, aparecían "21", "5" y "19" mezclados con la numeración real.
 * Es la misma regla que ya usaba `articulo()` para no cortar por una nota.
 */
export function indiceArticulos(texto: string, max = 60): string[] {
  const vistos = new Set<string>()
  const citados = new Set<string>()
  const re = new RegExp(String.raw`(?:^|\n)\s*(?:ART[IÍ]CULO|Art[ií]culo)\s*(?=\d)(${NUM_ARTICULO})`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) && vistos.size < max) {
    const num = m[1]!.replace(/\.$/, '')
    // El artículo que una ley modificatoria transcribe NO es un artículo suyo:
    // en la Ley 1060 de 2006 el "Artículo 217" que sigue a "quedará así:" es
    // del Código Civil, y listarlo hacía pedir un artículo que la ley no tiene.
    const previo = texto.slice(Math.max(0, m.index - 300), m.index)
    if (abreBloqueCitado(previo)) {
      for (const n of articulosAnunciados(previo)) citados.add(n)
      continue
    }
    if (citados.delete(num)) continue
    vistos.add(num)
  }
  return [...vistos]
}

// `\s*` y no `\s+` entre la palabra y el número: el Gestor escribe a veces el
// encabezado pegado («ARTÍCULO3°.» en la Ley 769 de 2002), y con `\s+` el
// artículo 2 se comía el 3 entero. El `(?=\d)` impide que «Artículos» o un
// «ARTÍCULO.» suelto pasen por encabezado: `NUM_ARTICULO` admite un punto inicial.
const RE_ENCABEZADO = new RegExp(String.raw`\n\s*(?:ART[IÍ]CULO|Art[ií]culo)\s*(?=\d)(${NUM_ARTICULO})`)

export function articulo(texto: string, numero: string): string | null {
  const n = numero.replace(/[^\d.\-A-Za-z]/g, '').replace(/[.]+$/, '')
  if (!n) return null
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // El cierre no puede ser `\b`: con él, pedir el artículo 771 casaba con el
  // encabezado de "Artículo 771-5" y se devolvía otro artículo sin avisar.
  //
  // La coincidencia inicial exige inicio de renglón, la misma regla que
  // `indiceArticulos`: sin ella, pedir el artículo 28 de la Ley 789 de 2002
  // devolvía el "Artículo 28 de la Ley 21 de 1982" citado en prosa dentro del
  // artículo 3, y en el Estatuto Tributario el 246 devolvía la cita al Código
  // de Comercio. Medido el 2026-09-28 sobre 3.397 artículos de 14 normas:
  // 3.387 se extraen idénticos y 10 cambian, todos de una cita en prosa al
  // encabezado real.
  const re = new RegExp(`(?:^|\\n)\\s*(?:ART[IÍ]CULO|Art[ií]culo)\\s*${esc}(?![\\d\\-A-Za-z])`, 'g')
  const m = re.exec(texto)
  if (!m) return null
  const desde = m.index + m[0].length
  const fin = () => texto.slice(m.index, Math.min(texto.length, m.index + 20000)).trim()

  /**
   * El siguiente artículo tiene que ser un encabezado (inicio de renglón y
   * seguido de su número). Sin esa exigencia, una referencia cruzada dentro de
   * una nota —"Artículo 15 Ley 91 de 1989"— cortaba el artículo por la mitad y
   * se perdían justo las notas de vigencia.
   *
   * Y el encabezado no basta: la legislación modificatoria, que en Colombia es
   * la mayoría, transcribe el artículo que sustituye. "Artículo 5°. El artículo
   * 217 del Código Civil quedará así:" seguido de "Artículo 217. …" cortaba
   * justo en los dos puntos y el artículo se devolvía sin su contenido, que era
   * todo lo que se había pedido. Un encabezado se salta cuando lo anuncian los
   * dos puntos que lo preceden o cuando su número es de los que la sustitución
   * declara.
   */
  let anunciados: Set<string> | null = null
  let cursor = desde
  for (;;) {
    const enc = RE_ENCABEZADO.exec(texto.slice(cursor))
    if (!enc) return fin()
    const abs = cursor + enc.index
    // Pasado el encabezado entero: avanzar un carácter volvía a encontrar el
    // mismo, porque `\n\s*` casa también desde el renglón en blanco anterior.
    cursor = abs + enc[0].length
    const previo = texto.slice(m.index, abs)
    if (anunciados === null) anunciados = abreBloqueCitado(previo) ? articulosAnunciados(previo) : new Set()
    const num = enc[1]!.replace(/\.$/, '')
    if (abreBloqueCitado(previo) || anunciados.has(num)) {
      // Cada número anunciado se salta UNA vez: si la ley tuviera un artículo
      // propio con ese mismo número, saltárselo también se comería un artículo
      // entero sin que nada lo delatara.
      anunciados.delete(num)
      continue
    }
    return texto.slice(m.index, abs).trim()
  }
}

/**
 * Deja el texto "sustantivo" de un artículo: quita las notas entre paréntesis
 * que el portal incrusta ("(Modificado por el Art. 3 de la Ley 2418 de 2024)",
 * "(Ver Sentencia T-800 de 2011)"). Para COMPARAR dos artículos, esas notas son
 * ruido editorial, no contenido; el texto limpio es el que debe contrastarse.
 */
export function limpiarArticulo(texto: string): string {
  return texto
    .split('\n')
    .map((l) =>
      l.replace(/\([^)\n]{0,200}\)/g, ' ').replace(/\s+/g, ' ').trim(),
    )
    .filter(Boolean)
    .join('\n')
}
