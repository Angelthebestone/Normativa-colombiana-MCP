/**
 * Detección de «portal roto», en dos escalas que comparten el mismo criterio
 * —marcar solo lo que se puede afirmar—:
 *
 *  1. Enlace: discordancia entre el número del epígrafe y el del archivo
 *     enlazado. Un archivo genérico sin número no marca.
 *  2. Dominio: el portal no sirve lo que se le pide. Medido el 2026-09-16,
 *     SUIN contesta 301 cuyo `Location` es idéntico a la URL pedida —un bucle a
 *     sí mismo—; seguirlo no lleva a ninguna parte y contarlo como «respuesta»
 *     esconde que la fuente está caída. Eso lo consume el circuit breaker de
 *     `http.ts`, para que el host quede degradado y se diga cuándo reintentar.
 */
import { sinTildes } from './parse.ts'

/** Número(s) de la norma dentro del epígrafe: "Ley 2021 de 2021" → ["2021"]. */
export function numeroDelEpigrafe(epigrafe: string): string[] {
  const normal = sinTildes(epigrafe).toLowerCase()
  // Tipo seguido de número: "ley 2021", "resolucion no. 056", "acto 3".
  const m = normal.match(
    /\b(?:ley|decreto|resolucion|circular|acuerdo|acto|auto|sentencia)\s+(?:n[ºo°.]*\s*)?(\d{1,6})\b/,
  )
  return m ? [m[1]!] : []
}

/** Número(s) del nombre del archivo, EXCLUYENDO los años: "ley-2101-2021.pdf" → ["2101"]. */
export function numeroDelArchivo(url: string): string[] {
  const nombre = url.split(/[?#]/)[0]!.split('/').pop() ?? ''
  return [...nombre.matchAll(/\b(\d{3,6})\b/g)]
    .map((m) => m[1]!)
    .filter((n) => !/^(19|20)\d{2}$/.test(n))
}

/**
 * Devuelve una advertencia si el número del epígrafe no coincide con el del
 * archivo enlazado (discordancia clara), o `null` si concuerdan o el archivo
 * no tiene número que comparar.
 */
export function advertenciaPortalRoto(epigrafe: string, url: string): string | null {
  const delEpigrafe = numeroDelEpigrafe(epigrafe)
  if (!delEpigrafe.length) return null
  const delArchivo = numeroDelArchivo(url)
  if (!delArchivo.length) return null // archivo genérico: no se puede afirmar nada

  const coincide = delArchivo.some((n) => delEpigrafe.includes(n) || n.includes(delEpigrafe[0]!))
  if (coincide) return null
  return `Advertencia: el número del epígrafe (${delEpigrafe[0]}) no coincide con el del archivo enlazado (${delArchivo[0]}): ${url}. Verifica antes de citar.`
}

// --- portal roto a nivel de dominio --------------------------------------

export type Diagnostico = { roto: boolean; motivo?: string }

/** Páginas que un portal sirve cuando está de mantenimiento o fuera de línea. */
const MANTENIMIENTO =
  /en mantenimiento|bajo mantenimiento|en construcci[oó]n|fuera de servicio|service unavailable|under maintenance|temporalmente no disponible|sitio no disponible/i

/**
 * ¿La respuesta es evidencia de que el portal no está sirviendo? Solo se marca
 * lo afirmable: un redirect que apunta a la misma URL (bucle, el síntoma de
 * SUIN) o una página de mantenimiento. Un 404 no entra: el documento puede no
 * existir sin que el portal esté roto, y confundir las dos cosas es peor que no
 * detectar nada.
 */
export function diagnosticarRespuesta(
  pedida: string,
  status: number,
  cabeceras: Record<string, string>,
  cuerpo: string,
): Diagnostico {
  if (status >= 300 && status < 400) {
    const destino = cabeceras['location']
    if (!destino) return { roto: true, motivo: `redirige con ${status} sin decir a dónde` }
    let resuelto: string
    try {
      resuelto = new URL(destino, pedida).toString()
    } catch {
      return { roto: false } // un Location que no es URL es del portal, no de su disponibilidad
    }
    // El bucle a sí mismo: el mismo recurso, con o sin barra final.
    const limpiar = (u: string): string => u.replace(/\/+$/, '').toLowerCase()
    if (limpiar(resuelto) === limpiar(pedida)) return { roto: true, motivo: `${status} que apunta a la misma URL (bucle)` }
    return { roto: false }
  }
  if (status === 503 || MANTENIMIENTO.test(cuerpo.slice(0, 2000))) {
    return { roto: true, motivo: status === 503 ? '503 del portal' : 'página de mantenimiento' }
  }
  return { roto: false }
}

/** YYYY-MM-DD en UTC: la fecha de la copia, sin hora ni zona que la hagan ilegible. */
export const fechaCorta = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/**
 * Rótulo obligatorio de una respuesta degradada. Sin esto no se sirve la copia:
 * una degradada sin rotular es peor que un vacío, porque el modelo la lee como
 * si viniera de la fuente en vivo.
 */
export function rotuloCopia(fuente: string, fechaMs: number): string {
  return `AVISO: la fuente ${fuente} no respondió; este texto viene de una copia consultada el ${fechaCorta(fechaMs)} y puede no reflejar cambios posteriores.`
}
