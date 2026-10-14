/**
 * Cache del servidor. La implementación vive en `cache/`, un módulo por
 * responsabilidad; este fichero solo publica lo que usan las fuentes, el
 * transporte y las pruebas.
 *
 * El TTL no es único porque las normas no envejecen igual: la Constitución casi
 * no cambia, una ley de 1993 poco y una de este año puede cambiar mañana.
 *
 * Estado: cada caché es una instancia (`crearCache`). El servidor usa una sola,
 * `cache`, que se comparte a propósito durante toda la vida del proceso: sus
 * búsquedas y copias de documento sirven a todas las herramientas, y el
 * transporte la recibe por parámetro en `http.ts`.
 */
import { crearCopias } from './cache/copias.ts'
import { crearDisco } from './cache/disco.ts'
import { crearMemoria } from './cache/memoria.ts'

export { cabecerasCondicionales, esDescargaCacheable } from './cache/copias.ts'
export { TTL_BUSQUEDA_MS } from './cache/memoria.ts'
export type { Copia } from './cache/tipos.ts'
export { claseDeNorma, identidadDeNorma, ttlDeNorma, type ClaseNorma, type Identidad } from './cache/ttl.ts'

/** Una caché con su propio estado: búsquedas con TTL y copias de documento. */
export function crearCache() {
  return { memoria: crearMemoria(), copias: crearCopias(crearDisco()) }
}

export type Cache = ReturnType<typeof crearCache>

/** La caché del proceso. */
export const cache = crearCache()
export const { obtener, poner } = cache.memoria
export const { copiasGuardadas, guardarCopia, limpiarCopias, obtenerCopia, refrescarCopia } = cache.copias
