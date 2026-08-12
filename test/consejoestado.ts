/**
 * Pruebas unitarias del enlace de búsqueda del Consejo de Estado: el modo
 * exacto (frase entre comillas, searchMode phrase) frente al OR del portal.
 * Sin red.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { enlaceBusqueda } from '../src/fuentes/jurisprudencia/consejoestado.ts'

test('enlaceBusqueda con exacto=true usa comillas (frase exacta) con searchMode any', () => {
  const url = enlaceBusqueda('nulidad electoral', 0, true)
  const dic = decodeURIComponent(url.split('BusquedaDictionary=')[1]!)
  const j = JSON.parse(dic)
  assert.equal(j.searchMode, 'any') // SAMAI no soporta 'phrase': la frase va en comillas
  assert.equal(j.busqueda, '("nulidad electoral")')
})

test('enlaceBusqueda con exacto=false usa OR sin comillas', () => {
  const url = enlaceBusqueda('nulidad electoral', 0, false)
  const dic = decodeURIComponent(url.split('BusquedaDictionary=')[1]!)
  const j = JSON.parse(dic)
  assert.equal(j.searchMode, 'any')
  assert.equal(j.busqueda, '(nulidad electoral)')
})

test('enlaceBusqueda quita los paréntesis del término para no romper la sintaxis', () => {
  const url = enlaceBusqueda('nulidad (electoral)', 0, true)
  const dic = decodeURIComponent(url.split('BusquedaDictionary=')[1]!)
  const j = JSON.parse(dic)
  assert.equal(j.busqueda, '("nulidad electoral")')
})
