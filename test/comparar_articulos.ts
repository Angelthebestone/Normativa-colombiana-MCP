/**
 * Formateo de la comparación de artículos: sin red, probando el helper
 * inyectable y la clasificación por patrones.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { formatear } from '../src/herramientas/comparar_articulos.ts'

const A = { titulo: 'Ley 909 de 2004', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=1' }
const B = { titulo: 'Decreto 1083 de 2015', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=2' }

test('un añadido con plazo se clasifica como "plazo"', () => {
  const salida = formatear({ anadidos: ['deberá hacerlo dentro de los 30 días'], eliminados: [] }, A, B)
  assert.match(salida, /AÑADIDO en Decreto 1083 de 2015 — plazo: «deberá hacerlo dentro de los 30 días»/)
})

test('un eliminado sin marcas se clasifica como "no clasificado"', () => {
  const salida = formatear({ anadidos: [], eliminados: ['el empleado debe radicar la solicitud'] }, A, B)
  assert.match(salida, /ELIMINADO de Ley 909 de 2004 — no clasificado: «el empleado debe radicar la solicitud»/)
})

test('textos iguales devuelven el aviso de igualdad', () => {
  const salida = formatear({ anadidos: [], eliminados: [] }, A, B)
  assert.match(salida, /Los dos artículos son textualmente iguales\./)
})

test('el cierre aclara que la clasificación no es semántica', () => {
  const salida = formatear({ anadidos: ['una línea'], eliminados: [] }, A, B)
  assert.match(salida, /sin modelo semántico/)
})

test('se citan los enlaces de ambas normas', () => {
  const salida = formatear({ anadidos: ['una línea'], eliminados: [] }, A, B)
  assert.match(salida, /Ley 909 de 2004: https:\/\/www\.funcionpublica\.gov\.co\/eva\/gestornormativo\/norma\.php\?i=1/)
  assert.match(salida, /Decreto 1083 de 2015: https:\/\/www\.funcionpublica\.gov\.co\/eva\/gestornormativo\/norma\.php\?i=2/)
})
