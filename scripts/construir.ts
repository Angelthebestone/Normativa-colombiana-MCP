/**
 * Empaqueta el servidor en un solo archivo.
 *
 * Está en un script y no en una línea de package.json porque el banner necesita
 * un salto de línea real —el shebang tiene que quedar solo en la primera línea—
 * y un salto dentro de un script de npm parte el argumento: se perdía la línea
 * de `createRequire` y quedaban seis llamadas a `require()` sin definir,
 * esperando a que alguien tomara ese camino.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

// La versión se inyecta desde package.json: escrita a mano en el User-Agent se
// quedaba atrás, y es lo que ven los portales para saber quién los consulta.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
}

// El manifiesto del .mcpb llevaba su propia versión escrita a mano y se quedó
// en 1.1.0 mientras package.json iba por 1.2.0: quien instalara la extensión
// vería una versión que no es la que trae. Se sincroniza aquí, que es por donde
// pasan todos los empaquetados.
const RUTA_MANIFIESTO = new URL('../manifest.json', import.meta.url)
const manifiesto = JSON.parse(readFileSync(RUTA_MANIFIESTO, 'utf8')) as { version: string }
if (manifiesto.version !== version) {
  const bruto = readFileSync(RUTA_MANIFIESTO, 'utf8')
  writeFileSync(RUTA_MANIFIESTO, bruto.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`))
  console.log(`manifest.json: ${manifiesto.version} → ${version}`)
}

const BANNER = [
  '#!/usr/bin/env node',
  // El bundle es ESM pero algunas dependencias resuelven cosas con require().
  "import{createRequire}from'module';const require=createRequire(import.meta.url);",
].join('\n')

const r = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outfile: 'server/index.js',
  // Medido: 1099 KB → 583 KB y unos 20 ms menos de arranque. Sin `keepNames`:
  // envolver cada función para conservar su nombre costaba 23 KB y ~40 ms de
  // arranque, y el enrutado de errores usa `instanceof`, que no depende del
  // nombre. Las clases de error llevan su `name` escrito a mano.
  minify: true,
  banner: { js: BANNER },
  define: { __VERSION__: JSON.stringify(version) },
  logLevel: 'info',
})

if (r.errors.length) process.exit(1)

// --- el manifiesto declara lo que el servidor declara ---------------------

/**
 * La lista de herramientas del manifiesto se escribía a mano y se quedó en once
 * cuando el servidor ya daba quince: quien instalara la extensión vería un
 * catálogo incompleto. Se pregunta al propio servidor recién construido, que es
 * la única fuente que no puede desincronizarse.
 */
const herramientas = await new Promise<{ name: string; description: string }[]>((resolve, reject) => {
  const p = spawn(process.execPath, ['server/index.js'], { stdio: ['pipe', 'pipe', 'ignore'] })
  let buf = ''
  const corta = setTimeout(() => {
    p.kill()
    reject(new Error('el servidor no respondió a tools/list en 30 s'))
  }, 30_000)
  p.stdout.on('data', (d: Buffer) => {
    buf += d.toString('utf8')
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const linea = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (!linea.trim()) continue
      const m = JSON.parse(linea) as { id?: number; result?: { tools?: { name: string; description: string }[] } }
      if (m.id === 1) {
        p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
        p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
      }
      if (m.id === 2) {
        clearTimeout(corta)
        p.kill()
        resolve((m.result?.tools ?? []).map((t) => ({ name: t.name, description: t.description })))
      }
    }
  })
  p.on('error', reject)
  p.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'construir', version } },
    })}\n`,
  )
})

if (!herramientas.length) throw new Error('el servidor no declaró ninguna herramienta')

const actual = JSON.parse(readFileSync(RUTA_MANIFIESTO, 'utf8')) as {
  tools: { name: string; description: string }[]
}
// La descripción del manifiesto es un rótulo de escaparate, más corta que la
// que ve el modelo; se recorta a la primera frase.
const rotulo = herramientas.map((t) => ({
  name: t.name,
  description: `${t.description.split('. ')[0]}.`.replace(/\.\.$/, '.'),
}))
if (JSON.stringify(actual.tools) !== JSON.stringify(rotulo)) {
  writeFileSync(RUTA_MANIFIESTO, JSON.stringify({ ...actual, tools: rotulo }, null, 2) + '\n')
  console.log(`manifest.json: ${actual.tools.length} → ${rotulo.length} herramientas`)
}
