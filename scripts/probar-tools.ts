/**
 * Inspector de salidas de las herramientas MCP: arranca el servidor compilado y
 * le habla por stdio (JSON-RPC, igual que un cliente real), dispara cada
 * herramienta con casos de ejemplo y vuelca el texto que devuelve. Sirve para
 * COMPROBAR A OJO los outputs sin pasar por node --test.
 *
 * Uso:
 *   node scripts/probar-tools.ts [filtro]        # filtro por nombre (subcadena)
 *   SIN_RED=1 node scripts/probar-tools.ts       # salta las que tocan portales
 *   node scripts/probar-tools.ts validar_cita    # solo las que contengan eso
 *
 * Prerequisito: npm run build (el servidor vive en server/index.js).
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SERVIDOR = fileURLToPath(new URL('../server/index.js', import.meta.url))
const SIN_RED = process.env['SIN_RED'] === '1'
const filtro = process.argv[2]?.toLowerCase() ?? ''

type Tool = { name: string; description: string; inputSchema: { properties?: Record<string, unknown>; required?: string[] } }

/** Un caso = la herramienta y los argumentos con que se prueba. */
const CASOS: { tool: string; args: Record<string, unknown>; red: boolean; nota?: string }[] = [
  // --- rutas existentes -------------------------------------------------
  { tool: 'resolver_cita', args: { cita: 'Ley 909 de 2004' }, red: true },
  { tool: 'resolver_cita', args: { cita: 'Decreto 1072' }, red: true, nota: 'ambiguo: debe pedir el año' },
  { tool: 'resolver_cita', args: { cita: 'art. 6 de la Ley 1221 de 2008' }, red: true },
  { tool: 'resolver_cita', args: { cita: 'Ley 99999999 de 1800' }, red: true, nota: 'inexistente' },
  { tool: 'buscar_normas', args: { palabras: 'teletrabajo', limite: 3 }, red: true },
  { tool: 'buscar_normas', args: { entidad: 'dian', palabras: 'reforma', limite: 3 }, red: true, nota: 'idea 6: entidad normalizada' },
  { tool: 'buscar_por_tema', args: { texto: 'teletrabajo' }, red: false },
  { tool: 'obtener_norma', args: { id: '31431', buscar_en_texto: 'teletrabajo', limite_caracteres: 1200 }, red: true },
  { tool: 'obtener_norma', args: { id: '31431' }, red: true, nota: 'compiladora: debe avisar' },
  { tool: 'buscar_jurisprudencia', args: { termino: 'teletrabajo', limite: 3 }, red: true },
  { tool: 'buscar_jurisprudencia', args: { termino: 'teletrabajo', limite: 3 }, red: true, nota: 'idea 5 (se ve si cae a sinónimo)' },
  { tool: 'obtener_sentencia', args: { ruta: '2024/T-099-24.htm', seccion: 'decision', limite_caracteres: 1200 }, red: true },
  { tool: 'buscar_en_suin', args: { texto: 'teletrabajo', limite: 3 }, red: true, nota: 'idea 5: hueco conocido' },
  { tool: 'describir_fuentes', args: {}, red: false },
  { tool: 'describir_fuentes', args: { fuente: 'creg' }, red: false },
  { tool: 'listar_catalogos', args: { catalogo: 'tipos', limite: 5 }, red: true },
  { tool: 'explicar_relacion_tema', args: { temsubid: 'ts-38872', normid: '31431' }, red: true },

  // --- herramientas V2 ---------------------------------------------------
  { tool: 'consultar_por_jerarquia', args: { nivel: 'ley', texto: 'teletrabajo', limite: 3 }, red: true },
  { tool: 'consultar_por_jerarquia', args: { nivel: 'concepto', texto: 'prima', limite: 3 }, red: true },
  { tool: 'consultar_por_jerarquia', args: { nivel: 'jurisprudencia', texto: 'teletrabajo', limite: 3 }, red: true },
  { tool: 'analizar_conflicto', args: { norma_a: 'Ley 909 de 2004', norma_b: 'Decreto 1083 de 2015', sobre: 'encargo' }, red: true },
  { tool: 'cambios_desde', args: { normas: ['Ley 909 de 2004'], desde: '2020-01-01' }, red: true },
  { tool: 'validar_cita', args: { cita: 'Ley 909 de 2004' }, red: true },
  { tool: 'validar_cita', args: { cita: 'Ley 909 de 2004', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=31431' }, red: true },
  { tool: 'validar_cita', args: { cita: 'Ley 99999999 de 1800' }, red: true, nota: 'no validable' },
  { tool: 'comparar_articulos', args: { norma_a: 'Ley 909 de 2004', articulo_a: '2', norma_b: 'Decreto 1083 de 2015', articulo_b: '2' }, red: true },
  { tool: 'consultar_perfil', args: { perfil: 'laboral', texto: 'teletrabajo', limite: 3 }, red: true },
  { tool: 'consultar_perfil', args: { perfil: 'tributario', texto: 'retención', limite: 3 }, red: true },
  { tool: 'consultar_perfil', args: { perfil: 'no-existe', texto: 'x' }, red: false, nota: 'perfil inválido' },
  { tool: 'expediente_crear', args: {}, red: false },
  { tool: 'expediente_agregar', args: { id: 'abc', campo: 'citas', texto: 'Ley 909 de 2004' }, red: false, nota: 'sin EXPEDIENTES=1: desactivado' },
  { tool: 'expediente_leer', args: { id: 'abc' }, red: false },
  { tool: 'buscar_normativa_sectorial', args: { entidad: 'sic', texto: 'protección al consumidor', limite: 3 }, red: true },
  { tool: 'buscar_resoluciones_creg', args: { texto: 'solar', anio: '2024', limite: 3 }, red: true },
]

// --- cliente JSON-RPC mínimo ---------------------------------------------

class Cliente {
  private proc = spawn(process.execPath, [SERVIDOR], { stdio: ['pipe', 'pipe', 'pipe'] })
  private buffer = ''
  private siguiente = 1
  private pendientes = new Map<number, (v: any) => void>()

  constructor() {
    this.proc.stdout.on('data', (d: Buffer) => {
      this.buffer += d.toString('utf8')
      let corte: number
      while ((corte = this.buffer.indexOf('\n')) !== -1) {
        const linea = this.buffer.slice(0, corte).trim()
        this.buffer = this.buffer.slice(corte + 1)
        if (!linea) continue
        const msg = JSON.parse(linea) as { id?: number }
        const p = this.pendientes.get(msg.id ?? -1)
        if (p) {
          this.pendientes.delete(msg.id!)
          p(msg)
        }
      }
    })
  }

  peticion(method: string, params?: unknown): Promise<any> {
    const id = this.siguiente++
    return new Promise((ok) => {
      this.pendientes.set(id, ok)
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      setTimeout(() => {
        if (this.pendientes.delete(id)) ok({ timeout: true })
      }, 120_000)
    })
  }

  /** Devuelve el `result` de la respuesta, o el mensaje entero si fue un error/timeout. */
  async resultado(method: string, params?: unknown): Promise<any> {
    const msg = await this.peticion(method, params)
    return msg?.result ?? msg
  }

  cerrar() {
    this.proc.kill()
  }
}

// --- ejecución -----------------------------------------------------------

const c = new Cliente()
await c.resultado('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'inspector', version: '1' } })
await c.resultado('notifications/initialized')

const { tools } = (await c.resultado('tools/list')) as { tools: Tool[] }
const disponibles = tools.map((t) => t.name)

let corridos = 0
let omitidos = 0

for (const caso of CASOS) {
  if (!disponibles.includes(caso.tool)) {
    console.log(`\n### ${caso.tool} — NO EXISTE en el servidor`)
    continue
  }
  if (filtro && !caso.tool.toLowerCase().includes(filtro)) continue
  if (SIN_RED && caso.red) {
    omitidos++
    console.log(`\n### ${caso.tool} ${JSON.stringify(caso.args)} — [omitida, requiere red]${caso.nota ? ` (${caso.nota})` : ''}`)
    continue
  }
  corridos++
  const t0 = performance.now()
  const r = await c.peticion('tools/call', { name: caso.tool, arguments: caso.args })
  const ms = Math.round(performance.now() - t0)
  // tools/call responde { result: { content: [{ type:'text', text }], isError? } }
  const res = r?.result ?? r
  const texto = res?.content?.[0]?.text ?? `(sin content: ${JSON.stringify(r).slice(0, 200)})`
  const esError = res?.isError === true
  console.log(
    `\n### ${caso.tool} ${JSON.stringify(caso.args)} — ${ms} ms${esError ? ' [isError]' : ''}${caso.nota ? ` (${caso.nota})` : ''}\n${texto}`,
  )
}

c.cerrar()
console.log(`\n---\n${corridos} herramienta(s) ejecutadas, ${omitidos} omitida(s) por SIN_RED${filtro ? `, filtro "${filtro}"` : ''}`)
// El proceso hijo queda con stdout abierto; salir explícito evita colgar el script.
process.exit(0)
