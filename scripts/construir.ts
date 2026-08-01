/**
 * Empaqueta el servidor en un solo archivo.
 *
 * Está en un script y no en una línea de package.json porque el banner necesita
 * un salto de línea real —el shebang tiene que quedar solo en la primera línea—
 * y un salto dentro de un script de npm parte el argumento: se perdía la línea
 * de `createRequire` y quedaban seis llamadas a `require()` sin definir,
 * esperando a que alguien tomara ese camino.
 */
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

// La versión se inyecta desde package.json: escrita a mano en el User-Agent se
// quedaba atrás, y es lo que ven los portales para saber quién los consulta.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
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
