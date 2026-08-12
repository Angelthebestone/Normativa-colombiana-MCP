/**
 * Detección de «portal roto»: discordancia entre el número citado en el epígrafe
 * y el número del nombre del archivo enlazado. Regla conservadora: solo se
 * marca cuando el epígrafe tiene número Y el archivo tiene un número distinto;
 * un archivo genérico sin número no marca, ni una variante del mismo número.
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
