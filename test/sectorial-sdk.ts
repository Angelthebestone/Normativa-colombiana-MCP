/**
 * Validación de alta de adaptadores sectoriales.
 *
 * `registrar()` exige los cinco campos de metadatos del contrato y valida el
 * dominio antes de insertar: un alta fallida no puede dejar la fuente en el
 * registro ni a medias.
 *
 *   node --test test/sectorial-sdk.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { adaptadores, registrar } from '../src/fuentes/sectorial.ts'
import type { Adaptador } from '../src/fuentes/sectorial.ts'

/** Adaptador de prueba: todo válido salvo lo que el caso rompa a propósito. */
const base = (id: string, dominioPermitido?: string): Adaptador =>
  ({
    id,
    nombre: 'Entidad de prueba',
    sector: 'prueba',
    portal: 'https://portal.prueba.gov.co',
    ...(dominioPermitido !== undefined ? { dominioPermitido } : {}),
    tiposDocumento: ['Resolución'],
    soportaTexto: false,
    soportaVigencia: false,
    pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
    advertencia: 'Fuente de prueba: no consulta nada real.',
    buscar: async () => ({ items: [], url: 'https://portal.prueba.gov.co' }),
  }) as unknown as Adaptador

test('registrar() rechaza un adaptador sin dominioPermitido y no contamina el registro', () => {
  assert.throws(() => registrar(base('__prueba_sin_dominio')), /dominioPermitido/)
  assert.ok(
    !adaptadores().some((a) => a.id === '__prueba_sin_dominio'),
    'un alta fallida no puede dejar el id en el registro',
  )
})

test('registrar() rechaza un dominioPermitido que no sea https y no contamina el registro', () => {
  assert.throws(() => registrar(base('__prueba_http', 'http://x.gov.co')), /https/)
  assert.ok(
    !adaptadores().some((a) => a.id === '__prueba_http'),
    'un alta fallida no puede dejar el id en el registro',
  )
})

test('registrar() acepta un adaptador con los cinco campos en regla', () => {
  registrar(base('__prueba_valida', 'https://portal.prueba.gov.co'))
  assert.ok(adaptadores().some((a) => a.id === '__prueba_valida'))
})

test('Supersalud queda registrada con el contrato completo', async () => {
  // Se importa el registro real para que el adaptador esté dado de alta.
  await import('../src/fuentes/sectorial/registro.ts')
  const s = adaptadores().find((a) => a.id === 'supersalud')
  assert.ok(s, 'falta el adaptador supersalud en el registro')
  assert.equal(s!.soportaTexto, false)
  assert.equal(s!.soportaVigencia, false)
  assert.match(s!.dominioPermitido, /^https:\/\//)
  assert.ok(s!.tiposDocumento.length > 0)
  assert.ok(s!.advertencia.length > 40, 'debe declarar qué NO cubre')
})

test('Supersalud busca en su normograma y devuelve actos con el shape', { skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }, async () => {
  await import('../src/fuentes/sectorial/registro.ts')
  const s = adaptadores().find((a) => a.id === 'supersalud')!
  const r = await s.buscar({ texto: 'habilitación', limite: 5 })
  assert.ok(r.items.length > 0, 'el normograma de Supersalud debería devolver resultados para "habilitación"')
  for (const x of r.items) {
    assert.ok(x.tipo && x.anio, `fila sin tipo o año: ${JSON.stringify(x)}`)
    assert.ok(x.epigrafe || x.url, 'fila sin epígrafe ni url')
  }
})

test('ANT queda registrada con el contrato completo', async () => {
  await import('../src/fuentes/sectorial/registro.ts')
  const s = adaptadores().find((a) => a.id === 'ant')
  assert.ok(s, 'falta el adaptador ant en el registro')
  assert.equal(s!.soportaTexto, false)
  assert.equal(s!.soportaVigencia, false)
  assert.match(s!.dominioPermitido, /^https:\/\//)
  assert.ok(s!.tiposDocumento.length > 0)
  assert.ok(s!.advertencia.length > 40, 'debe declarar qué NO cubre')
})

test('ANT busca en su normativa y devuelve actos con el shape', { skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }, async () => {
  await import('../src/fuentes/sectorial/registro.ts')
  const s = adaptadores().find((a) => a.id === 'ant')!
  const r = await s.buscar({ texto: 'Sembrando Vida', limite: 5 })
  assert.ok(r.items.length > 0, 'la normativa de la ANT debería devolver resultados para "Sembrando Vida"')
  for (const x of r.items) {
    assert.ok(x.tipo && x.numero, `fila sin tipo o número: ${JSON.stringify(x)}`)
    assert.ok(x.url.startsWith('https://www.ant.gov.co'), `url fuera del dominio: ${x.url}`)
  }
})

test('Unidad de Víctimas queda registrada con el contrato completo', async () => {
  await import('../src/fuentes/sectorial/registro.ts')
  const s = adaptadores().find((a) => a.id === 'unidadvictimas')
  assert.ok(s, 'falta el adaptador unidadvictimas en el registro')
  assert.equal(s!.soportaTexto, false)
  assert.equal(s!.soportaVigencia, false)
  assert.match(s!.dominioPermitido, /^https:\/\//)
  assert.ok(s!.tiposDocumento.length > 0)
  assert.ok(s!.advertencia.length > 40, 'debe declarar qué NO cubre')
})

test('Unidad de Víctimas busca en su biblioteca y devuelve documentos con el shape', { skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }, async () => {
  await import('../src/fuentes/sectorial/registro.ts')
  const s = adaptadores().find((a) => a.id === 'unidadvictimas')!
  const r = await s.buscar({ limite: 5 })
  assert.ok(r.items.length > 0, 'la biblioteca de la Unidad de Víctimas debería devolver documentos')
  for (const x of r.items) {
    assert.ok(x.tipo && x.anio, `fila sin tipo o año: ${JSON.stringify(x)}`)
    assert.ok(x.epigrafe, `fila sin epígrafe (título): ${JSON.stringify(x)}`)
    assert.ok(x.url.startsWith('https://www.unidadvictimas.gov.co'), `url fuera del dominio: ${x.url}`)
  }
})
