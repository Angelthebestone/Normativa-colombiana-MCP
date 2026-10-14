/**
 * Cache del servidor. La implementación vive en `cache/`, un módulo por
 * responsabilidad; este fichero solo publica lo que usan las fuentes, el
 * transporte y las pruebas.
 *
 * El TTL no es único porque las normas no envejecen igual: la Constitución casi
 * no cambia, una ley de 1993 poco y una de este año puede cambiar mañana.
 */
export {
  cabecerasCondicionales,
  copiasGuardadas,
  esDescargaCacheable,
  guardarCopia,
  limpiarCopias,
  obtenerCopia,
  refrescarCopia,
} from './cache/copias.ts'
export { obtener, poner, TTL_BUSQUEDA_MS } from './cache/memoria.ts'
export type { Copia } from './cache/tipos.ts'
export { claseDeNorma, identidadDeNorma, ttlDeNorma, type ClaseNorma, type Identidad } from './cache/ttl.ts'
