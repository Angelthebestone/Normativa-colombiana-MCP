/**
 * Tres fallos seguidos (error de red o 5xx) en una ventana marcan el host
 * "degradado" durante 60 s: las llamadas en ese tramo ni tocan la red y
 * lanzan un error que declara cuándo se vuelve a intentar. Al vencer la
 * ventana se reintenta y, si acierta, el host se restablece.
 */
const DEGRADADO_MS = 60_000
const UMBRAL_FALLOS = 3

/** `ultimo` es la causa del último fallo (HTTP 503, error de red…): la que el error de la pausa tiene que decir. */
type Breaker = { fallos: number; desde: number; hasta: number | null; ultimo: string }
const breakers = new Map<string, Breaker>()

function breaker(host: string): Breaker {
  let b = breakers.get(host)
  if (!b) {
    b = { fallos: 0, desde: Date.now(), hasta: null, ultimo: '' }
    breakers.set(host, b)
  }
  return b
}

/** Estado declarado de un host: si está degradado, por qué y cuándo se vuelve a llamar a la fuente. */
export function estadoDe(host: string): { degradado: boolean; reintentaEnMs?: number; causa?: string } {
  const b = breaker(host)
  const ahora = Date.now()
  if (b.hasta !== null && ahora >= b.hasta) {
    b.fallos = 0
    b.desde = ahora
    b.hasta = null
  }
  return b.hasta === null ? { degradado: false } : { degradado: true, reintentaEnMs: b.hasta - ahora, causa: b.ultimo }
}

/** Anota un fallo de red o 5xx, con su causa, y arma la pausa al llegar al umbral. */
export function anotarFallo(host: string, causa: string): void {
  const b = breaker(host)
  const ahora = Date.now()
  if (b.hasta !== null && ahora >= b.hasta) {
    b.fallos = 0
    b.desde = ahora
    b.hasta = null
  }
  b.fallos += 1
  b.ultimo = causa
  if (b.fallos >= UMBRAL_FALLOS) {
    b.hasta = ahora + DEGRADADO_MS
    b.fallos = 0
  }
}

/** Marca el host como sano tras una petición que sí respondió. */
export function restablecer(host: string): void {
  breakers.delete(host)
}

/**
 * Error con el que se corta la llamada mientras el host está degradado. Nombra la
 * causa del fallo y no promete un reintento que nadie hace: pasada la pausa, la
 * siguiente llamada del usuario vuelve a la fuente. Distingue la pausa recién
 * armada (queda casi toda la ventana) de la que sigue en curso.
 */
export function errorDegradado(host: string, reintentaEnMs: number, causa: string): Error {
  const quedan = Math.max(1, Math.round(reintentaEnMs / 1000))
  if (reintentaEnMs > DEGRADADO_MS - 5_000) {
    return new Error(
      `La fuente ${host} quedó degradada: no respondió (${causa}). No se reintenta sola; las llamadas a ${host} ` +
        `se cortan ${quedan} s y pasado ese plazo se vuelve a llamar a la fuente.`,
    )
  }
  return new Error(
    `La fuente ${host} sigue degradada por ${causa}; quedan ${quedan} s de pausa y esta llamada no salió a la red ` +
      `(no se llamó a la fuente).`,
  )
}
