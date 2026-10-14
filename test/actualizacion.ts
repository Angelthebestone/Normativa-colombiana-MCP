/**
 * Aviso de versión nueva: cuándo sale, cuántas veces y qué pasa si el registro falla.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { crearAvisoVersion, esVersionNueva } from '../src/nucleo/actualizacion.ts'

/** Deja correr las promesas pendientes de `iniciar()`. */
const esperarRegistro = () => new Promise((r) => setImmediate(r))

test('cualquier versión mayor es nueva, parche incluido, y nunca hacia atrás', () => {
  assert.equal(esVersionNueva('1.15.2', '1.16.0'), true)
  assert.equal(esVersionNueva('1.15.2', '2.0.0'), true)
  assert.equal(esVersionNueva('1.15.2', '1.15.3'), true)
  assert.equal(esVersionNueva('1.15.2', '1.15.2'), false)
  assert.equal(esVersionNueva('1.15.2', '1.15.1'), false)
  assert.equal(esVersionNueva('1.15.2', '1.9.9'), false)
})

test('con una versión nueva en el registro, avisa una sola vez', async () => {
  const aviso = crearAvisoVersion('1.15.2', async () => '1.16.0')
  assert.equal(aviso.tomar(), '', 'antes de comprobar no hay nada que decir')
  aviso.iniciar()
  await esperarRegistro()
  const texto = aviso.tomar()
  assert.match(texto, /1\.15\.2 → 1\.16\.0/)
  assert.match(texto, /normativa-colombia-mcp@latest/)
  assert.match(texto, /releases\/latest/)
  assert.equal(aviso.tomar(), '')
})

test('al día, no avisa', async () => {
  const aviso = crearAvisoVersion('1.16.0', async () => '1.16.0')
  aviso.iniciar()
  await esperarRegistro()
  assert.equal(aviso.tomar(), '')
})

test('si el registro no contesta, se calla', async () => {
  const aviso = crearAvisoVersion('1.15.2', async () => null)
  aviso.iniciar()
  await esperarRegistro()
  assert.equal(aviso.tomar(), '')
})

test('iniciar dos veces consulta el registro una sola vez', async () => {
  let consultas = 0
  const aviso = crearAvisoVersion('1.15.2', async () => (consultas++, '1.16.0'))
  aviso.iniciar()
  aviso.iniciar()
  await esperarRegistro()
  assert.equal(consultas, 1)
})

test('sin empaquetar (dev) no consulta nada', async () => {
  let consultas = 0
  const aviso = crearAvisoVersion('dev', async () => (consultas++, '9.9.9'))
  aviso.iniciar()
  await esperarRegistro()
  assert.equal(consultas, 0)
  assert.equal(aviso.tomar(), '')
})

test('instancias distintas no comparten el aviso', async () => {
  const a = crearAvisoVersion('1.15.2', async () => '1.16.0')
  const b = crearAvisoVersion('1.15.2', async () => '1.16.0')
  a.iniciar()
  b.iniciar()
  await esperarRegistro()
  assert.notEqual(a.tomar(), '')
  assert.notEqual(b.tomar(), '')
})
