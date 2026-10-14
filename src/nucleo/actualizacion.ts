/**
 * Aviso de versión nueva.
 *
 * Quien lanza el servidor con `npx` sin `@latest` se queda con la copia que npx
 * dejó en su caché, y quien instaló el .mcpb no recibe nada solo. Este módulo
 * cierra esa brecha sin volverse una molestia: en un contexto jurídico un
 * recordatorio en cada respuesta compite con el texto de la norma.
 *
 * - La comprobación arranca en segundo plano al conectar, sin retrasar `initialize`.
 * - Se avisa UNA sola vez por proceso, en la primera respuesta que llegue con la
 *   comprobación ya resuelta.
 * - Si el registro no contesta en tres segundos, se calla. Un fallo de red no
 *   puede degradar una consulta legal.
 * - Se avisa de cualquier versión mayor, parche incluido: se publica seguido y
 *   cada parche corrige respuestas que un abogado podría estar citando.
 */
import { VERSION, pedir } from './http.ts'

const REGISTRO = 'https://registry.npmjs.org/normativa-colombia-mcp/latest'
const ESPERA_REGISTRO_MS = 3000
const RELEASES = 'https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases/latest'

type ConsultarUltima = () => Promise<string | null>

const trozos = (v: string): number[] => v.split('.').map((n) => Number(n) || 0)

/** ¿`nueva` es estrictamente mayor que `actual`? Compara mayor, menor y parche. */
export function esVersionNueva(actual: string, nueva: string): boolean {
  const a = trozos(actual)
  const b = trozos(nueva)
  for (let i = 0; i < 3; i++) {
    const diferencia = (b[i] ?? 0) - (a[i] ?? 0)
    if (diferencia !== 0) return diferencia > 0
  }
  return false
}

/** Última versión publicada en npm, o null si el registro no contesta. */
async function consultarRegistro(): Promise<string | null> {
  try {
    const r = await pedir(REGISTRO, ESPERA_REGISTRO_MS, 'application/json')
    if (r.status !== 200) return null
    return (JSON.parse(r.cuerpo) as { version?: string }).version ?? null
  } catch {
    return null // el registro es un lujo, no un requisito
  }
}

export function textoAviso(actual: string, nueva: string): string {
  return (
    `\n\nHay una versión nueva de esta extensión: ${actual} → ${nueva}. ` +
    `Con npx, reinicia el cliente (si no se actualiza, usa el argumento normativa-colombia-mcp@latest); ` +
    `con el .mcpb, descarga el nuevo de ${RELEASES}. Este aviso no se repite.`
  )
}

export interface AvisoVersion {
  /** Dispara la comprobación en segundo plano. Idempotente. */
  iniciar(): void
  /** El aviso la primera vez que hay versión nueva, y '' siempre después. */
  tomar(): string
}

export function crearAvisoVersion(
  versionActual: string,
  consultar: ConsultarUltima = consultarRegistro,
): AvisoVersion {
  let iniciada = false
  let disponible: string | null = null
  return {
    iniciar() {
      if (iniciada || versionActual === 'dev') return // sin empaquetar no hay versión que comparar
      iniciada = true
      void consultar().then((ultima) => {
        if (ultima && esVersionNueva(versionActual, ultima)) disponible = ultima
      })
    },
    tomar() {
      if (!disponible) return ''
      const nueva = disponible
      disponible = null
      return textoAviso(versionActual, nueva)
    },
  }
}

const delProceso = crearAvisoVersion(VERSION)

export const iniciarAvisoVersion = delProceso.iniciar
export const avisoVersion = delProceso.tomar
