/**
 * Pruebas de las herramientas de expediente (src/herramientas/expedientes.ts):
 * el aviso de desactivado sin EXPEDIENTES y el ciclo crear/agregar/leer con EXPEDIENTES=1.
 *
 *   node --test test/expedientes-herramientas.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  expedienteAgregarEscribir,
  expedienteCrearEscribir,
  expedienteLeerEscribir,
} from '../src/herramientas/expedientes.ts'

test('sin EXPEDIENTES los tres escribir avisan del feature desactivado', () => {
  delete process.env['EXPEDIENTES']
  const aviso = /desactivada|EXPEDIENTES=1/
  assert.match(expedienteCrearEscribir(), aviso)
  assert.match(expedienteAgregarEscribir({ id: 'x', campo: 'preguntas', texto: 'algo' }), aviso)
  assert.match(expedienteLeerEscribir({ id: 'x' }), aviso)
})

test('con EXPEDIENTES=1 el ciclo crear/agregar/leer funciona y los ids falsos avisan', () => {
  process.env['EXPEDIENTES'] = '1'

  const creado = expedienteCrearEscribir()
  const m = creado.match(/Expediente (\w+) creado/)
  assert.ok(m, creado)
  const id = m[1]!

  const agregado = expedienteAgregarEscribir({ id, campo: 'preguntas', texto: '¿qué dice la Ley 909 de 2004?' })
  assert.match(agregado, /Agregado/)

  const leido = expedienteLeerEscribir({ id })
  assert.ok(leido.includes('¿qué dice la Ley 909 de 2004?'), leido)

  assert.match(expedienteLeerEscribir({ id: 'falso' }), /No existe un expediente/)
  assert.match(expedienteAgregarEscribir({ id: 'falso', campo: 'citas', texto: 'algo' }), /No existe un expediente/)
})
