/**
 * diff.ts: qué cambió entre dos versiones de un artículo y de qué clase es el
 * cambio, para decidir si amerita releer la norma o basta un aviso.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { clasificarDiferencia, diffArticulos } from '../src/diff.ts'

test('diffArticulos separa lo añadido de lo eliminado', () => {
  assert.deepEqual(diffArticulos('Línea 1\nLínea 2', 'Línea 1\nLínea 3'), {
    anadidos: ['Línea 3'],
    eliminados: ['Línea 2'],
  })
  assert.deepEqual(diffArticulos('Línea 1\nLínea 2', 'Línea 1\nLínea 2'), { anadidos: [], eliminados: [] })
})

test('clasificarDiferencia distingue el tipo de cambio, en orden de prioridad', () => {
  assert.equal(clasificarDiferencia('dentro de los 30 días'), 'plazo')
  assert.equal(clasificarDiferencia('multa de 5 smmlv'), 'sancion')
  assert.equal(clasificarDiferencia('se aplicará la sanción dentro de los 30 días'), 'plazo')
  assert.equal(clasificarDiferencia('texto sin marcas'), 'no clasificado')
})
