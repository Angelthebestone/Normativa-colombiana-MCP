/**
 * Pruebas del registro de perfiles. No tocan la red: `consultar` sí la necesita
 * y se prueba aparte, contra las fuentes reales.
 *
 *   node --test test/perfiles.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { perfil, perfiles, registrarPerfil, type Perfil } from '../src/nucleo/perfiles.ts'

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
    assert.equal(typeof p.consultar, 'function', `${p.id} sin consultar()`)
  }
})

test('perfil devuelve el del id y undefined para el que no existe', () => {
  assert.equal(perfil('tributario')?.nombre, 'Normativa tributaria')
  assert.equal(perfil('no-existe'), undefined)
})

test('un perfil registrado después gana al del mismo id', () => {
  registrarPerfil({ id: 'laboral', nombre: 'Otro', sector: 'x', advertencia: 'y', consultar: async () => '' } satisfies Perfil)
  assert.equal(perfil('laboral')?.nombre, 'Otro')
})
