/**
 * Red de regresión — dominio Gestor: ≥10 casos adversariales y de contrato
 * sobre resolver_cita, obtener_documento(fuente="gestor"), buscar_normas,
 * buscar_por_tema, listar_catalogos y explicar_relacion_tema. Lee SIEMPRE el
 * `content[0].text` crudo y `isError` que entrega el servidor compilado.
 *
 *   npm run build && node --test test/red-gestor.ts
 */
import { strict as assert } from 'node:assert'
import test, { after, before } from 'node:test'

import { abrirCliente, CONTRATO, LENTO, type Cliente } from './red.ts'

let c: Cliente
before(async () => {
  c = await abrirCliente()
})
after(() => c.cerrar())

test('resolver_cita: una cita exacta devuelve id y nunca isError', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'Ley 909 de 2004' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /id: \d+/)
  assert.match(r.texto, /Consulta del \d{4}-\d{2}-\d{2}\./)
})

test('resolver_cita: una cita que no existe se informa como texto, no como fallo', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'Ley 99999 de 2012' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /No encontré la cita/)
})

test('resolver_cita: una cita ambigua no elige por ti', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'Decreto 1072' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /ambigua/i)
})

test('resolver_cita: validar=true produce el veredicto ✓/✗', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'Ley 909 de 2004', validar: true })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Resultado: (cita validada|cita parcialmente validada|no fue posible validar)/)
})

test('obtener_documento: fuente="gestor" sin id es un error de validación, no un vacío', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /hace falta id/)
})

test('obtener_documento: un id inexistente se reporta como texto, no como fallo', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '99999999' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /No encontré una norma con id 99999999/)
})

test('obtener_documento: un artículo que no existe avisa con los detectados', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', articulo: '999' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /No encontré el artículo 999/)
  assert.match(r.texto, /Artículos detectados:/)
})

test('obtener_documento: un tope de caracteres fuera de rango se ajusta, no revienta', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', limite_caracteres: 5 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Ley 1221 de 2008/)
})

test('obtener_documento: historial=true sobre el art. 6 no dice "sin cambios" cuando los hay', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', articulo: '6', historial: true })
  assert.equal(r.esError, false)
  assert.doesNotMatch(r.texto, /no registran cambios/)
})

test('obtener_documento: buscar_en_texto agrupa pasajes y no devuelve el documento entero', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '62866', buscar_en_texto: 'encargo' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /agrupadas en \d+ pasaje/)
  assert.ok(r.texto.length < 40_000, `devolvió ${r.texto.length} caracteres`)
})

test('obtener_documento: limite_caracteres manda también en modo búsqueda', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '14861', buscar_en_texto: 'empleo', limite_caracteres: 1500 })
  assert.equal(r.esError, false)
  assert.ok(r.texto.length < 5000, `devolvió ${r.texto.length} caracteres`)
  assert.match(r.texto, /no caben en 1500 caracteres/)
})

test('obtener_documento: un "desde" más allá del final no es un vacío', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', desde: 999_999 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /más allá del final del texto/)
})

test('buscar_normas: con solo tipo Concepto responde (no es un error de validación)', LENTO, async () => {
  // Antes el "concepto" sin filtros devolvía los 21.759; hoy el tipo es un
  // filtro legítimo. Lo que debe quedar claro es que no es un -32602 crudo.
  const r = await c.tool('buscar_normas', { tipo_documento: 'Concepto', limite: 2 })
  assert.equal(r.esError, false)
})

test('buscar_por_tema: devuelve temsubid con prefijo y rótulos normalizados', LENTO, async () => {
  const r = await c.tool('buscar_por_tema', { texto: 'teletrabajo', limite: 5 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /temsubid ts-\d+/)
  assert.doesNotMatch(r.texto, /PROVISIóN/)
})

test('listar_catalogos: sin filtro en temas pide el filtro, no devuelve los 2.509', CONTRATO, async () => {
  const r = await c.tool('listar_catalogos', { catalogo: 'temas' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /indica un filtro/i)
})

test('listar_catalogos: conceptos_fp sin filtro se rechaza', CONTRATO, async () => {
  const r = await c.tool('listar_catalogos', { catalogo: 'conceptos_fp' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /numero o anio/)
})

test('explicar_relacion_tema: un id de otra taxonomía se rechaza con el catálogo correcto', CONTRATO, async () => {
  const r = await c.tool('explicar_relacion_tema', { temsubid: 'sub-38968', normid: '31431' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /listar_catalogos/)
})

test('explicar_relacion_tema: sin prefijo no se sabe de qué catálogo es', CONTRATO, async () => {
  const r = await c.tool('explicar_relacion_tema', { temsubid: '38968', normid: '31431' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /ts-/)
})
