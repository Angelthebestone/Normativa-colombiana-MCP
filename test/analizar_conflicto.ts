/**
 * Pruebas del formateo de analizar_conflicto, sin red: se alimenta `formatear`
 * con evidencia simulada.
 *
 *   node --test test/analizar_conflicto.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { formatear, type Evidencia } from '../src/herramientas/analizar_conflicto.ts'

const evidencia = (parcial: Partial<Evidencia> = {}): Evidencia => ({
  cita: 'Ley 909 de 2004',
  parseada: true,
  titulo: 'Ley 909 de 2004',
  url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=123',
  nivel: 'ley',
  caracter: 'Las leyes y los actos legislativos son de carácter vinculante y de rango superior a los decretos y resoluciones.',
  vigencia: '',
  reformas: [],
  pasajes: [],
  noEncontrada: false,
  ambigua: false,
  candidatos: [],
  ...parcial,
})

const a = evidencia()
const b = evidencia({ cita: 'Decreto 1083 de 2015', titulo: 'Decreto 1083 de 2015', nivel: 'decreto' })

test('el texto incluye el cierre "Conflicto POTENCIAL"', () => {
  const t = formatear(a, b)
  assert.ok(t.includes('Conflicto POTENCIAL, no conclusión jurídica'))
})

test('incluye "Carácter:" cuando hay evidencia de la norma', () => {
  const t = formatear(a, b)
  assert.ok(t.includes('Carácter:'))
  assert.ok(t.includes('vinculante'))
})

test('sin evidencia de una norma dice que no se encontró', () => {
  const t = formatear(evidencia({ noEncontrada: true }), b)
  assert.ok(t.includes('No se encontró en el Gestor'))
  assert.ok(t.includes('no concluyas que no existe'))
})

test('la vigencia se cita literal cuando consta, y no se afirma cuando falta', () => {
  const con = formatear(evidencia({ vigencia: 'Vigente' }), b)
  assert.ok(con.includes('Estado de vigencia según SUIN-Juriscol: Vigente'))
  const sin = formatear(a, b)
  assert.ok(!sin.includes('Estado de vigencia según SUIN-Juriscol'))
})

test('las reformas se citan literales, con su nota', () => {
  const t = formatear(evidencia({ reformas: ['- MODIFICADO por Ley 1960 de 2019 nota literal: «Modificado por el Art. 1 de la Ley 1960 de 2019»'] }), b)
  assert.ok(t.includes('reformas anotadas en el texto'))
  assert.ok(t.includes('nota literal: «Modificado por el Art. 1 de la Ley 1960 de 2019»'))
})

test('el tema sobre el que se busca se reporta incluso cuando no aparece', () => {
  const t = formatear(a, b, 'teletrabajo')
  assert.ok(t.includes('pasajes que mencionan «teletrabajo»'))
  assert.ok(t.includes('La cadena exacta «teletrabajo» no casó en el texto revisado'))
  assert.ok(t.includes('la búsqueda es literal y no lematiza'))
})

test('el plural casa con el singular: "términos" encuentra "término" y lo declara', () => {
  // El caso del informe: el Decreto 2591 habla de "término" y se pedía "términos".
  const conVariante = formatear(
    evidencia({ pasajes: ['…el término corre…'], terminoCasado: 'término', variantes: ['términos'] }),
    b,
    'términos',
  )
  assert.ok(conVariante.includes('casó la variante «término»'))
  assert.ok(conVariante.includes('…el término corre…'))
})
