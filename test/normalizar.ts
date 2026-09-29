/**
 * El normalizador de entrada: lo que se endereza ANTES de validar.
 *
 * Los casos de abajo son los dos lados del filo. Lo que tiene que limpiar
 * (rótulo y ordinal) y, sobre todo, lo que NO puede tocar: un artículo del
 * decreto único («2.4.1.2.44»), uno con guion («771-5») y uno con letra
 * («13A») son números legítimos, y recortarlos convertiría una consulta buena
 * en una que no encuentra nada.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { numeroDeArticulo } from '../src/nucleo/normalizar.ts'

test('numeroDeArticulo quita el rótulo y el ordinal', () => {
  for (const [dado, esperado] of [
    ['Art. 6º', '6'],
    ['artículo 40', '40'],
    ['ARTÍCULO 3', '3'],
    ['art. 2.4.1.2.44', '2.4.1.2.44'],
    ['Artículos 3', '3'],
    ['ART 6', '6'],
    ['articulo 6°', '6'],
    ['  40  ', '40'],
  ] as const) {
    assert.equal(numeroDeArticulo(dado), esperado, `${dado} → ${esperado}`)
  }
})

test('numeroDeArticulo no toca un número de artículo legítimo', () => {
  for (const v of ['6', '2.4.1.2.44', '771-5', '13A', '2.2.1.1.1.3.1']) {
    assert.equal(numeroDeArticulo(v), v, `${v} tiene que salir intacto`)
  }
})

test('lo que no es texto sale intacto, para que el error lo dé el esquema', () => {
  assert.equal(numeroDeArticulo(6), 6)
  assert.equal(numeroDeArticulo(undefined), undefined)
  assert.deepEqual(numeroDeArticulo(['6']), ['6'])
})

test('un rótulo sin número se devuelve entero: no se inventa un vacío', () => {
  // Si se recortara a "" el esquema diría "string vacío" en vez de enseñar lo
  // que de verdad llegó, que es lo único que ayuda a quien se equivocó.
  assert.equal(numeroDeArticulo('art.'), 'art.')
  assert.equal(numeroDeArticulo('artículo'), 'artículo')
})
