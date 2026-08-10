/**
 * Pruebas de las variantes de búsqueda (sin tildes y sinónimos) y del índice
 * temático empaquetado. Sin red: el buscador es falso.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { conAlternativas, TESAURO } from '../src/nucleo/alternativas.ts'
import { cargarIndice, frescura } from '../src/nucleo/indice.ts'

test('un sinónimo rescata cuando el término y su forma sin tildes rinden poco', async () => {
  const r = await conAlternativas(
    async (t) => (t === 'auxilio de cesantía' ? [{ n: 1 }, { n: 2 }] : []),
    'cesantías',
    2,
  )
  assert.equal(r.items.length, 2)
  assert.deepEqual(r.variantesUsadas, ['auxilio de cesantía'])
})

test('si el término original ya rinde el umbral, no se ejecuta ninguna variante', async () => {
  let llamadas = 0
  const r = await conAlternativas(
    async () => {
      llamadas++
      return [{ n: 1 }, { n: 2 }]
    },
    'teletrabajo',
    2,
  )
  assert.deepEqual(r.variantesUsadas, [])
  assert.equal(llamadas, 1, 'solo debe consultarse el término original')
})

test('el tesauro tiene los sinónimos curados con clave sin tildes', () => {
  assert.ok(TESAURO['cesantias']?.length, 'falta el sinónimo de cesantías')
  assert.equal(TESAURO['despido']![0], 'terminación del contrato')
})

test('el índice empaquetado se lee y la frescura se calcula sin red', () => {
  const idx = cargarIndice()
  assert.ok(idx && idx.filas.length > 0, 'el índice temático debería viajar con el repo')
  assert.equal(frescura('2099-01-01'), '')
})
