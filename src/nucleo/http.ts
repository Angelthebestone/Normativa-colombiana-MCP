/**
 * Transporte HTTP del servidor. La implementación vive en `http/`, un módulo por
 * responsabilidad; este fichero solo publica lo que usan las fuentes y las pruebas.
 */
export { pedirBytes } from './http/bytes.ts'
export { decodificar } from './http/decodificar.ts'
export { anotarFallo, errorDegradado, estadoDe, restablecer } from './http/disyuntor.ts'
export { redResumen } from './http/metricas.ts'
export { pedir, pedirJson } from './http/pedir.ts'
export { enCola, ritmoPorDominio } from './http/ritmo.ts'
export type { OpcionesPedir, Respuesta } from './http/tipos.ts'
export { cuerpoDe, TOPE_BINARIO, TOPE_TEXTO, TopeExcedido, VERSION } from './http/transporte.ts'
