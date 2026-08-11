/**
 * Banco de medición del MCP. Solo mide lo que el usuario paga:
 * arranque en frío, primera respuesta útil, memoria y las funciones puras que
 * corren sobre documentos grandes. Lo que domina la red no se mide aquí porque
 * no lo controlamos (y el limitador de 1/s es deliberado).
 *
 * La sección `herramientas` mide de extremo a extremo cada herramienta que
 * consulta portales: una consulta representativa por tool, N=5, p50/p95, nº de
 * peticiones HTTP y bytes de cuerpo. Los contadores de red vienen de
 * `redResumen()` (src/nucleo/http.ts).
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

// --- 4. herramientas, de extremo a extremo --------------------------------

/** Consulta representativa por herramienta: la misma que usa test/e2e.ts. */
const CONSULTAS: Record<string, Record<string, unknown>> = {
  resolver_cita: { cita: 'Ley 909 de 2004' },
  buscar_normas: { tipo_documento: 'Ley', numero: 909, anio: 2004 },
  buscar_por_tema: { texto: 'teletrabajo', limite: 5 },
  listar_catalogos: { catalogo: 'normas_fp', limite: 100 },
  buscar_jurisprudencia: { termino: 'prima de servicios', limite: 5 },
  buscar_normativa_tributaria: { texto: 'retención' },
  buscar_jurisprudencia_suprema: { texto: 'despido sin justa causa', sala: 'Laboral', limite: 3 },
  buscar_jurisprudencia_consejo_estado: { texto: 'nulidad electoral', limite: 3 },
  buscar_en_suin: { texto: 'Buenaventura', limite: 3 },
  explicar_relacion_tema: { temsubid: 'ts-24928', normid: '31431' },
  buscar_normativa_anh: { texto: 'regalías' },
  buscar_normativa_upme: { texto: 'transmisión' },
  buscar_resoluciones_creg: { anio: '2024' },
  listar_normativa_ambiental_anla: { seccion: 'leyes', texto: 'licencia' },
  buscar_normativa_sectorial: { entidad: 'supertransporte', limite: 3 },
  obtener_documento: { fuente: 'gestor', id: '31431', articulo: '6' },
  describir_fuentes: {},
  expediente: { accion: 'crear' },
  consultar_perfil: { perfil: 'tributario', texto: 'retención', limite: 3 },
  cambios_desde: { desde: '2024-01-01' },
  analizar_conflicto: { cita: 'Ley 909 de 2004' },
  comparar_articulos: { cita_a: 'Ley 909 de 2004', cita_b: 'Ley 909 de 2004' },
}

/**
 * Arranca el server compilado y hace una llamada `tools/call`, devolviendo la
 * latencia y el resumen de red que el propio server escribió en su stderr
 * (el contador de `http.ts` vive en el proceso del server, no en este script).
 */
function llamadaTool(
  nombre: string,
  args: Record<string, unknown>,
): Promise<{ ms: number; peticiones: number; bytes: number }> {
  return new Promise((resolve) => {
    const p = spawn('node', [`${RAIZ}/server/index.js`], { stdio: ['pipe', 'pipe', 'pipe'] })
    let buf = ''
    let errBuf = ''
    const t0 = performance.now()
    p.stdout.on('data', (d) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const linea = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!linea.trim()) continue
        const m = JSON.parse(linea) as { id?: number }
        if (m.id === 1) {
          p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
          p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: nombre, arguments: args } })}\n`)
        }
        if (m.id === 2) {
          const ms = performance.now() - t0
          // El stderr del server lleva la línea de la herramienta con peticiones/bytes.
          const lineaErr = errBuf
            .split('\n')
            .filter(Boolean)
            .map((l) => {
              try {
                return JSON.parse(l) as { herramienta?: string; peticiones?: number; bytes?: number }
              } catch {
                return {}
              }
            })
            .find((x) => x.herramienta === nombre)
          p.kill()
          resolve({
            ms,
            peticiones: lineaErr?.peticiones ?? 0,
            bytes: lineaErr?.bytes ?? 0,
          })
        }
      }
    })
    p.stderr.on('data', (d: Buffer) => {
      errBuf += d.toString('utf8')
    })
    p.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'medir', version: '1' } },
      })}\n`,
    )
  })
}

const filaTool = async (nombre: string, args: Record<string, unknown>) => {
  const tiempos: number[] = []
  let peticiones = 0
  let bytes = 0
  for (let i = 0; i < N; i++) {
    const r = await llamadaTool(nombre, args)
    tiempos.push(r.ms)
    peticiones += r.peticiones
    bytes += r.bytes
  }
  const s = [...tiempos].sort((a, b) => a - b)
  const p95 = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)] ?? 0
  return { p50: mediana(tiempos), p95, peticiones, bytes }
}

console.log('\nherramientas (e2e, N=5, consulta representativa):')
console.log('  tool                          p50       p95   peticiones  bytes')
for (const [nombre, args] of Object.entries(CONSULTAS)) {
  const r = await filaTool(nombre, args)
  console.log(
    `  ${nombre.padEnd(28)} ${ms(r.p50).padStart(8)}  ${ms(r.p95).padStart(8)}  ${String(r.peticiones).padStart(6)}  ${(r.bytes / 1024).toFixed(0).padStart(6)} KB`,
  )
}
