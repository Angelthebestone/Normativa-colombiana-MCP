/**
 * Transporte HTTP del servidor. La implementación vive en `http/`, un módulo por
 * responsabilidad; este fichero publica lo que usan las fuentes y las pruebas.
 *
 * Estado: cada transporte es una instancia (`crearRed`). El servidor usa una
 * sola, `red`, que se comparte a propósito durante toda la vida del proceso: el
 * ritmo por dominio, los interruptores y los contadores solo tienen sentido si
 * todas las fuentes pasan por el mismo, porque dos instancias duplicarían la
 * carga sobre los portales.
 */
import { cache } from './cache.ts'
import { crearRed } from './http/red.ts'

export { crearRed, type Red } from './http/red.ts'
export { decodificar } from './http/decodificar.ts'
export { errorDegradado } from './http/disyuntor.ts'
export type { OpcionesPedir, Respuesta } from './http/tipos.ts'
export { cuerpoDe, TOPE_BINARIO, TOPE_TEXTO, TopeExcedido, VERSION } from './http/transporte.ts'

/** El transporte del proceso. */
export const red = crearRed({ copias: cache.copias })
export const { anotarFallo, enCola, estadoDe, pedir, pedirBytes, pedirJson, redResumen, restablecer, ritmoPorDominio } = red
