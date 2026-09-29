/**
 * El Radicado Judicial Único de 23 dígitos: reconocerlo escrito de tres formas
 * (con guiones, con espacios y de corrido), con el sufijo «(AC)», dentro de una
 * frase, y no confundirlo con un número más largo. Sin red: el parser no
 * consulta nada y las tablas de corporación/sala salen de lo medido contra los
 * portales (ver src/nucleo/citas.ts).
 *
 *   node --test test/radicado.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { parsearRadicado, RE_RADICADO_23 } from '../src/nucleo/citas.ts'

test('las tres formas del mismo radicado dan el mismo resultado', () => {
  const formas = [
    '11001-03-15-000-2020-00123-00',
    '11001 03 15 000 2020 00123 00',
    '11001031500020200012300',
  ]
  const esperado = {
    radicado: '11001031500020200012300',
    formateado: '11001-03-15-000-2020-00123-00',
    dane: '11001',
    departamento: 'Bogotá D.C.',
    especialidad: '03',
    sala: '15',
    despacho: '000',
    anio: '2020',
    consecutivo: '00123',
    recurso: '00',
    corporacion: 'consejo-de-estado',
    etiqueta: '',
  }
  for (const forma of formas) {
    assert.deepEqual(parsearRadicado(forma), esperado, forma)
  }
})

test('admite el sufijo «(AC)» que pega la relatoría', () => {
  const r = parsearRadicado('Radicación número: 11001-03-15-000-2020-00123-00(AC)')
  assert.equal(r?.radicado, '11001031500020200012300')
  const r2 = parsearRadicado('EXPEDIENTE 11001-03-15-000-2020-00123-00 (AC)')
  assert.equal(r2?.radicado, '11001031500020200012300')
})

test('lo reconoce dentro de una frase', () => {
  const r = parsearRadicado(
    'En el proceso con radicado 11001-03-15-000-2020-00123-00, la Sección Tercera resolvió...',
  )
  assert.equal(r?.formateado, '11001-03-15-000-2020-00123-00')
})

test('rechaza lo que no tiene 23 dígitos', () => {
  assert.equal(parsearRadicado('1100103150002020001230'), null) // 22
  assert.equal(parsearRadicado('110010315000202000123000'), null) // 24
  assert.equal(parsearRadicado('Ley 909 de 2004'), null)
  assert.equal(parsearRadicado(''), null)
})

test('rechaza un año imposible', () => {
  assert.equal(parsearRadicado('11001-03-15-000-1234-00123-00'), null)
})

test('no casa 23 dígitos dentro de un número más largo (un NIT, un teléfono)', () => {
  assert.equal(parsearRadicado('99911001031500020200012300'), null)
  assert.equal(parsearRadicado('11001031500020200012300000'), null)
})

test('el departamento sale de los 2 primeros dígitos', () => {
  assert.equal(parsearRadicado('11001031500020200012300')?.departamento, 'Bogotá D.C.') // 11
  assert.equal(parsearRadicado('05001233100020210141201')?.departamento, 'Antioquia') // 05
  assert.equal(parsearRadicado('76001233100020170073001')?.departamento, 'Valle del Cauca') // 76
  // Un código que no es departamento no se inventa: queda vacío.
  assert.equal(parsearRadicado('00001031500020200012300')?.departamento, '')
})

test('la corporación y la sala salen de la tabla medida, no de la memoria', () => {
  // Consejo de Estado: 11001-03-28-000-2022-00132-00 salió de la relatoría
  // SAMAI en la Sección Quinta (7 radicados con el mismo 0328).
  const ce = parsearRadicado('11001-03-28-000-2022-00132-00')
  assert.equal(ce?.corporacion, 'consejo-de-estado')
  assert.equal(ce?.etiqueta, 'Sección Quinta')

  // Corte Suprema: 11001-02-03-000-2022-03272-00 se leyó en un auto de la Sala
  // Civil (5 radicados con el mismo 0203).
  const csj = parsearRadicado('11001-02-03-000-2022-03272-00')
  assert.equal(csj?.corporacion, 'corte-suprema')
  assert.equal(csj?.etiqueta, 'Sala de Casación Civil')

  // Una pareja de dígitos que el portal repartió entre varias secciones no
  // declara sala, pero sí la corte donde se midió.
  const varias = parsearRadicado('11001-03-15-000-2020-00123-00')
  assert.equal(varias?.corporacion, 'consejo-de-estado')
  assert.equal(varias?.etiqueta, '')
})

test('los dígitos de un juzgado o tribunal NO son una alta corte', () => {
  // El radicado que aparece dentro del texto de una alta corte suele ser el de
  // ORIGEN. Por eso 31xx (juzgado de circuito) y 23xx (tribunal administrativo)
  // devuelven 'desconocida', no la corporación donde se leyó el número.
  assert.equal(parsearRadicado('11001-31-03-038-2019-00163-01')?.corporacion, 'desconocida') // 3103, juzgado
  assert.equal(parsearRadicado('11001-31-03-038-2019-00163-01')?.etiqueta, '')
  assert.equal(parsearRadicado('25000-23-26-000-2010-00096-01')?.corporacion, 'desconocida') // 2326, tribunal administrativo
  assert.equal(parsearRadicado('25000-23-26-000-2010-00096-01')?.etiqueta, '')
  // Lo que no se midió tampoco se supone: 66001-11-02-… es 'desconocida'.
  assert.equal(parsearRadicado('66001-11-02-066-2017-00419-00')?.corporacion, 'desconocida')
})

test('RE_RADICADO_23 acepta las tres formas y rechaza el número corto', () => {
  assert.ok(RE_RADICADO_23.test('11001-03-15-000-2020-00123-00'))
  assert.ok(RE_RADICADO_23.test('11001031500020200012300'))
  assert.ok(RE_RADICADO_23.test('11001 03 15 000 2020 00123 00'))
  assert.ok(RE_RADICADO_23.test('11001-03-15-000-2020-00123-00(AC)'))
  assert.equal(RE_RADICADO_23.test('1100103150002020001230'), false)
  assert.equal(RE_RADICADO_23.test('110010315000202000123000'), false)
})
