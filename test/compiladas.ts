/**
 * Detección de normas compiladas y aviso con índice de artículos.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { avisoCompiladora, esCompiladora } from '../src/compiladas.ts'

test('se reconoce una compilación por el título o por el tamaño', () => {
  assert.equal(esCompiladora('Decreto Único Reglamentario 1083 de 2015', 1000), true)
  assert.equal(esCompiladora('Ley 909 de 2004', 5000), false)
  assert.equal(esCompiladora('Ley 100 de 1993', 500_000), true)
})

test('el aviso de compilada incluye el índice de los artículos detectados', () => {
  const aviso = avisoCompiladora('Decreto Único Reglamentario 1083 de 2015', 'ARTÍCULO 1. Uno.\nARTÍCULO 2. Dos.')
  assert.match(aviso, /\b1, 2\b/, 'el índice debe listar los artículos 1 y 2')
  assert.match(aviso, /buscar_en_texto/)
})

test('sin articulado el aviso no inventa un índice', () => {
  const aviso = avisoCompiladora('Decreto Único Reglamentario 1083 de 2015', 'texto sin artículos')
  assert.doesNotMatch(aviso, /Artículos detectados/)
})
