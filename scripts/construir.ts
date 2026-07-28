/**
 * Empaqueta el servidor en un solo archivo.
 *
 * Está en un script y no en una línea de package.json porque el banner necesita
 * un salto de línea real —el shebang tiene que quedar solo en la primera línea—
 * y un salto dentro de un script de npm parte el argumento: se perdía la línea
 * de `createRequire` y quedaban seis llamadas a `require()` sin definir,
 * esperando a que alguien tomara ese camino.
 */
import { build } from 'esbuild'

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
  banner: { js: BANNER },
  logLevel: 'info',
})

if (r.errors.length) process.exit(1)
