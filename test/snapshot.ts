/**
 * Advertencia de snapshot antiguo para los índices empaquetados.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { advertenciaSnapshot } from '../src/nucleo/snapshot.ts'

const hace = (dias: number): string => new Date(Date.now() - dias * 24 * 3600 * 1000).toISOString().slice(0, 10)

test('índice reciente: sin advertencia', () => {
  assert.equal(advertenciaSnapshot(hace(1)), '')
  assert.equal(advertenciaSnapshot(hace(29)), '')
})

test('índice antiguo: con advertencia y días', () => {
  const aviso = advertenciaSnapshot(hace(40))
  assert.match(aviso, /AVISO/)
  assert.match(aviso, /40 días/)
})

test('índice sin fecha: sin advertencia', () => {
  assert.equal(advertenciaSnapshot(undefined), '')
})

test('fecha inválida: sin advertencia', () => {
  assert.equal(advertenciaSnapshot('no-es-una-fecha'), '')
})

test('umbral custom se respeta', () => {
  assert.equal(advertenciaSnapshot(hace(40), 90), '')
  assert.ok(advertenciaSnapshot(hace(40), 30))
})
