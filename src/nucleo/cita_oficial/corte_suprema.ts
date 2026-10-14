import type { Providencia as ProvidenciaSuprema } from '../../fuentes/jurisprudencia/cortesuprema.ts'
import type { Cita } from './componentes.ts'

export type DatosCorteSuprema = Pick<ProvidenciaSuprema, 'titulo' | 'sala' | 'clase' | 'magistrado' | 'anio' | 'ruta'>

const SALAS_CASACION: Record<string, string> = { civil: 'Civil', laboral: 'Laboral', penal: 'Penal' }

/**
 * La sala que de verdad decide. La búsqueda devuelve en `sala` la PESTAÑA
 * consultada —cuatro valores fijos: Tutelas, Civil, Laboral, Penal—, y "Tutelas"
 * no es una sala de casación: una tutela la decide Civil, Laboral o Penal. La
 * sala real va en `ruta` ("…/Index/TUTELAS/LABORAL/2025/…" o "…/Index/CIVIL/
 * 1995/…"), así que se lee de ahí; si no, se usa `sala` cuando ya es de
 * casación. Sin poder determinarla, se omite.
 */
function salaDeCasacion(p: DatosCorteSuprema): string {
  const m = (p.ruta ?? '').match(/Index\/(TUTELAS|CIVIL|LABORAL|PENAL)(?:\/(CIVIL|LABORAL|PENAL))?/i)
  const clave = (m?.[2] ?? m?.[1] ?? p.sala ?? '').toLowerCase()
  const casacion = SALAS_CASACION[clave]
  return casacion ? `Sala de Casación ${casacion}` : ''
}

/**
 * `Corte Suprema de Justicia, Sala de Casación Laboral, Sentencia STL2503-2025
 * (M.P. Marjorie Zúñiga Romero; 2025)`.
 *
 * El identificador es el `titulo` tal cual: su índice mezcla formatos
 * ("STL2503-2025", "AC4729-2024 [2024-01302-00]", "28483(31-10-06)") y
 * reescribirlo sería inventar. La fecha NO se incluye: `fecha` es la de carga
 * del índice, no la del fallo; solo el año (`anio`) es de fiar, y el día y el
 * mes quedan declarados en `faltan`. `clase` solo distingue "SENTENCIA" y
 * "AUTO"; si viene vacío, no se escribe la palabra. Devuelve `null` sin
 * `titulo`.
 */
export function citaCorteSuprema(p: DatosCorteSuprema): Cita | null {
  const titulo = (p.titulo ?? '').trim()
  if (!titulo) return null

  const faltan: string[] = []
  const sala = salaDeCasacion(p)
  if (!sala) faltan.push('sala')

  const clase = (p.clase ?? '').trim().toUpperCase()
  const etiqueta = clase === 'SENTENCIA' ? 'Sentencia' : clase === 'AUTO' ? 'Auto' : ''
  if (!etiqueta) faltan.push('tipo (sentencia o auto)')

  const ponente = (p.magistrado ?? '').replace(/\s+/g, ' ').trim()
  if (!ponente) faltan.push('ponente')

  const anio = Number.isInteger(p.anio) && p.anio > 0 ? String(p.anio) : ''
  if (!anio) faltan.push('año')
  faltan.push('día y mes del fallo (la fuente solo publica el año)')

  const partes = ['Corte Suprema de Justicia', sala, [etiqueta, titulo].filter(Boolean).join(' ')].filter(Boolean)
  const cola = [ponente ? `M.P. ${ponente}` : '', anio].filter(Boolean).join('; ')
  return { cita: `${partes.join(', ')}${cola ? ` (${cola})` : ''}`, faltan }
}
