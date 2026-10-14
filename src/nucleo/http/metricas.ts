/**
 * Contadores de red del proceso: peticiones, bytes, URLs repetidas y copias
 * servidas sin salir a la red. Los repetidos se cuentan por URL, que es como se
 * mide cuánto se vuelve a descargar la misma norma en una sesión.
 */
let totalPeticiones = 0
let totalBytes = 0
let totalCopias = 0
let totalRepetidas = 0
const pedidas = new Map<string, number>()

export function redResumen(): { peticiones: number; bytes: number; repetidas: number; copias: number } {
  return { peticiones: totalPeticiones, bytes: totalBytes, repetidas: totalRepetidas, copias: totalCopias }
}

export function anotarRed(bytes: number): void {
  totalPeticiones += 1
  totalBytes += bytes
}

/** Una URL que ya se había pedido en este proceso: la métrica de lo repetido. */
export function anotarUrl(url: string): void {
  const n = (pedidas.get(url) ?? 0) + 1
  pedidas.set(url, n)
  if (n > 1) totalRepetidas += 1
}

/** Una copia servida sin salir a la red. */
export function anotarCopia(): void {
  totalCopias += 1
}
