/**
 * La fecha de negocio del servidor: el día en Colombia.
 *
 * Una consulta jurídica colombiana se fecha con el día de Bogotá, no con el de
 * la máquina ni con el de UTC. `toISOString()` pasa al día siguiente a las 19:00
 * de Bogotá, y los getters locales dependen de la zona que tenga configurada el
 * host: con cualquiera de los dos, la misma sesión podía fechar respuestas con
 * días distintos o decidir la entrada en vigor contra un día que no es el
 * colombiano. Los timestamps técnicos (logs, contadores de red) siguen en UTC.
 */

const BOGOTA = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** AAAA-MM-DD del instante dado (por defecto, ahora) en America/Bogota. */
export const fechaBogota = (instante: Date = new Date()): string => BOGOTA.format(instante)

/** El año en curso en Colombia. */
export const anioBogota = (instante: Date = new Date()): number => Number(fechaBogota(instante).slice(0, 4))
