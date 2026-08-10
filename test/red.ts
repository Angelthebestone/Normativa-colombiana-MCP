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

export class Cliente {
  private proc: ChildProcessWithoutNullStreams
  private buffer = ''
  private siguiente = 1
  private pendientes = new Map<number, { ok: (v: any) => void; fallo: (e: Error) => void }>()

  constructor() {
    this.proc = spawn(process.execPath, [SERVIDOR], { stdio: ['pipe', 'pipe', 'pipe'] })
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
