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

// --- la coincidencia inicial exige inicio de renglón ----------------------

/**
 * La Ley 789 de 2002 cita «el Artículo 28 de la Ley 21 de 1982» dentro de su
 * artículo 3, y esa cita aparece ANTES de su propio ARTÍCULO 28: pedir «28»
 * devolvía el subsidio familiar de otra ley. Recorte real medido el 2026-09-28
 * en https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=6778.
 */
const LEY_789 = [
  'ARTÍCULO 3°. Régimen del subsidio familiar en dinero. Deroga el Artículo 28 de la Ley 21 de 1982. Tienen derecho al subsidio familiar en dinero los trabajadores cuya remuneración mensual, fija o variable no sobrepase los cuatro (4) salarios minimos legales mensuales vigentes.',
  '',
  'ARTÍCULO 28. Terminación unilateral del contrato de trabajo sin justa causa.',
  '',
  'El artículo 64 del Código Sustantivo del Trabajo, subrogado por el artículo 6° de la Ley 50 de 1990, quedara asi:',
  '',
  '"ARTÍCULO 64. Terminación unilateral del contrato de trabajo sin justa causa. En todo contrato de trabajo va envuelta la condición resolutoria por incumplimiento de lo pactado, con indemnizacion de perjuicios a cargo de la parte responsable.',
].join('\n')

test('una cita en prosa no se lleva el artículo que la ley sí tiene', () => {
  const art = articulo(LEY_789, '28')
  assert.ok(art)
  assert.match(art!, /^ARTÍCULO 28\. Terminación unilateral/)
  assert.match(art!, /quedara asi/)
  assert.doesNotMatch(art!, /subsidio familiar/)
})

/**
 * En el Estatuto Tributario el artículo 207 cita «el Artículo 246 del Código de
 * Comercio»: pedir el 246 devolvía esa cita. Recorte real medido el 2026-09-28
 * en https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=6533.
 */
const ET = [
  'ARTÍCULO 207. Hecho generador del impuesto sobre la renta… (recorte) …exigirá el plazo de cinco (5) años cuando el Fondo de Pensiones asuma pensiones de jubilación por razón de la disolución de una sociedad, de conformidad con el Artículo 246 del Código de Comercio.',
  '',
  '(Ver Art, 246 del Código de Comercio, Decreto 410 de 1971)',
  '',
  'ARTÍCULO 246. TARIFA ESPECIAL PARA DIVIDENDOS Y PARTICIPACIONES RECIBIDOS POR ESTABLECIMIENTOS PERMANENTES DE SOCIEDADES EXTRANJERAS. La tarifa del impuesto sobre la renta aplicable a los dividendos… (recorte)',
].join('\n')

test('la cita al Código de Comercio no suplanta al artículo del Estatuto Tributario', () => {
  const art = articulo(ET, '246')
  assert.ok(art)
  assert.match(art!, /^ARTÍCULO 246\. TARIFA ESPECIAL/)
  assert.doesNotMatch(art!, /Código de Comercio/)
})

// --- el anuncio de la transcripción también cierra en punto ----------------

/**
 * La Ley 2418 de 2024 anuncia la transcripción con punto («el cual quedará
 * así.»), y sin aceptarlo el extractor devolvía solo el anuncio, sin el
 * articulado transcrito. Recorte real medido el 2026-09-28 en
 * https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=249256.
 */
const LEY_2418 = [
  'ARTÍCULO 3. Modifíquese el numeral 1 del artículo 2 de la ley 909 de 2004, el cual quedará así.',
  '',
  'ARTÍCULO 2. PRINCIPIOS DE LA FUNCIÓN PÚBLICA.',
  '',
  'La función pública se desarrolla teniendo en cuenta los principios constitucionales de iguaidad, mérito, accesibilidad universal, moralidad, eficacia, economía, imparcialidad, transparencia, celeridad y publicidad.',
  '',
  'ARTÍCULO 4. Modifíquese el artículo 27 de la ley 909 de 2004, el cual quedará así.',
].join('\n')

test('el anuncio terminado en punto también viaja con su transcripción', () => {
  const art = articulo(LEY_2418, '3')!
  assert.match(art, /el cual quedará así\./)
  assert.match(art, /ARTÍCULO 2\. PRINCIPIOS DE LA FUNCIÓN PÚBLICA/)
  assert.match(art, /accesibilidad universal/)
  assert.doesNotMatch(art, /ARTÍCULO 4\./)
})

test('el índice no ofrece como propio el artículo transcrito tras un anuncio con punto', () => {
  assert.deepEqual(indiceArticulos(LEY_2418), ['3', '4'])
})
