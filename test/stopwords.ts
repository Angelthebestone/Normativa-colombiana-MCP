/**
 * stopwords.ts: las palabras vacías del español —qué se filtra, cómo se
 * compara (sin tildes) y que la lista tenga el tamaño esperado.
 *
 *   node --test test/stopwords.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { STOPWORDS_ES, esStopword, filtrarStopwords } from '../src/nucleo/stopwords.ts'

test('la lista tiene alrededor de 100 palabras vacías', () => {
  assert.ok(STOPWORDS_ES.size >= 90 && STOPWORDS_ES.size <= 120, `tamaño real: ${STOPWORDS_ES.size}`)
})

test('esStopword reconoce las vacías, con o sin tildes y en cualquier caja', () => {
  assert.equal(esStopword('de'), true)
  assert.equal(esStopword('DE'), true)
  assert.equal(esStopword('De'), true)
  assert.equal(esStopword('para'), true)
  assert.equal(esStopword('el'), true)
  assert.equal(esStopword('del'), true)
  assert.equal(esStopword('más'), true, 'con tilde, igual que "mas"')
  assert.equal(esStopword('está'), true, 'con tilde, igual que "esta"')
  assert.equal(esStopword('teletrabajo'), false)
  assert.equal(esStopword(''), false)
})

test('filtrarStopwords quita artículos y preposiciones y conserva lo útil', () => {
  assert.deepEqual(filtrarStopwords(['Ley', 'de', 'teletrabajo', 'en', 'Colombia']), ['Ley', 'teletrabajo', 'Colombia'])
  assert.deepEqual(filtrarStopwords(['auxilio', 'de', 'conectividad']), ['auxilio', 'conectividad'])
  assert.deepEqual(filtrarStopwords(['una', 'y', 'el', 'para']), [])
  assert.deepEqual(filtrarStopwords([]), [])
})
