/**
 * Expediente temporal de investigación en memoria: agrupa preguntas, fuentes,
 * documentos, citas, decisiones y observaciones de una sesión. Nunca escribe a
 * disco; expira por TTL y se limpia solo lo que se toca.
 */

export type Expediente = {
  preguntas: string[]
  fuentes: string[]
  documentos: string[]
  citas: string[]
  decisiones: string[]
  observaciones: string[]
}

const TTL_DEFECTO_MS = 6 * 3600 * 1000

const expedientes = new Map<string, { datos: Expediente; creado: number }>()

// TTL por entrada distinto del defecto: solo lo usan las pruebas.
const ttlEspecial = new Map<string, number>()

/** El feature se enciende con EXPEDIENTES=1; se relee en cada llamada. */
export function habilitado(): boolean {
  return process.env['EXPEDIENTES'] === '1'
}

function ttlDe(id: string): number {
  return ttlEspecial.get(id) ?? TTL_DEFECTO_MS
}

/** Entrada viva, o null si no existe o expiró (el barrido es perezoso: se borra al tocarla). */
function vivo(id: string): { datos: Expediente; creado: number } | null {
  const e = expedientes.get(id)
  if (!e) return null
  if (Date.now() - e.creado > ttlDe(id)) {
    expedientes.delete(id)
    ttlEspecial.delete(id)
    return null
  }
  return e
}

export function crear(ttlMs?: number): string {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  if (ttlMs !== undefined) ttlEspecial.set(id, ttlMs)
  expedientes.set(id, {
    datos: { preguntas: [], fuentes: [], documentos: [], citas: [], decisiones: [], observaciones: [] },
    creado: Date.now(),
  })
  return id
}

export function agregar(id: string, campo: keyof Expediente, texto: string): boolean {
  if (!texto) return false
  const e = vivo(id)
  if (!e) return false
  e.datos[campo].push(texto)
  return true
}

export function leer(id: string): Expediente | null {
  const e = vivo(id)
  return e ? e.datos : null
}
