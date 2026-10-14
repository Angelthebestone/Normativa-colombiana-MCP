// --- historial de cambios de un artículo ---------------------------------

export type Cambio = {
  accion: string
  /** Norma que introdujo el cambio, tal como la nombra la nota. */
  norma: string
  anio: string
  /** Artículo de la norma modificadora, si la nota lo dice. */
  articulo: string
  /** La nota completa, palabra por palabra. Es lo que hay que poder citar. */
  literal: string
}

// `Decreto Nacional` es una forma corriente en las notas ("Reglamentado por el
// Decreto Nacional 1409 de 2008"): sin admitirla, 41 notas de las 14 normas
// medidas el 2026-09-28 quedaban sin año teniéndolo escrito (20 de ellas en el
// Estatuto Tributario, 11 en la Ley 789 de 2002).
const NORMA_CITADA =
  /\b(Ley|Decreto(?:\s+(?:Ley|Nacional))?|Resoluci[óo]n|Acuerdo|Circular|Acto\s+Legislativo)\s+(\d[\d.]*)\s+de\s+(\d{4})/i
const SENTENCIA_CITADA = /\b((?:C|T|SU|A)-\s?\d{1,4})\b/i

/**
 * El portal escribe sus notas de tres maneras, y el primer parser solo veía una.
 * El artículo 6 de la Ley 1221 de 2008 lleva las otras dos y por eso el
 * historial lo daba por intacto mientras el texto mostraba las reformas:
 *
 * - pasiva: `(Modificado por el art. 1 Decreto 666 de 2017)`
 * - activa entre paréntesis: `(Adiciona Art 54 numerales 13, 14,15 de la Ley 2466 de 2025)`
 * - control constitucional: `NOTA: Declarada inhibida por ineptitud sustantiva
 *   de la demanda (Numeral 1. ) Sentencia de la Corte Constitucional C-351 de 2013`
 *
 * Las dos formas nuevas exigen que la nota identifique la norma o la sentencia,
 * y la activa exige además ir entre paréntesis. Sin esas dos condiciones entra
 * la prosa del propio articulado —«las normas que la modifiquen o adicionen», o
 * el artículo de vigencias que dice qué deroga ESTA norma—, que apunta al revés:
 * diría que reformaron esta norma cuando es ella la que reforma a otra.
 */
const FORMAS = [
  {
    // La pasiva se acepta aunque la nota no diga qué norma cambió: "Derogado por
    // una norma que la nota no identifica" sigue siendo un cambio anotado.
    re: /(Modificad[oa]|Adicionad[oa]|Derogad[oa]|Sustituid[oa]|Subrogad[oa]|Compilad[oa]|Corregid[oa]|Reglamentad[oa])\s+por\s+([^\n)]{0,160})/gi,
    exigeReferencia: false,
  },
  { re: /\(\s*(Adiciona|Modifica|Deroga|Sustituye|Subroga|Corrige)\b([^)\n]{0,160})\)/gi, exigeReferencia: true },
  { re: /(Declarad[oa]s?)\b([^\n]{0,160})/gi, exigeReferencia: true },
] as const

/** Los verbos en activa se anotan en participio, como el resto. */
const PARTICIPIO: Record<string, string> = {
  adiciona: 'adicionado',
  modifica: 'modificado',
  deroga: 'derogado',
  sustituye: 'sustituido',
  subroga: 'subrogado',
  corrige: 'corregido',
}

/**
 * Reconstruye qué le pasó a un artículo a partir de las notas que el propio
 * portal incrusta en el texto ("Modificado por el Art. 1 del Decreto 226 de
 * 2026"). El Decreto 1083 trae 324.
 *
 * Se devuelve SIEMPRE la nota literal junto a los campos sueltos. La tentación
 * aquí es completar lo que la nota no dice; en materia legal eso convierte una
 * laguna en una afirmación falsa, así que lo que no consta va vacío y la nota
 * queda para que alguien la lea.
 *
 * ponytail: no se ordena cronológicamente ni se decide cuál cambio "gana". Las
 * notas no siempre traen fecha completa y encadenarlas exigiría interpretar;
 * se entregan en el orden en que aparecen, que es el del propio documento.
 */
export function historial(texto: string): Cambio[] {
  // Se recoge con la posición porque las tres formas se buscan en pasadas
  // distintas: sin reordenar, la respuesta dejaría de ir en el orden del
  // documento, que es lo único que se promete sobre la secuencia.
  const cambios: (Cambio & { pos: number })[] = []
  const vistos = new Set<string>()

  for (const { re, exigeReferencia } of FORMAS) {
    for (const m of texto.matchAll(re)) {
      const detalle = m[2] ?? ''
      const norma = detalle.match(NORMA_CITADA)
      const sentencia = detalle.match(SENTENCIA_CITADA)
      if (exigeReferencia && !norma && !sentencia) continue
      // La prosa de una ley que transcribe un artículo ya modificado («modificado
      // por la Ley 2101 de 2021, el cual quedará así:») describe a OTRA norma; las
      // notas del portal no llevan esa frase.
      // ponytail: heurística por frase; el techo es otra redacción de la misma prosa; el salto sería aceptar la pasiva solo entre paréntesis, a costa de perder notas del portal que no los llevan.
      if (!exigeReferencia && /\bqued(?:ar[áa]|a)\s+as[ií]/i.test(m[0])) continue

      // La nota se lee hasta 160 caracteres. Cuando ahí se corta hay que
      // decirlo: una cita literal truncada en silencio se lee como completa.
      const literal =
        m[0].replace(/\s+/g, ' ').trim().replace(/[,.;]$/, '') + (detalle.length >= 160 ? '…' : '')
      if (vistos.has(literal)) continue // el portal repite la misma nota en varios apartes
      vistos.add(literal)

      const verbo = (m[1] ?? '').toLowerCase()
      cambios.push({
        pos: m.index,
        accion: PARTICIPIO[verbo] ?? verbo.replace(/a$/, 'o'),
        norma: norma ? `${norma[1]} ${norma[2]}` : sentencia ? `Sentencia ${sentencia[1]}` : '',
        // Sin norma citada, el año es el último que aparece en la nota: la Corte
        // se cita como "C-337 de fecha mayo 11 de 2011", con el año al final.
        anio: norma?.[3] ?? (sentencia ? (detalle.match(/\b((?:19|20)\d{2})\b(?![\s\S]*\b(?:19|20)\d{2}\b)/)?.[1] ?? '') : ''),
        articulo: detalle.match(/\bart[íi]?c?u?l?o?\.?\s*(\d+[\w.]*)/i)?.[1] ?? '',
        literal,
      })
    }
  }
  return cambios.sort((a, b) => a.pos - b.pos).map(({ pos: _pos, ...c }) => c)
}
