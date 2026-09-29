/**
 * Pruebas del registro de perfiles. No tocan la red: `consultar` sí la necesita
 * y se prueba aparte, contra las fuentes reales.
 *
 *   node --test test/perfiles.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { perfiles } from '../src/nucleo/perfiles.ts'

test('el registro trae los cinco perfiles', () => {
  assert.deepEqual(
    perfiles().map((p) => p.id),
    ['laboral', 'tributario', 'ambiental', 'contratacion_estatal', 'energia'],
  )
})

test('cada perfil declara su sector y su advertencia', () => {
  for (const p of perfiles()) {
    assert.ok(p.nombre, `${p.id} sin nombre`)
    assert.ok(p.sector, `${p.id} sin sector`)
    assert.ok(p.advertencia.length > 0, `${p.id} sin advertencia: un vacío se leería como inexistencia`)
  }
})
