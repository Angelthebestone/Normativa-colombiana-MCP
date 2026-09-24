/**
 * Red de pruebas de regresión: helper compartido que arranca el servidor
 * compilado y le habla por stdio con JSON-RPC crudo, leyendo `content[0].text`
 * y `isError` tal como las entrega el protocolo. Lo usan test/e2e.ts y las
 * suites por dominio (test/red-*.ts), que corren como subprocesos
 * independientes (`node --test test/red-*.ts`) para no compartir estado.
 *
 *   npm run build && node --test test/red-*.ts
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const SERVIDOR = fileURLToPath(new URL('../server/index.js', import.meta.url))

/** Sin red: los casos que consultan portales se saltan y solo corren los de contrato. */
export const CONTRATO = { timeout: 30_000 }
export const LENTO = { timeout: 240_000, skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }

/** Una línea del log de uso que el servidor escribe en stderr por cada llamada. */
export type LineaDeUso = {
  herramienta: string
  ms: number
  ok: boolean
  /** Peticiones HTTP acumuladas por el proceso hasta terminar esta llamada. */
  peticiones: number
  bytes: number
  error?: string
}

export class Cliente {
  private proc: ChildProcessWithoutNullStreams
  private buffer = ''
  private errBuffer = ''
  private usos: LineaDeUso[] = []
  private siguiente = 1
  private pendientes = new Map<number, { ok: (v: any) => void; fallo: (e: Error) => void }>()

  constructor() {
    this.proc = spawn(process.execPath, [SERVIDOR], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stderr.on('data', (d: Buffer) => {
      this.errBuffer += d.toString('utf8')
      let corte: number
      while ((corte = this.errBuffer.indexOf('\n')) !== -1) {
        const linea = this.errBuffer.slice(0, corte).trim()
        this.errBuffer = this.errBuffer.slice(corte + 1)
        if (!linea) continue
        try {
          const o = JSON.parse(linea) as LineaDeUso
          if (o && typeof o.herramienta === 'string') this.usos.push(o)
        } catch {
          /* el stderr del server no es solo este log: se ignora lo que no parsea */
        }
      }
    })
    // Sin unref, el runner de node:test espera a que el child cierre su stdio
    // al salir y se cuelga aunque los tests hayan terminado.
    this.proc.unref()
    this.proc.stdout.on('data', (d: Buffer) => {
      this.buffer += d.toString('utf8')
      let corte: number
      while ((corte = this.buffer.indexOf('\n')) !== -1) {
        const linea = this.buffer.slice(0, corte).trim()
        this.buffer = this.buffer.slice(corte + 1)
        if (!linea) continue
        const msg = JSON.parse(linea)
        const p = this.pendientes.get(msg.id)
        if (!p) continue
        this.pendientes.delete(msg.id)
        if (msg.error) p.fallo(new Error(JSON.stringify(msg.error)))
        else p.ok(msg.result)
      }
    })
  }

  peticion(method: string, params?: unknown): Promise<any> {
    const id = this.siguiente++
    return new Promise((ok, fallo) => {
      this.pendientes.set(id, { ok, fallo })
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      setTimeout(() => {
        if (this.pendientes.delete(id)) fallo(new Error(`sin respuesta a ${method} tras 120 s`))
      }, 120_000)
    })
  }

  /** Devuelve el texto de la herramienta. `isError` distingue fallo real de "no hay resultados". */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<{ texto: string; esError: boolean }> {
    const r = await this.peticion('tools/call', { name, arguments: args })
    return { texto: r.content?.[0]?.text ?? '', esError: r.isError === true }
  }

  /**
   * Peticiones HTTP que el servidor gastó en la última llamada a `nombre`.
   * El contador es acumulado del proceso; la diferencia entre el valor anterior
   * y el de esa llamada es lo que costó de verdad. Sirve para lo que no se ve
   * en la respuesta: si un error de uso llegó a la red.
   */
  ultimoUso(nombre: string): LineaDeUso | undefined {
    return [...this.usos].reverse().find((u) => u.herramienta === nombre)
  }

  /**
   * Peticiones HTTP acumuladas por el proceso hasta la última llamada terminada.
   * El contador es del proceso entero, así que la única forma correcta de medir
   * lo que costó UNA llamada es diferenciar contra el valor de antes: quedarse
   * con `ultimoUso(tool).peticiones` da el total acumulado la primera vez que se
   * usa esa herramienta, y eso convierte una resta en una suma.
   */
  peticionesAcumuladas(): number {
    return this.usos[this.usos.length - 1]?.peticiones ?? 0
  }

  cerrar(): void {
    // SIGKILL directo: el server no maneja SIGTERM de forma fiable y quedarse
    // esperando el exit cuelga el runner. El child ya está unref'd.
    this.proc.kill('SIGKILL')
  }
}

/** Abre un cliente ya inicializado; llama a `cerrar` en `after`. */
export async function abrirCliente(): Promise<Cliente> {
  const c = new Cliente()
  await c.peticion('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'red', version: '1' },
  })
  return c
}
