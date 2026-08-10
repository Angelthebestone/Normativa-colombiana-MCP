/**
 * Mapeo de tipos de documento a niveles de la jerarquía normativa colombiana.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { NIVELES, caracterDelNivel, tipoANivel } from '../src/nucleo/jerarquia.ts'

test('el tipo de documento se mapea a su nivel en la jerarquía', () => {
  assert.equal(tipoANivel('Ley'), 'ley')
  assert.equal(tipoANivel('Decreto Ley'), 'decreto')
  assert.equal(tipoANivel('Concepto'), 'concepto')
  assert.equal(tipoANivel('Sentencia C-337'), 'jurisprudencia')
  assert.equal(tipoANivel('Cosa rara'), 'resolucion')
})

test('cada nivel describe su carácter, sin quedar vacío', () => {
  assert.ok(caracterDelNivel('concepto').includes('orientador'))
  assert.notEqual(caracterDelNivel('concepto'), '')
})

test('NIVELES declara los seis niveles en orden de rango', () => {
  assert.deepEqual(NIVELES, ['constitucion', 'ley', 'decreto', 'resolucion', 'concepto', 'jurisprudencia'])
})
