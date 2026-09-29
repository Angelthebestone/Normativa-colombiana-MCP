/**
 * comparar_articulos: el formateo de la comparación entre normas, sin red, y
 * el modo `con_reforma` con `deps` inyectables (fixtures del texto del Gestor).
 * La última prueba es de red y se salta con SIN_RED=1.
 *
 *   node --test test/comparar_articulos.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { escribir, formatear, formatearConReforma, formaDeLaReforma } from '../src/herramientas/comparar_articulos.ts'

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

// --- con_reforma: el artículo contra la última reforma que el portal le anota ---

const urlG = (id: string) => `https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=${id}`

type Falsa = { id: string; titulo: string; numero: string; texto: string }

/** `buscar`/`obtenerNorma` falsos que reparten las normas por número. Sin red. */
const depsDe = (normas: Falsa[]) => ({
  buscar: async (f: { numero?: string | number | undefined }): Promise<{ total: number; items: { id: string; titulo: string; resumen: string; url: string }[]; aplicados: string[] }> => {
    const n = normas.find((x) => x.numero === String(f.numero))
    return n
      ? { total: 1, items: [{ id: n.id, titulo: n.titulo, resumen: '', url: urlG(n.id) }], aplicados: [] }
      : { total: 0, items: [], aplicados: [] }
  },
  obtenerNorma: async (id: string | number) => {
    const n = normas.find((x) => x.id === String(id))!
    return { id: String(id), titulo: n.titulo, fechas: {}, temas: [], texto: n.texto, url: urlG(n.id), urlPdf: '' }
  },
})

/** El artículo 31 de la Ley 909 con su nota y el artículo 6 de la Ley 1960: reforma PARCIAL. */
const BASE_909_31 = [
  'ARTÍCULO 31. Etapas del proceso de selección o concurso. El proceso de selección comprende:',
  '',
  '4. Con los resultados de las pruebas la Comisión Nacional del Servicio Civil elaborara en estricto orden de mérito la lista de elegibles que tendrá una vigencia de dos (2) años.',
  '',
  '(Modificado por el Art. 6 de la Ley 1960 de 2019)',
].join('\n')

const MOD_1960_6 = [
  'ARTÍCULO 6. El numeral 4 del artículo 31 de la Ley 909 de 2004, quedará así:',
  '',
  '“ARTÍCULO 31. El proceso de selección comprende:',
  '',
  '1. (...)',
  '',
  '4 Con los resultados de las pruebas la Comisión Nacional del Servicio Civil elaborará en estricto orden de mérito la lista de elegibles que tendrá una vigencia de dos (2) años.',
].join('\n')

test('con_reforma: una reforma que toca solo una parte no hace diff y lo dice', async () => {
  const deps = depsDe([
    { id: '14861', titulo: 'Ley 909 de 2004', numero: '909', texto: BASE_909_31 },
    { id: '95430', titulo: 'Ley 1960 de 2019', numero: '1960', texto: MOD_1960_6 },
  ])
  const r = await escribir({ norma_a: 'Ley 909 de 2004', articulo_a: '31', con_reforma: true }, deps)
  assert.match(r, /^Alcance: consulté Gestor Normativo \(2 cita\(s\)\)/)
  assert.match(r, /Artículo 31 de «Ley 909 de 2004»/)
  assert.match(r, /Reforma más reciente anotada por el portal: MODIFICADO por Ley 1960 de 2019, artículo 6/)
  assert.match(r, /Norma modificadora: «Ley 1960 de 2019» \(https:\/\/www\.funcionpublica\.gov\.co\/eva\/gestornormativo\/norma\.php\?i=95430\)/)
  assert.match(r, /modifica solo una PARTE/)
  assert.match(r, /No se hace el diff/)
  assert.match(r, /Texto que la reforma dispone para esa parte/)
  assert.match(r, /El numeral 4 del artículo 31 de la Ley 909 de 2004, quedará así/)
  assert.match(r, /1\. \(\.\.\.\)/, 'los marcadores del portal van literales, sin limpiar')
  assert.doesNotMatch(r, /EDITORIAL/)
})

/** El artículo 64 del CST con su nota y el artículo 28 de la Ley 789: reforma COMPLETA. */
const BASE_CST_64 = [
  'ARTICULO 64. TERMINACION UNILATERAL DEL CONTRATO DE TRABAJO SIN JUSTA CAUSA. En todo contrato de trabajo va envuelta la condición resolutoria por incumplimiento de lo pactado.',
  '',
  'Treinta (30) días de salario cuando el trabajador tuviere un tiempo de servicio no mayor de un (1) año.',
  '',
  '(Modificado por el Art. 28 de la Ley 789 de 2002)',
].join('\n')

const MOD_789_28 = [
  'ARTÍCULO 28. Terminación unilateral del contrato de trabajo sin justa causa.',
  '',
  'El artículo 64 del Código Sustantivo del Trabajo, subrogado por el artículo 6° de la Ley 50 de 1990, quedara asi:',
  '',
  '"ARTÍCULO 64. Terminación unilateral del contrato de trabajo sin justa causa. En todo contrato de trabajo va envuelta la condición resolutoria por incumplimiento de lo pactado.',
  '',
  'Treinta (30) días de salario cuando el trabajador tuviere un tiempo de servicio no mayor de un (1) año.',
].join('\n')

test('con_reforma: una reforma completa contrasta la transcripción con el texto vigente', async () => {
  const deps = depsDe([
    { id: '199983', titulo: 'Decreto 2663 de 1950', numero: '2663', texto: BASE_CST_64 },
    { id: '6778', titulo: 'Ley 789 de 2002', numero: '789', texto: MOD_789_28 },
  ])
  const r = await escribir({ norma_a: 'Decreto 2663 de 1950', articulo_a: '64', con_reforma: true }, deps)
  assert.match(r, /Reforma más reciente anotada por el portal: MODIFICADO por Ley 789 de 2002, artículo 28/)
  assert.match(r, /Cómo leer esto: la página de la norma publica el texto VIGENTE/)
  assert.match(r, /El texto vigente coincide con lo que dispuso la reforma/)
  assert.match(r, /EDITORIAL/)
  assert.match(r, /i=199983/)
  assert.match(r, /i=6778/)
})

const BASE_909_2 = [
  'ARTÍCULO 2. Principios de la función pública.',
  '',
  '1. La función pública se desarrolla teniendo en cuenta los principios constitucionales de igualdad, mérito, accesibilidad universal, moralidad, eficacia.',
  '',
  '(Numeral modificado por el Art. 3 de la Ley 2418 de 2024)',
].join('\n')

/** La transcripción de la Ley 2418 sigue al anuncio con punto: con el arreglo de `abreBloqueCitado` (2026-09-28) ya se lee. */
const MOD_2418_3 = [
  'ARTÍCULO 3. Modifíquese el numeral 1 del artículo 2 de la ley 909 de 2004, el cual quedará así.',
  '',
  'ARTÍCULO 2. PRINCIPIOS DE LA FUNCIÓN PÚBLICA.',
  '',
  'La función pública se desarrolla teniendo en cuenta los principios constitucionales de igualdad, mérito, accesibilidad universal, moralidad, eficacia.',
].join('\n')

test('con_reforma: un anuncio con punto deja leer la transcripción y se declara parcial', async () => {
  const deps = depsDe([
    { id: '14861', titulo: 'Ley 909 de 2004', numero: '909', texto: BASE_909_2 },
    { id: '249256', titulo: 'Ley 2418 de 2024', numero: '2418', texto: MOD_2418_3 },
  ])
  const r = await escribir({ norma_a: 'Ley 909 de 2004', articulo_a: '2', con_reforma: true }, deps)
  assert.match(r, /Reforma más reciente anotada por el portal: MODIFICADO por Ley 2418 de 2024, artículo 3/)
  assert.match(r, /modifica solo una PARTE/)
  assert.match(r, /ARTÍCULO 2\. PRINCIPIOS DE LA FUNCIÓN PÚBLICA/)
  assert.doesNotMatch(r, /corta en el anuncio/)
  assert.match(r, /i=249256/)
})

/** La cita cruzada real de la Ley 789, con la transcripción: el extractor ya no se desvía. */
const MOD_789_CON_CITA = [
  'ARTÍCULO 3°. Régimen del subsidio familiar en dinero. Deroga el Artículo 28 de la Ley 21 de 1982.',
  '',
  'ARTÍCULO 28. Terminación unilateral del contrato de trabajo sin justa causa.',
  '',
  'El artículo 64 del Código Sustantivo del Trabajo, subrogado por el artículo 6° de la Ley 50 de 1990, quedara asi:',
  '',
  '"ARTÍCULO 64. Terminación unilateral del contrato de trabajo sin justa causa. En todo contrato de trabajo va envuelta la condición resolutoria por incumplimiento de lo pactado.',
].join('\n')

test('con_reforma: una cita cruzada antes del encabezado no desvía la extracción', async () => {
  const deps = depsDe([
    { id: '199983', titulo: 'Decreto 2663 de 1950', numero: '2663', texto: BASE_CST_64 },
    { id: '6778', titulo: 'Ley 789 de 2002', numero: '789', texto: MOD_789_CON_CITA },
  ])
  const r = await escribir({ norma_a: 'Decreto 2663 de 1950', articulo_a: '64', con_reforma: true }, deps)
  assert.match(r, /(Diferencias entre lo que dispuso la reforma|El texto vigente coincide con lo que dispuso la reforma)/)
  assert.doesNotMatch(r, /no menciona el artículo 64|subsidio familiar/)
})

/** La ley anuncia la transcripción y no la trae: no hay nada que comparar. */
const MOD_789_SIN_TEXTO = [
  'ARTÍCULO 3°. Régimen del subsidio familiar en dinero. Deroga el Artículo 28 de la Ley 21 de 1982.',
  '',
  'ARTÍCULO 28. Terminación unilateral del contrato de trabajo sin justa causa.',
  '',
  'El artículo 64 del Código Sustantivo del Trabajo quedara asi:',
].join('\n')

test('con_reforma: un anuncio sin transcripción se declara, no se compara', async () => {
  const deps = depsDe([
    { id: '199983', titulo: 'Decreto 2663 de 1950', numero: '2663', texto: BASE_CST_64 },
    { id: '6778', titulo: 'Ley 789 de 2002', numero: '789', texto: MOD_789_SIN_TEXTO },
  ])
  const r = await escribir({ norma_a: 'Decreto 2663 de 1950', articulo_a: '64', con_reforma: true }, deps)
  assert.match(r, /corta en el anuncio/)
  assert.match(r, /El diff no sería fiable/)
})

/** Tras el anuncio el portal no transcribió: sigue el artículo 29 de la propia ley modificadora. */
const MOD_SIN_TRANSCRIPCION = [
  'ARTÍCULO 28. Terminación unilateral del contrato de trabajo sin justa causa. El artículo 64 del Código Sustantivo del Trabajo, subrogado por el artículo 6° de la Ley 50 de 1990, quedara asi:',
  '',
  'ARTÍCULO 29. Vigencia. La presente ley rige a partir de su publicación.',
].join('\n')

test('con_reforma: el articulado siguiente de la modificadora no se toma por transcripción', async () => {
  const deps = depsDe([
    { id: '199983', titulo: 'Decreto 2663 de 1950', numero: '2663', texto: BASE_CST_64 },
    { id: '6778', titulo: 'Ley 789 de 2002', numero: '789', texto: MOD_SIN_TRANSCRIPCION },
  ])
  const r = await escribir({ norma_a: 'Decreto 2663 de 1950', articulo_a: '64', con_reforma: true }, deps)
  assert.match(r, /no viene la transcripción del artículo 64, sino otro articulado/)
  assert.match(r, /El diff no sería fiable/)
})

/** Un artículo que no reforma nada: no menciona el artículo base ni trae lenguaje de reforma. */
const MOD_AJENA = 'ARTÍCULO 28. Domicilio. Para todos los efectos legales se tendrá como domicilio la ciudad de Bogotá D.C.'

test('con_reforma: una extracción que no corresponde a la reforma se declara, no se compara', async () => {
  const deps = depsDe([
    { id: '199983', titulo: 'Decreto 2663 de 1950', numero: '2663', texto: BASE_CST_64 },
    { id: '6778', titulo: 'Ley 789 de 2002', numero: '789', texto: MOD_AJENA },
  ])
  const r = await escribir({ norma_a: 'Decreto 2663 de 1950', articulo_a: '64', con_reforma: true }, deps)
  assert.match(r, /no menciona el artículo 64 ni trae lenguaje de reforma/)
  assert.match(r, /El diff no sería fiable/)
})

const BASE_1437_20 = [
  'ARTÍCULO 20. Atención prioritaria de peticiones. Las autoridades darán atención prioritaria a las peticiones de reconocimiento de un derecho fundamental.',
  '',
  'NOTA: Declarado EXEQUIBLE por la Corte Constitucional, mediante Sentencia C-951 de 2014',
].join('\n')

test('con_reforma: sin reforma normativa anotada (solo control constitucional) se dice', async () => {
  const deps = depsDe([{ id: '41249', titulo: 'Ley 1437 de 2011', numero: '1437', texto: BASE_1437_20 }])
  const r = await escribir({ norma_a: 'Ley 1437 de 2011', articulo_a: '20', con_reforma: true }, deps)
  assert.match(r, /^Alcance: consulté Gestor Normativo \(1 cita\(s\)\)/)
  assert.match(r, /no anota ninguna reforma normativa sobre el artículo 20/)
  assert.match(r, /1 nota\(s\) sin artículo reformador/)
  assert.match(r, /i=41249/)
})

test('con_reforma: los parámetros que sobran no se ignoran en silencio', async () => {
  const r = await escribir({ norma_a: 'Ley 909 de 2004', articulo_a: '31', norma_b: 'Decreto 1083 de 2015', articulo_b: '12', con_reforma: true })
  assert.match(r, /sobran norma_b y articulo_b/)
})

test('sin con_reforma y sin norma_b se dice qué falta y cuál es la alternativa', async () => {
  const r = await escribir({ norma_a: 'Ley 909 de 2004', articulo_a: '31', con_reforma: false })
  assert.match(r, /hacen falta norma_b y articulo_b/)
  assert.match(r, /con_reforma=true/)
})

test('formaDeLaReforma distingue completa, parcial, los dos anuncios sin texto y la ajena', () => {
  assert.equal(formaDeLaReforma('ARTÍCULO 6. El numeral 4 del artículo 31 de la Ley 909 de 2004, quedará así:\n\n1. (...)', '31'), 'parcial')
  assert.equal(
    formaDeLaReforma('ARTÍCULO 1º. El artículo 23 del Código Sustantivo del Trabajo quedará así:\n\nArtículo 23. Elementos esenciales:', '23'),
    'completa',
  )
  assert.equal(formaDeLaReforma('ARTÍCULO 3. Modifíquese el numeral 1 del artículo 2 de la ley 909 de 2004, el cual quedará así.', '2'), 'solo-anuncio')
  assert.equal(
    formaDeLaReforma('ARTÍCULO 28. El artículo 64 del Código Sustantivo del Trabajo quedara asi:\n\nARTÍCULO 29. Vigencia.', '64'),
    'sin-transcripcion',
  )
  // El cuerpo transcrito puede mencionar sus propios numerales (el del CST 64
  // habla del «numeral 1»): la parte se lee en el enunciado, no en el cuerpo.
  assert.equal(
    formaDeLaReforma(
      'ARTÍCULO 28. Terminación unilateral del contrato de trabajo sin justa causa.\n\nEl artículo 64 del Código Sustantivo del Trabajo, subrogado por el artículo 6° de la Ley 50 de 1990, quedara asi:\n\n2. Si el trabajador tuviere más de un (1) año de servicio continuo se le pagaran veinte (20) días adicionales de salario sobre los treinta (30) basicos del numeral 1.',
      '64',
    ),
    'completa',
  )
  assert.equal(formaDeLaReforma('Artículo 28 de la Ley 21 de 1982. Tienen derecho al subsidio familiar.', '64'), 'ajeno')
  assert.equal(formaDeLaReforma(null, '64'), 'sin-articulo')
})

test('formatearConReforma: en modo completo el «de» editorial es el lado de la reforma', () => {
  const r = formatearConReforma({
    base: { titulo: 'Norma A', url: 'https://x/1', articulo: '64' },
    reforma: { titulo: 'Norma M', url: 'https://x/2', articulo: '28', accion: 'modificado', norma: 'Norma M', anio: '2002', literal: 'nota' },
    modo: 'completa',
    comparacion: { anadidos: ['indemnización de perjuicios'], eliminados: ['indemnizacion de perjuicios'] },
  })
  assert.match(r, /EDITORIAL — «indemnizacion de perjuicios» → «indemnización de perjuicios» \(sim\. 1\.00, cambio menor\)/)
  assert.match(r, /Norma M: no la encontré|Norma M/)
})

test('RED: con_reforma sobre el artículo 23 del CST encuentra la Ley 50 de 1990', { timeout: 240_000, skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }, async () => {
  const r = await escribir({ norma_a: 'Decreto 2663 de 1950', articulo_a: '23', con_reforma: true })
  assert.match(r, /Reforma más reciente anotada por el portal: SUBROGADO por Ley 50 de 1990, artículo 1/)
  assert.match(r, /norma\.php\?i=281/)
  assert.doesNotMatch(r, /corta en el anuncio|no menciona el artículo/)
})

/**
 * Los dos veredictos que cambiaron con los arreglos de parse.ts (2026-09-28):
 * el CST 64 pasó de `ajeno` a `completa` (la cita cruzada ya no desvía la
 * extracción) y la Ley 909 art. 2, de `solo-anuncio` a `parcial` (el anuncio
 * con punto ya trae su transcripción). Se comprueban contra el portal.
 */
test('RED: los dos veredictos medidos (CST 64 completa, Ley 909 art. 2 parcial)', { timeout: 240_000, skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }, async () => {
  const cst = await escribir({ norma_a: 'Decreto 2663 de 1950', articulo_a: '64', con_reforma: true })
  assert.match(cst, /Reforma más reciente anotada por el portal: MODIFICADO por Ley 789 de 2002, artículo 28/)
  assert.doesNotMatch(cst, /no menciona el artículo 64|corta en el anuncio|no viene la transcripción/)
  assert.match(cst, /(Diferencias entre lo que dispuso la reforma|El texto vigente coincide con lo que dispuso la reforma)/)

  const l909 = await escribir({ norma_a: 'Ley 909 de 2004', articulo_a: '2', con_reforma: true })
  assert.match(l909, /Reforma más reciente anotada por el portal: MODIFICADO por Ley 2418 de 2024, artículo 3/)
  assert.match(l909, /modifica solo una PARTE/)
  assert.doesNotMatch(l909, /corta en el anuncio/)
})
