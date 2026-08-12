/**
 * Deduplicación conservadora de resultados: mismo fallo .doc/.pdf, misma norma
 * con dos enlaces, y el total declarado a únicos.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { claveActo, deduplicar, similitudEpigrafes } from '../src/nucleo/deduplicar.ts'

test('deduplicar conserva la primera entrada por clave y cuenta las fusionadas', () => {
  const items = [
    { id: 1, tipo: 'Ley', numero: '100', anio: '1993' },
    { id: 2, tipo: 'Ley', numero: '100', anio: '1993' }, // duplicado
    { id: 3, tipo: 'Decreto', numero: '1072', anio: '2015' },
  ]
  const r = deduplicar(items, (i) => `${i.tipo}|${i.numero}|${i.anio}`)
  assert.equal(r.items.length, 2)
  assert.equal(r.duplicados, 1)
  assert.equal(r.items[0]!.id, 1, 'la primera entrada gana')
})

test('la clave se normaliza (sin tildes, minúsculas, espacios)', () => {
  const r = deduplicar(
    [
      { a: 'Ley 100 de 1993' },
      { a: '  LEY  100 DE 1993  ' },
    ],
    (i) => i.a,
  )
  assert.equal(r.items.length, 1)
  assert.equal(r.duplicados, 1)
})

test('claveActo combina tipo|numero|anio', () => {
  assert.equal(claveActo({ tipo: 'Resolución', numero: '692', anio: '2025' }), 'Resolución|692|2025')
})

test('similitudEpigrafes distingue el mismo asunto de uno distinto', () => {
  assert.equal(similitudEpigrafes('Por la cual se adoptan factores', 'Por la cual se adoptan factores'), 1)
  assert.ok(similitudEpigrafes('Regula vehículos eléctricos', 'Regula vehículos eléctricos y cargadores') > 0.6)
  assert.ok(similitudEpigrafes('Regula vehículos eléctricos', 'Nombramiento de un profesional') < 0.3)
})

test('sin clave no se deduplica: la entrada se conserva', () => {
  const r = deduplicar([{ x: 'a' }, { x: '' }], (i) => i.x)
  assert.equal(r.items.length, 2)
  assert.equal(r.duplicados, 0)
})
