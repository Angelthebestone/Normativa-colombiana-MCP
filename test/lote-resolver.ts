/**
 * Lote de `resolver_cita` sin validación: la misma cita resuelve igual por la
 * vía individual (`cita`) y por la vía de lote (`citas`), un bloque por cita,
 * y un fallo de red de una cita no tumba a las demás. Sin red: se prueba
 * contra el servidor compilado con el Gestor caído a propósito es imposible,
 * así que estos casos cubren el contrato observable (bloques, enlaces,
 * errores de esquema) y el caso del informe se verifica en `test/red-gestor.ts`.
 *
 *   npm run build && node --test test/lote-resolver.ts
 */
import { strict as assert } from 'node:assert'
import test, { after, before } from 'node:test'

import { abrirCliente, LENTO, type Cliente } from './red.ts'

let c: Cliente
before(async () => {
  c = await abrirCliente()
})
after(() => c.cerrar())

test('lote del informe: citas ["Ley 909 de 2004", "C-337/11"] resuelve ambas con su enlace', LENTO, async () => {
  const r = await c.tool('resolver_cita', { citas: ['Ley 909 de 2004', 'C-337/11'] })
  assert.equal(r.esError, false)
  assert.match(r.texto, /### Ley 909 de 2004/)
  assert.match(r.texto, /### C-337\/11/)
  assert.match(r.texto, /funcionpublica.gov.co/)
})

test('lote: una cita con mala forma trae su aviso en su bloque, sin tumbar el lote', LENTO, async () => {
  const r = await c.tool('resolver_cita', { citas: ['Ley 909 de 2004', 'esto no es una cita'] })
  assert.equal(r.esError, false)
  assert.match(r.texto, /### Ley 909 de 2004/)
  assert.match(r.texto, /### esto no es una cita/)
  assert.match(r.texto, /No encontré una cita normativa/)
})

test('lote vacío se rechaza igual que la cita ausente', LENTO, async () => {
  const r = await c.tool('resolver_cita', {})
  assert.equal(r.esError, false)
  assert.match(r.texto, /No encontré una cita normativa/)
})
