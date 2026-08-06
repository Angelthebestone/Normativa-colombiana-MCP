/**
 * Pruebas del formateo y los avisos de validar_cita, sin red.
 *
 *   node --test test/validar_cita.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { formatear, sinForma } from '../src/herramientas/validar_cita.ts'

const ENCONTRADA = { titulo: 'LEY 909 DE 2004', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=123' }

test('formatear con resultado "cita validada" incluye ese texto y las comprobaciones con ✓', () => {
  const salida = formatear('Ley 909 de 2004', 'cita validada', [
    { nombre: 'número y año', ok: true },
    { nombre: 'dominio del enlace', ok: true },
  ], ENCONTRADA)
  assert.ok(salida.includes('Resultado: cita validada'))
  assert.ok(salida.includes('- número y año: ✓'))
  assert.ok(salida.includes('- dominio del enlace: ✓'))
  assert.ok(salida.includes(ENCONTRADA.titulo))
  assert.ok(salida.includes(ENCONTRADA.url))
})

test('formatear marca ✗ las comprobaciones fallidas', () => {
  const salida = formatear('Ley 909 de 2004', 'cita parcialmente validada', [
    { nombre: 'dominio del enlace', ok: false },
  ], ENCONTRADA)
  assert.ok(salida.includes('Resultado: cita parcialmente validada'))
  assert.ok(salida.includes('- dominio del enlace: ✗'))
})

test('formatear sin norma encontrada avisa que no significa que no exista', () => {
  const salida = formatear('Ley 909 de 2004', 'no fue posible validar', [])
  assert.ok(salida.includes('NO significa que la norma no exista'))
  assert.ok(salida.includes('Resultado: no fue posible validar'))
})

test('sinForma devuelve el aviso de forma para una cita que no parsea y vacío para una válida', () => {
  assert.ok(sinForma('esto no es una cita').includes('no tiene forma de cita colombiana'))
  assert.equal(sinForma('Ley 909 de 2004'), '')
})
