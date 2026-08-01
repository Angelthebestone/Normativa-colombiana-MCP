/**
 * Aviso de versión nueva.
 *
 * El problema que resuelve es real —se publican versiones cada pocos días y
 * quien instaló el .mcpb no se entera— pero la solución fácil es peor que el
 * problema: un recordatorio en cada respuesta convierte la herramienta en un
 * software que da la lata, y en un contexto jurídico compite con el texto de la
 * norma por la atención de quien lee.
 *
 * Por eso:
 *
 * - Se consulta UNA vez por proceso, y solo cuando ya se pidió algo. Nunca en
 *   el arranque: no vale la pena retrasar el `initialize` por esto.
 * - Se avisa UNA sola vez por sesión, en la primera respuesta, y nunca más.
 * - Si el registro no contesta en tres segundos, se calla para siempre. Un
 *   fallo de red no puede degradar una consulta legal.
 * - Solo se avisa de versiones MAYORES o MENORES. Un parche no merece
 *   interrumpir a nadie; se recogerá cuando actualice por otra razón.
 */
import { VERSION, pedir } from './http.ts'

const REGISTRO = 'https://registry.npmjs.org/normativa-colombia-mcp/latest'

let comprobado = false
let yaAvisado = false
let disponible: string | null = null

const trozos = (v: string): number[] => v.split('.').map((n) => Number(n) || 0)

/** ¿`b` es mayor que `a` en algo que no sea el parche? */
export function mereceAviso(actual: string, nueva: string): boolean {
  const [aM = 0, am = 0] = trozos(actual)
  const [bM = 0, bm = 0] = trozos(nueva)
  return bM > aM || (bM === aM && bm > am)
}

/** Consulta el registro sin bloquear ni propagar errores. */
async function mirar(): Promise<void> {
  if (comprobado) return
  comprobado = true
  if (VERSION === 'dev') return // sin empaquetar no hay versión que comparar
  try {
    const r = await pedir(REGISTRO, 3000, 'application/json')
    if (r.status !== 200) return
    const v = (JSON.parse(r.cuerpo) as { version?: string }).version
    if (v && mereceAviso(VERSION, v)) disponible = v
  } catch {
    /* el registro es un lujo, no un requisito */
  }
}

/**
 * Línea que se añade a la primera respuesta si hay versión nueva, y vacío
 * siempre después. Se dispara la comprobación y se sigue: la primera respuesta
 * de la sesión no espera por ella.
 */
export function avisoVersion(): string {
  if (yaAvisado) return ''
  if (!comprobado) {
    void mirar()
    return ''
  }
  if (!disponible) return ''
  yaAvisado = true
  return (
    `\n\nHay una versión nueva de esta extensión: ${VERSION} → ${disponible}. ` +
    `Si la instalaste con npx se actualiza sola al reiniciar el cliente; si usas el .mcpb, descárgalo de ` +
    `https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases. Este aviso no se repite.`
  )
}
