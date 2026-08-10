/**
 * Red de regresión — dominio V2/meta: ≥10 casos adversariales y de contrato
 * sobre buscar_unificado, analizar_conflicto, cambios_desde, comparar_articulos,
 * consultar_perfil, consultar_por_jerarquia, expediente, describir_fuentes y
 * buscar_en_suin. Lee SIEMPRE el `content[0].text` crudo y `isError`.
 *
 *   npm run build && node --test test/red-v2.ts
 */
import { strict as assert } from 'node:assert'
import test, { after, before } from 'node:test'

import { abrirCliente, CONTRATO, LENTO, type Cliente } from './red.ts'

let c: Cliente
before(async () => {
  c = await abrirCliente()
})
after(() => c.cerrar())

test('tools/list declara las 24 herramientas con esquema utilizable', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  assert.equal(tools.length, 24, tools.map((t: any) => t.name).join(', '))
  for (const t of tools) {
    assert.ok(t.description?.length > 40, `${t.name} necesita descripción`)
    for (const [campo, esquema] of Object.entries(t.inputSchema.properties ?? {})) {
      assert.ok(Object.keys(esquema as object).length > 0, `${t.name}.${campo} sin tipo`)
    }
  }
})

test('buscar_unificado: sin parámetros se rechaza (exige texto)', CONTRATO, async () => {
  const r = await c.tool('buscar_unificado', {})
  assert.equal(r.esError, true)
})

test('buscar_unificado: un vacío se reporta por fuente, no como fallo', LENTO, async () => {
  const r = await c.tool('buscar_unificado', { texto: 'zzqxnoexisteestetermino', limite: 3 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Sin resultados/)
})

test('buscar_unificado: un filtro de fuentes solo consulta esas', LENTO, async () => {
  const r = await c.tool('buscar_unificado', { texto: 'teletrabajo', fuentes: ['corte'], limite: 3 })
  assert.equal(r.esError, false)
  assert.doesNotMatch(r.texto, /Sin resultados en: gestor/)
})

test('analizar_conflicto: exige las dos normas', CONTRATO, async () => {
  const r = await c.tool('analizar_conflicto', {})
  assert.equal(r.esError, true)
})

test('cambios_desde: una fecha mal formada se rechaza', CONTRATO, async () => {
  const r = await c.tool('cambios_desde', { desde: 'no-es-fecha', normas: [] })
  assert.equal(r.esError, true)
})

test('comparar_articulos: exige los dos textos o las dos normas', CONTRATO, async () => {
  const r = await c.tool('comparar_articulos', {})
  assert.equal(r.esError, true)
})

test('consultar_perfil: sin texto es un error de validación (exige texto)', CONTRATO, async () => {
  const r = await c.tool('consultar_perfil', { perfil: 'no-existe' })
  assert.equal(r.esError, true)
})

test('consultar_por_jerarquia: sin texto se rechaza', CONTRATO, async () => {
  const r = await c.tool('consultar_por_jerarquia', {})
  assert.equal(r.esError, true)
})

test('expediente: sin EXPEDIENTES=1 avisa del feature desactivado, no falla', CONTRATO, async () => {
  const r = await c.tool('expediente', { accion: 'crear' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /desactivada|EXPEDIENTES=1/)
})

test('expediente: una accion inválida se rechaza', CONTRATO, async () => {
  const r = await c.tool('expediente', { accion: 'borrar' as never })
  assert.equal(r.esError, true)
})

test('describir_fuentes: declara el alcance con números medidos', CONTRATO, async () => {
  const r = await c.tool('describir_fuentes', {})
  assert.equal(r.esError, false)
  assert.match(r.texto, /no cubre|NO cubre/)
})

test('buscar_en_suin: un vacío se informa como texto, no como fallo, y avisa de sus límites', LENTO, async () => {
  const r = await c.tool('buscar_en_suin', { texto: 'zzqxnoexisteestetermino', limite: 3 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /No encontré documentos en SUIN/)
  assert.match(r.texto, /solo indexa título/)
})
