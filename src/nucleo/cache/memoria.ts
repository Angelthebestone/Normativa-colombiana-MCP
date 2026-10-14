/** Valores genéricos con TTL en memoria: búsquedas y consultas por número. */

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
 * Cuánto se recuerda la respuesta de una búsqueda o de una consulta por número: no es
 * una copia de documento, así que no se revalida y el TTL es lo único que acota su
 * antigüedad. Medido el 2026-09-29: consultar_vigencia y luego resolver_cita sobre la
 * misma norma repetían las dos mismas búsquedas (Gestor y SUIN), y lo mismo hace todo el
 * flujo de verificar una cita.
 *
 * ponytail: 5 minutos fijos y en memoria. El techo es que algo publicado dentro de esa
 * ventana se siga declarando ausente; el salto siguiente, un TTL menor solo para lo negativo.
 */
export const TTL_BUSQUEDA_MS = 5 * 60_000
