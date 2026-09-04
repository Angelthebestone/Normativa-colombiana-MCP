/**
 * Las leyes que sustituyen artículos de otro cuerpo normativo transcriben el
 * artículo nuevo, y el extractor cortaba justo en los dos puntos: devolvía
 * "El artículo 217 del Código Civil quedará así:" y nada más. Sin red.
 *
 *   node --test test/articulo-sustitucion.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { articulo, indiceArticulos } from '../src/nucleo/parse.ts'

/** La forma de la Ley 1060 de 2006, que es la que se comprobó contra el portal. */
const LEY_MODIFICATORIA = [
  'LEY 1060 DE 2006',
  '',
  'Artículo 4°. El artículo 216 del Código Civil quedará así:',
  '',
  'Artículo 216. Podrán impugnar la paternidad del hijo nacido durante el matrimonio.',
  '',
  'Artículo 5°. El artículo 217 del Código Civil quedará así:',
  '',
  'Artículo 217. El hijo podrá impugnar la paternidad o la maternidad en cualquier tiempo.',
  'La acción caducará en ciento cuarenta días.',
  '',
  'Artículo 6°. La presente ley rige a partir de su publicación.',
].join('\n')

test('el artículo sustituido viaja con el artículo que lo sustituye', () => {
  const art = articulo(LEY_MODIFICATORIA, '5')!
  assert.match(art, /El artículo 217 del Código Civil quedará así:/)
  assert.match(art, /El hijo podrá impugnar la paternidad/)
  assert.match(art, /ciento cuarenta días/)
})

test('el corte sigue siendo el artículo siguiente de la ley, no el resto del documento', () => {
  const art = articulo(LEY_MODIFICATORIA, '5')!
  assert.doesNotMatch(art, /La presente ley rige/)
  assert.match(articulo(LEY_MODIFICATORIA, '6')!, /La presente ley rige/)
})

test('un bloque que anuncia varios artículos los trae todos', () => {
  const varios = [
    'Artículo 2°. Los artículos 217, 218 y 219 del Código Civil quedarán así:',
    '',
    'Artículo 217. Uno.',
    '',
    'Artículo 218. Dos.',
    '',
    'Artículo 219. Tres.',
    '',
    'Artículo 3°. Vigencia.',
  ].join('\n')
  const art = articulo(varios, '2')!
  for (const cuerpo of ['Uno.', 'Dos.', 'Tres.']) assert.match(art, new RegExp(cuerpo))
  assert.doesNotMatch(art, /Vigencia/)
})

test('el índice no ofrece como propios los artículos que la ley solo transcribe', () => {
  assert.deepEqual(indiceArticulos(LEY_MODIFICATORIA), ['4', '5', '6'])
})

test('una ley sin sustituciones se sigue cortando igual que antes', () => {
  const normal = [
    'Artículo 1. Objeto de la ley.',
    'Artículo 2. Ámbito, según el artículo 15 Ley 91 de 1989.',
    'Artículo 3. Vigencia.',
  ].join('\n')
  assert.equal(articulo(normal, '2'), 'Artículo 2. Ámbito, según el artículo 15 Ley 91 de 1989.')
  assert.deepEqual(indiceArticulos(normal), ['1', '2', '3'])
})

/**
 * El Estatuto Tributario numera 771-5 (bancarización) además de 771: pedir el
 * 771 devolvía el encabezado del 771-5 en cuanto era el primero en aparecer.
 */
test('el número con guion es un artículo distinto del número a secas', () => {
  const et = [
    'Artículo 771. Prueba supletoria de las compras.',
    'Cuerpo del 771.',
    '',
    'Artículo 771-5. Medios de pago para efectos de la aceptación de costos.',
    'Cuerpo de la bancarización.',
    '',
    'Artículo 772. Otro.',
  ].join('\n')
  assert.match(articulo(et, '771')!, /Prueba supletoria/)
  assert.doesNotMatch(articulo(et, '771')!, /bancarización/)
  assert.match(articulo(et, '771-5')!, /Medios de pago/)
  assert.deepEqual(indiceArticulos(et), ['771', '771-5', '772'])
})

test('los decretos compilatorios conservan su numeración por niveles', () => {
  const dec = ['Artículo 2.2.1.3.1. Uno.', 'texto', 'Artículo 2.2.1.3.2. Dos.'].join('\n')
  assert.match(articulo(dec, '2.2.1.3.1')!, /Uno\./)
  assert.doesNotMatch(articulo(dec, '2.2.1.3.1')!, /Dos\./)
  assert.deepEqual(indiceArticulos(dec), ['2.2.1.3.1', '2.2.1.3.2'])
})
