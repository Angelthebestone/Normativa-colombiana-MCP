/**
 * Pruebas del expediente temporal: el gate EXPEDIENTES, el ciclo
 * crear/agregar/leer, los ids inexistentes y la expiración por TTL.
 *
 *   node --test test/expediente.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { agregar, crear, habilitado, leer } from '../src/expediente.ts'

test('habilitado() es false sin la variable EXPEDIENTES', () => {
  delete process.env['EXPEDIENTES']
  assert.equal(habilitado(), false)
})

test('con EXPEDIENTES=1, crear/agregar/leer funcionan', () => {
  process.env['EXPEDIENTES'] = '1'
  assert.equal(habilitado(), true)
  const id = crear()
  assert.equal(agregar(id, 'preguntas', '¿qué dice la Ley 909 de 2004?'), true)
  const datos = leer(id)
  assert.ok(datos)
  assert.deepEqual(datos.preguntas, ['¿qué dice la Ley 909 de 2004?'])
  assert.deepEqual(datos.fuentes, [])
  assert.equal(agregar(id, 'citas', ''), false) // texto vacío no se agrega
})

test('agregar a un id inexistente devuelve false', () => {
  assert.equal(agregar('no-existe', 'documentos', 'algo'), false)
})

test('un expediente con TTL corto expira y se borra', async () => {
  const id = crear(10)
  assert.equal(agregar(id, 'documentos', 'texto'), true)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(leer(id), null)
  assert.equal(agregar(id, 'documentos', 'más'), false) // ya borrado
})
