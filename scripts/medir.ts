/**
 * Banco de medición del MCP. Solo mide lo que el usuario paga:
 * arranque en frío, primera respuesta útil, memoria y las funciones puras que
 * corren sobre documentos grandes. Lo que domina la red no se mide aquí porque
 * no lo controlamos (y el limitador de 1/s es deliberado).
 */
import { spawn } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')
const N = Number(process.env['N'] ?? 5)

const mediana = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}
const ms = (x: number): string => `${x.toFixed(1)} ms`

// --- 1. arranque en frío: spawn → respuesta a initialize -------------------

function arranque(peticionExtra: object | null): Promise<{ init: number; extra: number }> {
  return new Promise((resolve) => {
    const t0 = performance.now()
    const p = spawn('node', [`${RAIZ}/server/index.js`], { stdio: ['pipe', 'pipe', 'ignore'] })
    let buf = ''
    let tInit = 0
    p.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const linea = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!linea.trim()) continue
        const m = JSON.parse(linea) as { id?: number }
        if (m.id === 1) {
          tInit = performance.now() - t0
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
          if (!peticionExtra) {
            p.kill()
            return resolve({ init: tInit, extra: 0 })
          }
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, ...peticionExtra }) + '\n')
        }
        if (m.id === 2) {
          const extra = performance.now() - t0 - tInit
          p.kill()
          return resolve({ init: tInit, extra })
        }
      }
    })
    p.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'bench', version: '1' } },
      }) + '\n',
    )
  })
}

// --- 2. coste del índice temático y memoria -------------------------------

type Medida = { bytes: number; tLeer: number; tParse: number; entradas: number }

function indices(): Record<string, Medida> {
  const r: Record<string, Medida> = {}
  for (const f of ['indice-tematico.json', 'indice-suin.json']) {
    const ruta = `${RAIZ}/datos/${f}`
    const bytes = statSync(ruta).size
    const t0 = performance.now()
    const crudo = readFileSync(ruta, 'utf8')
    const tLeer = performance.now() - t0
    const t1 = performance.now()
    const j = JSON.parse(crudo) as { filas?: unknown[]; normas?: Record<string, string> }
    const tParse = performance.now() - t1
    r[f] = { bytes, tLeer, tParse, entradas: j.filas?.length ?? Object.keys(j.normas ?? {}).length }
  }
  return r
}

// --- 3. funciones puras sobre un documento grande -------------------------

async function puras() {
  const P = (await import(`file:///${RAIZ}/src/nucleo/parse.ts`)) as typeof import('../src/nucleo/parse.ts')
  // Un documento del tamaño del Decreto 1083 (925k) para medir el caso peor real.
  const base = readFileSync(`${RAIZ}/src/index.ts`, 'utf8')
  const texto = base.repeat(Math.ceil(925_000 / base.length)).slice(0, 925_000)

  const medir = (nombre: string, fn: () => unknown) => {
    const t: number[] = []
    for (let i = 0; i < N; i++) {
      const t0 = performance.now()
      fn()
      t.push(performance.now() - t0)
    }
    return { nombre, ms: mediana(t) }
  }

  return [
    medir('sinTildes(925k)', () => P.sinTildes(texto)),
    medir('fragmentos(925k, "norma")', () => P.fragmentos(texto, 'norma', 400, 10, 8000)),
    medir('indiceArticulos(925k)', () => P.indiceArticulos(texto)),
    medir('trocear(925k)', () => P.trocear(texto, 0, 8000)),
    medir('advertenciasVigencia(925k)', () => P.advertenciasVigencia(texto)),
  ]
}

// --- salida ----------------------------------------------------------------

console.log('bundle server/index.js:', (statSync(`${RAIZ}/server/index.js`).size / 1024).toFixed(0), 'KB')

const idx = indices()
for (const [f, v] of Object.entries(idx)) {
  console.log(
    `${f.padEnd(24)} ${(v.bytes / 1024 / 1024).toFixed(2)} MB  leer ${ms(v.tLeer)}  JSON.parse ${ms(v.tParse)}  ${v.entradas} entradas`,
  )
}

const fríos: number[] = []
for (let i = 0; i < N; i++) fríos.push((await arranque(null)).init)
console.log(`\narranque → initialize        mediana ${ms(mediana(fríos))}`)

const conTema: number[] = []
for (let i = 0; i < N; i++) {
  const r = await arranque({ method: 'tools/call', params: { name: 'buscar_por_tema', arguments: { texto: 'teletrabajo' } } })
  conTema.push(r.extra)
}
console.log(`primera buscar_por_tema     mediana ${ms(mediana(conTema))}   (incluye cargar el índice)`)

const conLista: number[] = []
for (let i = 0; i < N; i++) conLista.push((await arranque({ method: 'tools/list' })).extra)
console.log(`tools/list                  mediana ${ms(mediana(conLista))}`)

console.log('\nfunciones puras sobre 925.000 caracteres:')
for (const r of await puras()) console.log(`  ${r.nombre.padEnd(30)} ${ms(r.ms)}`)
