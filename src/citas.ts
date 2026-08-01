/**
 * Parser de citas normativas colombianas.
 *
 * Es la consulta más frecuente ("¿qué dice la Ley 909 de 2004?") y el buscador
 * del portal la resuelve mal, porque une los términos con OR. En cambio
 * tipo+número+año devuelve exactamente un resultado, así que vale la pena
 * detectar la cita y saltarse el buscador.
 */

export type Cita = {
  tipo: string
  numero: string
  anio?: string | undefined
  articulo?: string | undefined
  /** Forma canónica de la Corte Constitucional: C-337/11, T-099/24, SU-123/20. */
  sentencia?: string | undefined
}

/** Ids de `tipdoc` en el Gestor, para no depender del catálogo en la ruta rápida. */
const TIPOS: Record<string, number> = {
  'acto legislativo': 2,
  acuerdo: 3,
  auto: 1205,
  circular: 6,
  'circular conjunta': 184,
  'circular externa': 825,
  'circular unificada': 845,
  concepto: 7,
  'concepto marco': 785,
  'constitucion politica': 8,
  'criterio unificado': 988,
  decreto: 11,
  'decreto ley': 986,
  directiva: 13,
  'documento conpes': 985,
  estatutos: 905,
  ley: 18,
  reglamento: 989,
  resolucion: 29,
  sentencia: 30,
}

const NOMBRES_TIPO =
  'acto legislativo|circular conjunta|circular externa|circular unificada|constituci[oó]n pol[ií]tica|concepto marco|criterio unificado|decreto ley|documento conpes|acuerdo|auto|circular|concepto|decreto|directiva|estatutos|ley|reglamento|resoluci[oó]n|sentencia'

const normaliza = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

/** 92 → 1992, 24 → 2024. La Corte Constitucional existe desde 1991. */
const expandirAnio = (yy: string): string => {
  const n = Number(yy)
  return String(n >= 50 ? 1900 + n : 2000 + n)
}

const RE_ARTICULO = /\bart(?:[íi]culo|\.)?\s*([\d]+(?:\.[\d]+)*[A-Za-z]?)/i
// Admite "C-337/11", "C-351 de 2013" y "T-099-24": las tres formas circulan.
const RE_SENTENCIA = /\b(C|T|SU|A)[\s.-]*(\d{1,4})\s*(?:[/-]|\s+de\s+)\s*(\d{2,4})\b/i
// El número se toma entero, sin tope de dígitos: con `\d{1,5}` una cita como
// "Ley 99999999 de 1800" se partía en "Ley 99999" y el año quedaba fuera, así
// que el error acababa pidiendo un año que sí se había indicado.
const RE_TIPO_NUM = new RegExp(`\\b(${NOMBRES_TIPO})\\s*(?:n[ºo°.]?\\s*)?(\\d+)(?:\\s*(?:de|del|/)\\s*(\\d{4}|\\d{2}))?`, 'i')

export function parsearCita(texto: string): Cita | null {
  const art = texto.match(RE_ARTICULO)?.[1]

  // Sentencias: C-337/11, T-099 de 2024, SU-123/20.
  const s = texto.match(RE_SENTENCIA)
  if (s) {
    const letra = s[1]!.toUpperCase()
    const num = s[2]!
    const anio = s[3]!.length === 4 ? s[3]! : expandirAnio(s[3]!)
    return {
      tipo: letra === 'A' ? 'Auto' : 'Sentencia',
      numero: num,
      anio,
      articulo: art,
      sentencia: `${letra}-${num.padStart(3, '0')}/${anio.slice(-2)}`,
    }
  }

  const m = texto.match(RE_TIPO_NUM)
  if (!m) return null

  const tipoTexto = normaliza(m[1]!)
  const anioBruto = m[3]
  return {
    tipo: tipoTexto,
    numero: String(Number(m[2])),
    anio: anioBruto ? (anioBruto.length === 4 ? anioBruto : expandirAnio(anioBruto)) : undefined,
    articulo: art,
  }
}

/** Id de `tipdoc` para una cita; `undefined` si el nombre no está en la tabla. */
export const idTipo = (tipo: string): number | undefined => TIPOS[normaliza(tipo)]

/**
 * Ruta de la relatoría para una cita de sentencia: "C-337/11" → "2011/C-337-11.htm".
 * ponytail: se construye por convención de nombres, que es la que sigue el
 * sitio; si alguna providencia se sale del patrón, obtenerTexto la reporta como
 * inexistente y queda buscar_jurisprudencia, que devuelve la ruta literal.
 */
export function rutaDeSentencia(texto: string): string | null {
  const c = parsearCita(texto)
  if (!c?.sentencia || !c.anio) return null
  return `${c.anio}/${c.sentencia.replace('/', '-')}.htm`
}
