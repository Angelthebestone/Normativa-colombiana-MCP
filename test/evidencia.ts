/**
 * Pruebas de la validación de evidencia de una cita: URL, número/año y
 * clasificación del resultado.
 *
 *   node --test test/evidencia.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { clasificarValidacion, validarNumeroAnio, validarUrl } from '../src/nucleo/evidencia.ts'

test('validarUrl acepta solo el dominio esperado', () => {
  assert.equal(validarUrl('https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=1', 'funcionpublica.gov.co'), true)
  assert.equal(validarUrl('https://otro.com/x', 'funcionpublica.gov.co'), false)
  assert.equal(validarUrl('no-es-una-url', 'x.gov.co'), false)
})

test('validarNumeroAnio exige el número y el año como palabra completa', () => {
  assert.equal(validarNumeroAnio('Ley 909 de 2004', '909', '2004'), true)
  assert.equal(validarNumeroAnio('Ley 909 de 2004', '910'), false)
})

test('clasificarValidacion distingue validada, parcial y no validable', () => {
  assert.equal(clasificarValidacion([{ nombre: 'a', ok: true }, { nombre: 'b', ok: false }]), 'cita parcialmente validada')
  assert.equal(clasificarValidacion([]), 'no fue posible validar')
})
