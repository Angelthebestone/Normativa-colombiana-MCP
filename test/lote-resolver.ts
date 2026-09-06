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

// --- articulos, contexto y la corrección de tipo en el lote validado -------

test('articulos: tres artículos del Estatuto Tributario en una sola llamada', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'Decreto Ley 624 de 1989', articulos: ['705', '707', '710'] })
  assert.equal(r.esError, false)
  for (const n of ['705', '707', '710']) assert.match(r.texto, new RegExp(`--- Artículo ${n} ---`))
  // La ficha y la vigencia salen UNA vez: el ahorro del parámetro es justo ese.
  assert.equal(r.texto.match(/^id: /gm)?.length, 1)
  assert.equal(r.texto.match(/Estado de vigencia/g)?.length ?? 0, 1)
})

test('articulos: uno inexistente entre dos válidos no aborta la respuesta', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'Ley 909 de 2004', articulos: ['1', '99999', '2'] })
  assert.equal(r.esError, false)
  assert.match(r.texto, /--- Artículo 1 ---/)
  assert.match(r.texto, /--- Artículo 2 ---/)
  assert.match(r.texto, /No encontré un "artículo 99999" en el texto/)
})

test('articulos gana sobre el artículo de la cita, y se anuncia', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'art. 1 de la Ley 909 de 2004', articulos: ['2'] })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Se ignoró el "artículo 1" de la cita/)
  assert.match(r.texto, /--- Artículo 2 ---/)
  assert.doesNotMatch(r.texto, /--- Artículo 1 ---/)
})

test('contexto: false omite el extracto de tema y lo dice', LENTO, async () => {
  const con = await c.tool('resolver_cita', { cita: 'Ley 909 de 2004' })
  const sin = await c.tool('resolver_cita', { cita: 'Ley 909 de 2004', contexto: false })
  assert.equal(sin.esError, false)
  assert.match(con.texto, /Extracto de un tema asociado/)
  assert.doesNotMatch(sin.texto, /Extracto de un tema asociado \(NO resume/)
  // El hueco se declara: callarlo se lee como que la norma no tiene tema asociado.
  assert.match(sin.texto, /omitido con contexto=false/)
  assert.ok(sin.texto.length < con.texto.length, `${sin.texto.length} >= ${con.texto.length}`)
})

test('lote: el extracto de tema no se repite por cada cita de la misma norma', LENTO, async () => {
  const r = await c.tool('resolver_cita', { citas: ['art. 1 de la Ley 909 de 2004', 'art. 2 de la Ley 909 de 2004'] })
  assert.equal(r.esError, false)
  assert.equal(r.texto.match(/Extracto de un tema asociado \(NO resume/g)?.length, 1)
  assert.match(r.texto, /ya emitido más arriba para esta misma norma/)
})

test('validar en lote corrige el tipo igual que la consulta individual', LENTO, async () => {
  // "Decreto 624 de 1989" no existe: el tipo oficial es "Decreto Ley". La ruta
  // individual lo corregía y el lote validado devolvía "no fue posible validar".
  const r = await c.tool('resolver_cita', { citas: ['Decreto 624 de 1989'], validar: true })
  assert.equal(r.esError, false)
  assert.doesNotMatch(r.texto, /No fue posible validar/)
  assert.match(r.texto, /el tipo oficial es «DECRETO LEY 624 DE 1989»|el tipo oficial es «Decreto Ley/i)
})
