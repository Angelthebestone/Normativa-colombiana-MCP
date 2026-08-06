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
