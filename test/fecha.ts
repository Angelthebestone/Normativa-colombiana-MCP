/**
 * La fecha de negocio es la de Bogotá, sea cual sea la zona del host.
 *
 *   node --test test/fecha.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { anioBogota, fechaBogota } from '../src/nucleo/fecha.ts'
import { analizarVacancia, enVacancia } from '../src/nucleo/vacancia/index.ts'
import { rotuloCopia } from '../src/nucleo/portal-roto.ts'

test('de 19:00 a medianoche de Bogotá, UTC ya va un día por delante y la fecha sigue siendo la colombiana', () => {
  const nocheEnBogota = new Date('2026-10-15T03:30:00Z') // 22:30 del 14 en Bogotá
  assert.equal(nocheEnBogota.toISOString().slice(0, 10), '2026-10-15')
  assert.equal(fechaBogota(nocheEnBogota), '2026-10-14')
  assert.equal(fechaBogota(new Date('2026-10-15T05:00:00Z')), '2026-10-15')
})

test('el año también es el de Bogotá en la noche del 31 de diciembre', () => {
  assert.equal(anioBogota(new Date('2027-01-01T02:00:00Z')), 2026)
  assert.equal(anioBogota(new Date('2027-01-01T05:00:00Z')), 2027)
})

test('la vacancia se decide contra el día colombiano, no contra UTC', () => {
  const texto = 'Artículo 10. Vigencia. La presente ley rige a partir del 1 de enero de 2027.'
  const v = analizarVacancia(texto, { hoy: new Date('2027-01-01T02:00:00Z') })
  assert.equal(v.desde, '2027-01-01')
  // 21:00 del 31 de diciembre en Bogotá: todavía no ha entrado en vigor.
  assert.equal(enVacancia(v, new Date('2027-01-01T02:00:00Z')), true)
  assert.equal(enVacancia(v, new Date('2027-01-01T05:00:00Z')), false)
})

test('el rótulo de una copia lleva la fecha colombiana del instante en que se guardó', () => {
  assert.match(rotuloCopia('normograma.dian.gov.co', Date.UTC(2026, 8, 16, 2, 0, 0)), /2026-09-15/)
})
