// --- ritmo ---------------------------------------------------------------

/**
 * Una petición por segundo por dominio, sin ráfagas.
 *
 * Ningún portal declara `Crawl-delay`, así que la cifra es criterio propio. La
 * capacidad vale 1 —no 5— porque el lote de citas y las pestañas de la Unidad
 * de Víctimas encadenan varias peticiones a la MISMA fuente en una sola
 * interacción: el techo sostenido ya era 1/s con la ráfaga de 5, pero la ráfaga
 * convierte ese techo en "primera consulta instantánea, después 1/s", y con
 * varios lotes en paralelo (dos clientes del MCP) la ráfaga se repite por
 * cubo. El costo es una demora de 1 s en la primera petición de cada lote.
 *
 * Lo que de verdad impide apilar carga sobre un servicio público es la
 * serialización: una sola petición en vuelo por dominio.
 */
const CAPACIDAD = 1
const RELLENO_MS = 1000

export const pausa = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

type Cubo = { fichas: number; ultimo: number }

/** El ritmo por dominio de una instancia de red: cubos, colas y registro de salidas. */
export function crearRitmo() {
  const cubos = new Map<string, Cubo>()
  const colas = new Map<string, Promise<unknown>>()

  async function ficha(host: string): Promise<void> {
    const c = cubos.get(host) ?? { fichas: CAPACIDAD, ultimo: Date.now() }
    cubos.set(host, c)

    const ahora = Date.now()
    c.fichas = Math.min(CAPACIDAD, c.fichas + (ahora - c.ultimo) / RELLENO_MS)
    c.ultimo = ahora

    if (c.fichas < 1) {
      await pausa((1 - c.fichas) * RELLENO_MS)
      c.fichas = 1
      c.ultimo = Date.now()
    }
    c.fichas -= 1
  }

  /**
   * Timestamps en que cada petición de `host` recibió su ficha (cuando salió de
   * la cola), para que las pruebas verifiquen el espaciado sin tocar la red.
   */
  const despegues = new Map<string, number[]>()

  /** Timestamps de salida de `host` en el orden en que ocurrieron. */
  function ritmoPorDominio(host: string): number[] {
    return [...(despegues.get(host) ?? [])]
  }

  /**
   * Serializa por dominio: nunca hay dos peticiones simultáneas al mismo sitio,
   * y cada una espera su ficha (1/s sostenido) antes de salir a la red.
   * Exportada para que las pruebas midan el ritmo con un `pedir` mockeado.
   */
  async function enCola<T>(host: string, fn: () => Promise<T>): Promise<T> {
    const previa = colas.get(host) ?? Promise.resolve()
    const tarea = previa.then(async () => {
      await ficha(host)
      despegues.set(host, [...(despegues.get(host) ?? []), Date.now()])
      return fn()
    })
    colas.set(
      host,
      tarea.catch(() => {}),
    )
    return tarea
  }

  /** Vacía el cubo del host: veníamos yendo más rápido de lo que el sitio tolera. */
  function vaciarCubo(host: string): void {
    cubos.set(host, { fichas: 0, ultimo: Date.now() })
  }

  return { enCola, ritmoPorDominio, vaciarCubo }
}

export type Ritmo = ReturnType<typeof crearRitmo>
