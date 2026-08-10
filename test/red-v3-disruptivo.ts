/**
 * Red de regresión — barrido disruptivo de salida cruda. Ejecuta
 * `scripts/barrido-disruptivo.ts` contra el servidor compilado (spawn + JSON-RPC
 * crudo por stdio) y falla si alguna tool devuelve `isError` donde debe ser
 * texto, serialización basura (`undefined`/`NaN`/`[object Object]`), nombres
 * viejos de herramientas o respuestas sin fecha.
 *
 *   npm run test:disruptivo
 */
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { strict as assert } from 'node:assert'
import test from 'node:test'

const SCRIPT = fileURLToPath(new URL('../scripts/barrido-disruptivo.ts', import.meta.url))

test('el barrido disruptivo verifica el texto crudo de cada tool', { timeout: 240_000 }, () => {
  // Node 25 ejecuta TypeScript nativo (type-stripping), igual que `npm test`.
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', timeout: 240_000 })
  assert.equal(r.status, 0, `el barrido falló (${r.status}):\n${r.stdout}\n${r.stderr}`)
  assert.match(r.stdout ?? '', /tools verificadas, 0 con problemas/)
})
