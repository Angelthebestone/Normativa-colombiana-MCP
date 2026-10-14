import type { Norma } from '../parse/gestor.ts'
import { fechaLarga } from './fecha.ts'
import type { Cita } from './componentes.ts'

export type DatosNorma = Pick<Norma, 'titulo' | 'fechas'>

/** "Ley 909 de 2004", "Decreto Ley 2739 de 2012", "Resolución 0785 de 2021 …". */
const RE_TITULO_NORMA = /^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+)?)\s+(\d[\d.-]*)\s+de\s+(\d{4})/

const capitalizar = (s: string): string =>
  s
    .trim()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')

/**
 * `Ley 909 de 2004 (septiembre 23), Diario Oficial No. 45.680`.
 *
 * Lo identificador ("Ley 909 de 2004") sale del título de la ficha; la fecha de
 * expedición y el número del Diario Oficial, de sus metadatos. La entidad
 * expedidora NO se incluye: solo consta en la prosa del encabezado y su forma
 * cambia demasiado ("EL CONGRESO DE COLOMBIA", "EL CONGRESO DE LA REPÚBLICA",
 * "EL PRESIDENTE DE LA REPÚBLICA DE COLOMBIA", "LA COMISIÓN NACIONAL DEL
 * SERVICIO CIVIL"), y en resoluciones y circulares ni siquiera aparece así, de
 * modo que leerla sin equivocarse no es posible hoy. Se omite y se declara.
 *
 * ponytail: el techo es esa entidad expedidora. El salto, si algún día importa,
 * es que la ficha del Gestor exponga un campo "Entidad" estructurado, no un
 * parser sobre el encabezado. Devuelve `null` sin título.
 */
export function citaNorma(datos: DatosNorma): Cita | null {
  const titulo = (datos.titulo ?? '').replace(/\s+/g, ' ').trim()
  if (!titulo) return null

  const m = titulo.match(RE_TITULO_NORMA)
  const identificador = m ? `${capitalizar(m[1]!)} ${m[2]!} de ${m[3]!}` : titulo
  const faltan = ['entidad expedidora']

  const expedicion = fechaLarga(datos.fechas?.['Fecha de Expedición'] ?? '', 'norma')
  if (!expedicion) faltan.push('fecha de expedición')

  const diario = (datos.fechas?.['Medio de Publicación'] ?? '').match(/Diario Oficial\s+([\d.]+)/i)?.[1] ?? ''
  if (!diario) faltan.push('Diario Oficial')

  const partes = [
    `${identificador}${expedicion ? ` (${expedicion})` : ''}`,
    diario ? `Diario Oficial No. ${diario}` : '',
  ].filter(Boolean)
  return { cita: partes.join(', '), faltan }
}
