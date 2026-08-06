/**
 * Pruebas de los alias de entidades: resolución a nombre oficial, insensibilidad
 * a mayúsculas/tildes y pasaje literal cuando no hay alias.
 *
 *   node --test test/entidades.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { normalizarEntidad } from '../src/entidades.ts'

test('el alias se resuelve sin importar mayúsculas ni tildes', () => {
  const mayusculas = normalizarEntidad('DIAN')
  const minusculas = normalizarEntidad('dian')
  assert.equal(mayusculas.oficial, 'Unidad Administrativa Especial Dirección de Impuestos y Aduanas Nacionales')
  assert.equal(mayusculas.aliasUsado, 'DIAN')
  assert.equal(minusculas.oficial, mayusculas.oficial)
  assert.notEqual(minusculas.aliasUsado, null)
})

test('lo que no es un alias se devuelve tal cual, sin aliasUsado', () => {
  const r = normalizarEntidad('dian-abc')
  assert.equal(r.oficial, 'dian-abc')
  assert.equal(r.aliasUsado, null)
})

test('un alias con mayúscula interna se resuelve a su nombre oficial', () => {
  assert.equal(normalizarEntidad('Mintrabajo').oficial, 'Ministerio del Trabajo')
})

test('un alias con espacios alrededor se resuelve y el aliasUsado va recortado', () => {
  const r = normalizarEntidad('  creg ')
  assert.equal(r.oficial, 'Comisión de Regulación de Energía y Gas')
  assert.equal(r.aliasUsado, 'creg')
})
