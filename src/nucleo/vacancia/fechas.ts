import { sinTildes } from '../parse/texto.ts'

// --- fechas: números en letras, meses y aritmética -------------------------

export const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
}
export const PALABRAS_NUMERO = Object.keys(UNIDADES).join('|')

export const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}
export const MES_TXT = Object.keys(MESES).join('|')
export const MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «seis», «veinticuatro», «dos mil doce», «mil novecientos noventa y tres». */
export function numeroEnLetras(frase: string): number | null {
  const palabras = sinTildes(frase)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && p !== 'y')
  if (!palabras.length) return null
  let total = 0
  let actual = 0
  for (const p of palabras) {
    if (p === 'mil') {
      total += (actual || 1) * 1000
      actual = 0
      continue
    }
    const v = UNIDADES[p]
    if (v === undefined) return null
    actual += v
  }
  return total + actual
}

/** Día dicho de cualquiera de las formas medidas: «1», «01», «1o.», «dos (2)», «primero (1)». */
export function numeroDeTexto(txt: string): number | null {
  const par = txt.match(/\(\s*(\d{1,2})\s*\)/)
  if (par) return Number(par[1])
  const dig = txt.trim().match(/^(\d{1,2})/)
  if (dig) return Number(dig[1])
  return numeroEnLetras(txt)
}

export function isoValido(anio: number, mes: number, dia: number): string | null {
  if (anio < 1800 || anio > 2200 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

export const fechaLarga = (iso: string): string => {
  const [a, m, d] = iso.split('-') as [string, string, string]
  return `${Number(d)} de ${MESES_NOMBRE[Number(m) - 1]} de ${a}`
}

export type Fecha = { iso: string; inicio: number; fin: number }

export const RE_MES = new RegExp(String.raw`\bde\s+(${MES_TXT})\b`, 'gi')
export const RE_DIA = /((?:\d{1,2}\s*[°ºo]?\.?)|(?:[a-záéíóúñ]+(?:\s+y\s+[a-záéíóúñ]+)?(?:\s*\(\s*\d{1,2}\s*\))?))[^a-záéíóúñ0-9]*$/i

/** El año que sigue a «<mes>»: en dígitos o en letras, y cuánto texto consumió. */
export function anioTras(cola: string): { anio: number; largo: number } | null {
  const salto = cola.match(/^\s*(?:,\s*|de(?:l)?(?:\s+ano)?\s*)/i)?.[0].length ?? 0
  const resto = cola.slice(salto)
  const dig = resto.match(/^(\d{4})\b/)
  if (dig) return { anio: Number(dig[1]), largo: salto + dig[0].length }
  const piezas = resto.split(/\s+/)
  for (let k = Math.min(5, piezas.length); k >= 1; k--) {
    const usado = piezas.slice(0, k).join(' ')
    const n = numeroEnLetras(usado)
    if (n !== null && n >= 1800 && n <= 2200) return { anio: n, largo: salto + usado.length }
  }
  return null
}

/**
 * Primera fecha absoluta del trozo: «29 de julio de 2016», «el dos (2) de julio
 * del año 2012», «el primero (1) de enero de dos mil catorce (2014)».
 */
export function buscarFecha(trozo: string): Fecha | null {
  for (const m of trozo.matchAll(RE_MES)) {
    const mes = MESES[m[1]!.toLowerCase()]
    if (mes === undefined) continue
    const i = m.index!
    const base = Math.max(0, i - 44)
    const dm = trozo.slice(base, i).match(RE_DIA)
    if (!dm || dm.index === undefined) continue
    const dia = numeroDeTexto(dm[1]!)
    if (dia === null) continue
    const anio = anioTras(trozo.slice(i + m[0].length, i + m[0].length + 70))
    if (anio === null) continue
    const iso = isoValido(anio.anio, mes, dia)
    if (!iso) continue
    return { iso, inicio: base + dm.index, fin: i + m[0].length + anio.largo }
  }
  return null
}

export function sumarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number]
  const total = m - 1 + meses
  const anio = a + Math.floor(total / 12)
  const mes = ((total % 12) + 12) % 12 + 1
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}

export function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(a, m - 1, d + dias))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
