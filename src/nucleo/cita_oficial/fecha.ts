const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

export const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
// "23 de septiembre de 2004", "jueves, 3 de abril de 2009", "16 de julio".
const RE_LARGA = /^(?:[^\s,]+,\s*)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?$/i

/**
 * Fecha en palabras. Acepta la ISO de las providencias ("2011-05-04") y la que
 * ya viene en palabras ("23 de septiembre de 2004", o "jueves, 3 de abril de
 * 2009" de SAMAI, cuyo día de la semana se descarta).
 *
 * `estilo` decide el orden: el de las providencias —"4 de mayo de 2011"— o el
 * que usan las normas en su propio encabezado —"septiembre 23", mes y día, sin
 * año porque el año ya va en "Ley 909 de 2004"—. Devuelve "" si no reconoce la
 * fecha, para que quien llame la trate como ausente en vez de imprimirla cruda.
 */
export function fechaLarga(iso: string, estilo: 'providencia' | 'norma' = 'providencia'): string {
  const t = (iso ?? '').trim()
  let dia = ''
  let mes = ''
  let anio = ''

  const iso3 = t.match(RE_ISO)
  if (iso3) {
    const n = Number(iso3[2])
    if (n < 1 || n > 12) return ''
    anio = iso3[1]!
    mes = MESES[n - 1]!
    dia = String(Number(iso3[3]))
  } else {
    const larga = t.match(RE_LARGA)
    if (!larga) return ''
    const nombre = larga[2]!.toLowerCase()
    if (!(MESES as readonly string[]).includes(nombre)) return ''
    dia = String(Number(larga[1]))
    mes = nombre
    anio = larga[3] ?? ''
  }

  if (estilo === 'norma') return `${mes} ${dia}`
  return anio ? `${dia} de ${mes} de ${anio}` : `${dia} de ${mes}`
}
