/**
 * FUENTES: qué fuentes consulta la instalación. Sin red.
 *
 *   node --test test/fuentes.ts
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { alcance, leerFuentes } from '../src/nucleo/alcance.ts'

test('vacía es todas; la lista positiva lleva siempre el Gestor; la negativa quita solo esas', () => {
  assert.equal(leerFuentes('').size, 11)
  assert.deepEqual([...leerFuentes('corte, SUIN')], ['gestor', 'corte', 'suin'])
  const sin = leerFuentes('-creg,-anh')
  assert.equal(sin.has('creg') || sin.has('anh'), false)
  assert.equal(sin.size, 9)
})

test('una clave mal escrita, el Gestor o las dos formas mezcladas rompen en vez de ignorarse', () => {
  // Ignorar "cort" dejaría la instalación sin la Corte Constitucional sin que nadie lo supiera.
  assert.throws(() => leerFuentes('cort'), /"cort" no es una fuente/)
  assert.throws(() => leerFuentes('-gestor'), /no se puede apagar/)
  assert.throws(() => leerFuentes('corte,-suin'), /mezcla/)
})

test('la línea de alcance separa lo no consultado de lo desactivado', () => {
  const l = alcance([{ clave: 'gestor', detalle: '1 resultado' }], ['creg', 'anh'])
  assert.match(l, /NO consulté Corte Constitucional/)
  assert.doesNotMatch(l.split('Desactivadas')[0]!, /CREG|ANH/)
  assert.match(l, /Desactivadas en esta instalación, no consultadas: CREG, ANH\.$/)
  assert.equal(alcance([], []).startsWith('Alcance: sin consultar ninguna fuente.'), true)
})
