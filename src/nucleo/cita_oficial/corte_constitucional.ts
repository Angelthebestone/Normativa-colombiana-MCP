import type { Providencia as ProvidenciaCorte } from '../../fuentes/jurisprudencia/corte/index.ts'
import { RE_ISO, fechaLarga } from './fecha.ts'
import { enumerar, type Cita } from './componentes.ts'

/** Formas reales: "C-337/11", "SU.371/21", "A. 193/22", "T-578A/10", "SU508/20". */
const RE_SENTENCIA_CC = /^\s*(SU|C|T|A)\W*(\d+[A-Za-z]?)\s*[/-]\s*(\d{2,4})\s*$/i

/** 11 → 2011, 24 → 2024. La Corte Constitucional existe desde 1991. */
const anioCompleto = (yy: string): string =>
  yy.length === 4 ? yy : String(Number(yy) >= 50 ? 1900 + Number(yy) : 2000 + Number(yy))

export type DatosCorteConstitucional = Pick<ProvidenciaCorte, 'sentencia' | 'fecha' | 'magistrados'>

/**
 * `Corte Constitucional, Sentencia C-337 de 2011 (M.P. Jorge Ignacio Pretelt
 * Chaljub; 4 de mayo de 2011)`. La palabra Sentencia/Auto sale de la letra del
 * número (C, T, SU → sentencia; A → auto), no del campo `tipo`, que viene con
 * más texto ("Sentencia de unificación", "Constitucionalidad"). Dos ponentes se
 * rotulan "M.PP.". Devuelve `null` solo si no hay número de providencia.
 */
export function citaCorteConstitucional(p: DatosCorteConstitucional): Cita | null {
  const bruto = (p.sentencia ?? '').trim()
  if (!bruto) return null

  const m = bruto.match(RE_SENTENCIA_CC)
  const faltan: string[] = []
  // El año se toma de la fecha del fallo y, solo si no la hay, del sufijo del
  // número ("/11"): la fuente lo escribe así y expandirlo no es deducir nada.
  const anio = (p.fecha ?? '').match(RE_ISO)?.[1] ?? (m ? anioCompleto(m[3]!) : '')
  let identificador = bruto
  if (m) {
    const letra = m[1]!.toUpperCase()
    // En los autos el "A-" es redundante con la palabra "Auto", así que el
    // número va solo; en las sentencias el prefijo (C, T, SU) sí se conserva.
    identificador = letra === 'A' ? `Auto ${m[2]!} de ${anio}` : `Sentencia ${letra}-${m[2]!} de ${anio}`
  }

  const ponentes = (p.magistrados ?? []).map((n) => (n ?? '').trim()).filter(Boolean)
  const ponente = ponentes.length ? `${ponentes.length > 1 ? 'M.PP.' : 'M.P.'} ${enumerar(ponentes)}` : ''
  const fecha = fechaLarga(p.fecha ?? '')

  if (!ponentes.length) faltan.push('ponente')
  if (!fecha) faltan.push('fecha')

  const cuerpo = [ponente, fecha].filter(Boolean).join('; ')
  return { cita: `Corte Constitucional, ${identificador}${cuerpo ? ` (${cuerpo})` : ''}`, faltan }
}
