/**
 * Empaqueta el servidor en tres piezas: `server/index.js` (un lanzador de cuatro
 * líneas), `server/servidor.js` (el bundle) y `unpdf-*.js`.
 *
 * `unpdf` (pdf.js) pesa 1,5 MB, dos tercios del bundle, y solo se necesita al
 * leer un PDF, así que ya se importaba en diferido. Pero en un único fichero ese
 * peso se lee y se parsea igual al arrancar: medido, quitarlo baja el arranque
 * hasta `initialize` de 396 a 307 ms (−89 ms, −22,6 %). Con `splitting`, esbuild
 * lo saca a su propio fichero y solo se carga la primera vez que hace falta.
 *
 * El lanzador existe para pedirle a Node su caché de compilación ANTES de cargar
 * el bundle: `enableCompileCache()` solo ayuda a los módulos que se cargan después
 * de llamarla, y el bundle ya está compilado cuando su propio código corre. Con
 * ella el arranque baja de 254 a 223 ms (−31 ms, −12,1 %, A/B de 30 pares).
 * `flushCompileCache()` es imprescindible: Node solo escribe la caché al salir, y
 * un cliente que termina el proceso a la fuerza no le deja; sin el volcado la
 * variante empeoraba +8 ms (medido). Escribe unos 700 KB en el directorio
 * temporal del sistema —cada versión nueva deja los suyos: Node no purga los
 * viejos y el sistema limpia ese directorio— y `NODE_DISABLE_COMPILE_CACHE=1`
 * la apaga (es de Node). Si el directorio no se puede escribir, el servidor
 * arranca igual (comprobado con TEMP apuntando a un fichero).
 *
 * ponytail: el servidor deja de ser UN solo fichero. El salto siguiente, si
 * volviera a importar tenerlo en uno, es deshacer `splitting`, `outdir` y el
 * lanzador aquí: es todo el cambio, y cuesta ~120 ms en cada arranque. En Node
 * anterior a 22.1 (sin caché) el lanzador es una lectura de fichero de más; en
 * 22.1–22.9 (sin `flushCompileCache`) cuesta esos ~8 ms sin devolverlos si el
 * cliente mata el proceso.
 *
 * Está en un script y no en una línea de package.json porque el banner necesita
 * un salto de línea real —el shebang tiene que quedar solo en la primera línea—
 * y un salto dentro de un script de npm parte el argumento: se perdía la línea
 * de `createRequire` y quedaban seis llamadas a `require()` sin definir,
 * esperando a que alguien tomara ese camino.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

// El bundle es ESM pero algunas dependencias resuelven cosas con require().
const BANNER = "import{createRequire}from'module';const require=createRequire(import.meta.url);"

// El shebang va aquí, en el fichero que se ejecuta. `import * as` y no `import { … }`: en un Node
// sin esos exports, el import con nombre rompería el arranque en vez de saltarse la caché.
const LANZADOR = `#!/usr/bin/env node
import * as modulo from 'node:module'
modulo.enableCompileCache?.()
await import('./servidor.js')
modulo.flushCompileCache?.()
`

// El nombre del fichero de `unpdf` lleva un hash: sin esto, cada build dejaría el
// suyo al lado y el paquete acabaría publicando los viejos. `server/` está
// ignorado por git: en un clon nuevo no existe y el `readdirSync` rompía el build.
mkdirSync('server', { recursive: true })
for (const f of readdirSync('server')) if (/^unpdf-.*\.js$/.test(f)) rmSync(`server/${f}`)

const r = await build({
  entryPoints: { servidor: 'src/index.ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outdir: 'server',
  entryNames: '[name]',
  splitting: true,
  chunkNames: 'unpdf-[hash]',
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
writeFileSync('server/index.js', LANZADOR)

// --- el manifiesto declara lo que el servidor declara ---------------------

/**
 * La lista de herramientas del manifiesto se escribía a mano y se quedó en once
 * cuando el servidor ya daba quince: quien instalara la extensión vería un
 * catálogo incompleto. Se pregunta al propio servidor recién construido, que es
 * la única fuente que no puede desincronizarse.
 */
const herramientas = await new Promise<{ name: string; description: string }[]>((resolve, reject) => {
  // Sin FUENTES: el manifiesto declara el catálogo completo, y un FUENTES que
  // quedara en la shell de quien construye publicaría uno recortado.
  const env = { ...process.env }
  delete env['FUENTES']
  const p = spawn(process.execPath, ['server/index.js'], { stdio: ['pipe', 'pipe', 'ignore'], env })
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
