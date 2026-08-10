/**
 * Pruebas de la herramienta de expediente (src/herramientas/expedientes.ts):
 * el aviso de desactivado sin EXPEDIENTES y el ciclo crear/agregar/leer con EXPEDIENTES=1.
 *
 *   node --test test/expedientes-herramientas.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { escribir } from '../src/herramientas/expedientes.ts'

test('sin EXPEDIENTES las tres acciones avisan del feature desactivado', async () => {
  delete process.env['EXPEDIENTES']
  const aviso = /desactivada|EXPEDIENTES=1/
  assert.match(await escribir({ accion: 'crear' }), aviso)
  assert.match(await escribir({ accion: 'agregar', id: 'x', campo: 'preguntas', texto: 'algo' }), aviso)
  assert.match(await escribir({ accion: 'leer', id: 'x' }), aviso)
})

test('con EXPEDIENTES=1 el ciclo crear/agregar/leer funciona y los ids falsos avisan', async () => {
  process.env['EXPEDIENTES'] = '1'

  const creado = await escribir({ accion: 'crear' })
  const m = creado.match(/Expediente (\w+) creado/)
  assert.ok(m, creado)
  const id = m[1]!

  const agregado = await escribir({ accion: 'agregar', id, campo: 'preguntas', texto: '¿qué dice la Ley 909 de 2004?' })
  assert.match(agregado, /Agregado/)

  const leido = await escribir({ accion: 'leer', id })
  assert.ok(leido.includes('¿qué dice la Ley 909 de 2004?'), leido)

  assert.match(await escribir({ accion: 'leer', id: 'falso' }), /No existe un expediente/)
  assert.match(await escribir({ accion: 'agregar', id: 'falso', campo: 'citas', texto: 'algo' }), /No existe un expediente/)
})
