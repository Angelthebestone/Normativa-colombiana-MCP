import type { Providencia as ProvidenciaConsejo } from '../../fuentes/jurisprudencia/consejoestado/index.ts'
import { nombreEnTitulo, radicadoConGuiones, type Cita } from './componentes.ts'

export type DatosConsejoEstado = Pick<ProvidenciaConsejo, 'radicado' | 'ponente' | 'sala'>

/**
 * `Consejo de Estado, Sala de lo Contencioso Administrativo, Sección Tercera
 * (Subsección C), Rad. 25000-23-36-000-2019-00682-01 (C.P. Adriana Polidura
 * Castillo)`.
 *
 * NO lleva fecha: el campo `fecha` de SAMAI es la del proceso, no la de la
 * providencia, y escribirla como si fuera la del fallo es justo el error que
 * esta cita existe para evitar. Queda declarada en `faltan`.
 *
 * El tipo NO incluye `fecha` a propósito: así no se puede pasar por descuido.
 */
export function citaConsejoEstado(p: DatosConsejoEstado): Cita | null {
  const radicado = radicadoConGuiones(p.radicado ?? '')
  if (!radicado) return null

  const faltan: string[] = []
  const sala = (p.sala ?? '').replace(/\s+/g, ' ').trim()
  if (!sala) faltan.push('sala')
  const ponente = nombreEnTitulo(p.ponente ?? '')
  if (!ponente) faltan.push('ponente')
  faltan.push('fecha del fallo (SAMAI publica la del proceso, no la de la providencia)')

  const corporacion = `Consejo de Estado, Sala de lo Contencioso Administrativo${sala ? `, ${sala}` : ''}`
  return { cita: `${corporacion}, Rad. ${radicado}${ponente ? ` (C.P. ${ponente})` : ''}`, faltan }
}
