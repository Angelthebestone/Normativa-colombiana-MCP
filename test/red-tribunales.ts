/**
 * Red de regresión — dominio tribunales: ≥10 casos adversariales y de
 * contrato sobre buscar_jurisprudencia, obtener_documento(fuente="corte"),
 * buscar_jurisprudencia_suprema/consejo_estado y obtener_documento
 * (suprema/consejo). Lee SIEMPRE el `content[0].text` crudo y `isError`.
 *
 *   npm run build && node --test test/red-tribunales.ts
 */
import { strict as assert } from 'node:assert'
import test, { after, before } from 'node:test'

import { abrirCliente, CONTRATO, LENTO, type Cliente } from './red.ts'

let c: Cliente
before(async () => {
  c = await abrirCliente()
})
after(() => c.cerrar())

test('buscar_jurisprudencia: exige termino (esquema), no devuelve todo', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  const t = tools.find((x: any) => x.name === 'buscar_jurisprudencia')
  assert.deepEqual(t.inputSchema.required, ['termino'])
})

test('buscar_jurisprudencia: un vacío se informa como texto, no como fallo', LENTO, async () => {
  const r = await c.tool('buscar_jurisprudencia', { termino: 'zzqxnoexisteestetermino' })
  assert.equal(r.esError, false)
})

test('buscar_jurisprudencia: excluye autos salvo que se pidan', LENTO, async () => {
  const r = await c.tool('buscar_jurisprudencia', { termino: 'teletrabajo', limite: 5 })
  assert.equal(r.esError, false)
  assert.doesNotMatch(r.texto, /\bA\b.*Auto|Auto de/i)
})

test('buscar_jurisprudencia: el aviso de baja pertinencia no culpa a un filtro no usado', LENTO, async () => {
  const r = await c.tool('buscar_jurisprudencia', { termino: 'teletrabajo', tipos: ['A'], limite: 3 })
  if (/Atención:/.test(r.texto)) {
    assert.doesNotMatch(r.texto, /sin desde\/hasta/)
  }
})

test('obtener_documento: fuente="corte" sin ruta es error de validación', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /hace falta ruta/)
})

test('obtener_documento: una ruta inexistente de corte se informa como texto', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2024/NO-EXISTE-99.htm' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /No existe una providencia/)
})

test('obtener_documento: una sección inexistente de corte avisa con las disponibles', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2024/NO-EXISTE-99.htm', seccion: 'decision' })
  assert.equal(r.esError, false)
})

test('obtener_documento: fuente="suprema" exige ruta Y sala', CONTRATO, async () => {
  const sinSala = await c.tool('obtener_documento', { fuente: 'suprema', ruta: 'x.htm' })
  assert.equal(sinSala.esError, true)
  assert.match(sinSala.texto, /ruta y sala/)
})

test('obtener_documento: fuente="consejo" sin token es error de validación', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'consejo' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /hace falta token/)
})

test('obtener_documento: un token caduco o inválido de consejo se informa como texto', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'consejo', token: 'token-falso' })
  assert.equal(r.esError, false)
})

test('la Corte Suprema entrega la ruta con la que pedir el texto', LENTO, async () => {
  const b = await c.tool('buscar_jurisprudencia_suprema', { texto: 'despido sin justa causa', sala: 'Laboral', limite: 3 })
  assert.equal(b.esError, false)
  const ruta = b.texto.match(/ruta="([^"]+)"/)?.[1]
  assert.ok(ruta, 'la búsqueda debe decir con qué ruta pedir el texto')

  const t = await c.tool('obtener_documento', { fuente: 'suprema', ruta, sala: 'Laboral', limite_caracteres: 1200 })
  assert.equal(t.esError, false)
  assert.match(t.texto, /Texto total: \d[\d.,]* caracteres/)
})

test('el Consejo de Estado entrega token y texto con tope', LENTO, async () => {
  const b = await c.tool('buscar_jurisprudencia_consejo_estado', { texto: 'liquidación del contrato estatal', limite: 3 })
  assert.equal(b.esError, false)
  assert.match(b.texto, /CADUCAN EN UNA HORA/)
  const token = b.texto.match(/token="([^"]+)"/)?.[1]
  assert.ok(token, 'la búsqueda debe entregar el token')

  const t = await c.tool('obtener_documento', { fuente: 'consejo', token, limite_caracteres: 1000 })
  assert.equal(t.esError, false)
  if (/no se sirve como PDF/.test(t.texto)) return
  assert.match(t.texto, /Texto total: \d[\d.,]* caracteres/)
})
