/**
 * Los tipos de providencia se aceptan por su nombre corriente: "tutela" no debe
 * ser un error de esquema ni llegar al portal como cadena desconocida.
 *
 *   node --test test/tipos-corte.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { z } from 'zod'

import { normalizarTipo } from '../src/fuentes/jurisprudencia/corte.ts'

// El mismo esquema que registra index.ts para `tipos`.
const tipos = z
  .preprocess((v) => (Array.isArray(v) ? v.map(normalizarTipo) : v), z.array(z.enum(['C', 'T', 'SU', 'A'])))
  .optional()

test('los nombres corrientes se normalizan a la sigla de la relatoría', () => {
  assert.deepEqual(tipos.parse(['tutela', 'Constitucionalidad', 'unificación', 'AUTO']), ['T', 'C', 'SU', 'A'])
})

test('las siglas válidas pasan intactas, en cualquier caja', () => {
  assert.deepEqual(tipos.parse(['C', 't', 'su', 'A']), ['C', 'T', 'SU', 'A'])
})

test('sin tipos sigue siendo opcional', () => {
  assert.equal(tipos.parse(undefined), undefined)
})

test('un tipo desconocido se rechaza, no se ignora', () => {
  assert.throws(() => tipos.parse(['sentencia de casación']))
})
