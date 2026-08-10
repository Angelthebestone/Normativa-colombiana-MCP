/**
 * Pruebas de src/herramientas/cambios_desde.ts: el filtro por año y el
 * formato de los cambios, sin red.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { filtrarPorAnio, formatear, formatearCambio } from '../src/herramientas/cambios_desde.ts'
import type { Cambio } from '../src/nucleo/parse.ts'

const cambio = (anio: string): Cambio => ({
  accion: 'modificado',
  norma: 'Ley 1960 de 2019',
  anio,
  articulo: '1',
  literal: 'Modificado por el art. 1 de la Ley 1960 de 2019',
})

test('filtrarPorAnio conserva solo los cambios del año mínimo o posterior', () => {
  const cambios = [cambio('2020'), cambio('2021'), cambio('2022')]
  assert.deepEqual(filtrarPorAnio(cambios, 2021).map((c) => c.anio), ['2021', '2022'])
})

test('filtrarPorAnio excluye los cambios sin año', () => {
  const cambios = [cambio(''), cambio('2021')]
  assert.deepEqual(filtrarPorAnio(cambios, 2021).map((c) => c.anio), ['2021'])
})

test('formatearCambio incluye la acción y la nota literal', () => {
  const linea = formatearCambio(cambio('2021'))
  assert.match(linea, /- MODIFICADO por Ley 1960 de 2019 de 2021, artículo 1/)
  assert.match(linea, /Nota literal: «Modificado por el art\. 1 de la Ley 1960 de 2019»/)
})

test('formatear une las secciones y cierra con el aviso de que no rastrea novedades', () => {
  const texto = formatear(['una', 'dos'])
  assert.ok(texto.startsWith('una\ndos'))
  assert.ok(texto.includes('NO es un rastreo de novedades'))
  assert.match(texto, /no descubre normas nuevas por su cuenta\./)
})
