/**
 * Parser de citas normativas colombianas.
 *
 * Es la consulta más frecuente ("¿qué dice la Ley 909 de 2004?") y el buscador
 * del portal la resuelve mal, porque une los términos con OR. En cambio
 * tipo+número+año devuelve exactamente un resultado, así que vale la pena
 * detectar la cita y saltarse el buscador.
 */
export { parsearCita, idTipo, candidatosAmbiguos, rutaDeSentencia, type Cita } from './cita.ts'
export { parsearRadicado, RE_RADICADO_23, type Corporacion, type Radicado } from './radicado.ts'
