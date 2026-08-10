/**
 * Cache en memoria de búsquedas y documentos, con TTL corto y barrido perezoso.
 * Aditivo: cada módulo lo usa sin cambiar su contrato; la integración en
 * gestor/corte/dian la hace el paso de integración.
 */

type Entrada = { valor: unknown; vence: number }

const entradas = new Map<string, Entrada>()

/**
 * Valor fresco para `clave`, o null si no está o expiró (barrido perezoso:
 * la entrada vencida se borra al tocarla y la próxima llamada la recalcula).
 */
export function obtener(clave: string): unknown | null {
  const e = entradas.get(clave)
  if (!e) return null
  if (Date.now() > e.vence) {
    entradas.delete(clave)
    return null
  }
  return e.valor
}

/** Guarda `valor` bajo `clave` hasta `ttlMs` milisegundos desde ahora. */
export function poner(clave: string, valor: unknown, ttlMs: number): void {
  entradas.set(clave, { valor, vence: Date.now() + ttlMs })
}

/**
 * Devuelve el valor cacheado si está fresco; si no, ejecuta `fn`, lo cachea
 * con `ttlMs` y lo devuelve. `fn` es async para servir a los módulos de
 * fuentes, que consultan la red.
 */
export async function conCache<T>(clave: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const fresco = obtener(clave)
  if (fresco !== null) return fresco as T
  const valor = await fn()
  poner(clave, valor, ttlMs)
  return valor
}
