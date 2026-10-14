import type { Disyuntor } from './disyuntor.ts'
import { pausa, type Ritmo } from './ritmo.ts'
import type { Cruda } from './transporte.ts'

/** `Retry-After` puede venir en segundos o como fecha HTTP. */
function esperaSugerida(cabecera: string): number {
  if (!cabecera) return 0
  const segundos = Number(cabecera)
  if (Number.isFinite(segundos)) return Math.max(0, segundos * 1000)
  const fecha = Date.parse(cabecera)
  return Number.isNaN(fecha) ? 0 : Math.max(0, fecha - Date.now())
}

const ESPERA_MAXIMA_MS = 30_000

/** El portal pide calma: 429 (demasiadas peticiones) o 503 (no disponible). */
export const pideCalma = (status: number): boolean => status === 429 || status === 503

/** La política de reintento sobre el ritmo y el disyuntor de una instancia de red. */
export function crearReintento({ ritmo, disyuntor }: { ritmo: Ritmo; disyuntor: Disyuntor }) {
  const { enCola, vaciarCubo } = ritmo
  const { anotarFallo } = disyuntor

  /**
   * La petición con la política de reintento común a `pedir` y `pedirBytes`: si el
   * portal pide calma, se le hace caso en vez de insistir al mismo ritmo. Una
   * espera (la de `Retry-After`, o 2 s si no la da, con techo de 30 s), el cubo del
   * host vaciado y un segundo intento. Devuelve la última respuesta, que puede
   * seguir siendo 429/503: qué hacer con ella lo decide el llamador.
   */
  async function conReintento(url: string, hacer: () => Promise<Cruda>, conCopia = false): Promise<Cruda> {
    const host = new URL(url).host
    for (let intento = 0; ; intento++) {
      const t0 = Date.now()
      const r = await enCola(host, hacer)
      if (process.env['MEDIR_RED']) {
        process.stderr.write(
          `${JSON.stringify({ red: Date.now() - t0, host, url, status: r.status, bytes: r.datos.length, copia: conCopia, ts: new Date().toISOString() })}\n`,
        )
      }
      if (!pideCalma(r.status) || intento > 0) return r
      await pausa(Math.min(esperaSugerida(r.retryAfter) || 2000, ESPERA_MAXIMA_MS))
      // Se vacía el cubo: veníamos yendo más rápido de lo que el sitio tolera.
      vaciarCubo(host)
    }
  }

  /**
   * El portal siguió pidiendo calma tras el reintento. Cuenta para el breaker: un
   * host que limita no está sano, y tres seguidos lo pausan como un 5xx.
   */
  function errorDeCalma(host: string, status: number): Error {
    anotarFallo(host, `HTTP ${status}`)
    return new Error(`El portal está limitando las consultas (${status}). Espera un momento y vuelve a intentarlo.`)
  }

  return { conReintento, errorDeCalma }
}

export type Reintento = ReturnType<typeof crearReintento>
