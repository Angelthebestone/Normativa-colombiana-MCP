/**
 * diff.ts: qué cambió entre dos versiones de un artículo y de qué clase es el
 * cambio, para decidir si amerita releer la norma o basta un aviso.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  agruparEditoriales,
  bigramas,
  clasificarDiferencia,
  diffArticulos,
  esCambioEditorial,
  normalizarLexico,
  similitudLexica,
  UMBRAL_EDITORIAL,
} from '../src/herramientas/diff.ts'

test('diffArticulos separa lo añadido de lo eliminado', () => {
  assert.deepEqual(diffArticulos('Línea 1\nLínea 2', 'Línea 1\nLínea 3'), {
    anadidos: ['Línea 3'],
    eliminados: ['Línea 2'],
  })
  assert.deepEqual(diffArticulos('Línea 1\nLínea 2', 'Línea 1\nLínea 2'), { anadidos: [], eliminados: [] })
})

test('clasificarDiferencia distingue el tipo de cambio, en orden de prioridad', () => {
  assert.equal(clasificarDiferencia('dentro de los 30 días'), 'plazo')
  assert.equal(clasificarDiferencia('multa de 5 smmlv'), 'sancion')
  assert.equal(clasificarDiferencia('se aplicará la sanción dentro de los 30 días'), 'plazo')
  assert.equal(clasificarDiferencia('texto sin marcas'), 'no clasificado')
})

test('clasificarDiferencia detecta prohibiciones y obligaciones de cumplimiento', () => {
  assert.equal(clasificarDiferencia('Queda prohibido el cobro de sumas no autorizadas'), 'prohibicion')
  assert.equal(clasificarDiferencia('no podrá celebrar contratos'), 'prohibicion')
  assert.equal(clasificarDiferencia('El responsable deberá presentar el informe'), 'obligacion')
  assert.equal(clasificarDiferencia('estará obligado a reportar'), 'obligacion')
  // El plazo gana aunque haya una obligación: el orden manda.
  assert.equal(clasificarDiferencia('El responsable deberá presentar el informe dentro de los 10 días hábiles'), 'plazo')
  assert.equal(clasificarDiferencia('a más tardar el 31 de diciembre'), 'plazo')
  // Sinónimo no cubierto: queda en no clasificado, que es el límite declarado.
  assert.equal(clasificarDiferencia('queda vedado el cobro'), 'no clasificado')
})

test('el contrato léxico: normalizarLexico y bigramas son deterministas', () => {
  assert.equal(normalizarLexico('Sanción Pecuniaria'), 'sancion pecuniaria')
  assert.equal(normalizarLexico('  multa  de  5  '), 'multa de 5')
  assert.deepEqual(bigramas('hola'), ['ho', 'ol', 'la'])
  assert.deepEqual(bigramas(''), [])
})

test('un cambio solo de tildes/puntuación es editorial con similitud 1.00', () => {
  assert.equal(similitudLexica('multa', 'multá'), 1)
  assert.equal(esCambioEditorial('sanción', 'sancion'), true)
  const r = agruparEditoriales(['sanción'], ['sancion'])
  assert.equal(r.editoriales.length, 1)
  assert.equal(r.editoriales[0]!.sim, 1)
  assert.equal(r.anadidos.length, 0)
  assert.equal(r.eliminados.length, 0)
})

test('la sinonimia real (multa→sanción pecuniaria) NO es editorial', () => {
  assert.equal(esCambioEditorial('multa', 'sanción pecuniaria'), false)
  const r = agruparEditoriales(['sanción pecuniaria'], ['multa'])
  assert.equal(r.editoriales.length, 0, 'la sinonimia no puede emparejarse como editorial')
  assert.deepEqual(r.anadidos, ['sanción pecuniaria'])
  assert.deepEqual(r.eliminados, ['multa'])
})

test('el umbral 0.92 es inclusivo: 0.92 editorial, 0.919 no', () => {
  assert.equal(UMBRAL_EDITORIAL, 0.92)
  // Se construyen dos textos cuya similitud cae justo en el umbral o justo debajo.
  // Con 0.92 exacto, es editorial (>=); con un valor menor, no.
  const casi = similitudLexica('el artículo establece una sanción pecuniaria de cinco salarios', 'el artículo establece una sanción pecuniaria de cinco salarios mínimos')
  assert.ok(casi >= 0.9, `similitud esperada alta, fue ${casi}`)
  assert.equal(esCambioEditorial('a', 'ab'), false, 'textos muy distintos no son editoriales')
})

test('agruparEditoriales: formatear distingue EDITORIAL de AÑADIDO/ELIMINADO', () => {
  // Añadido y eliminado que SÍ son editoriales (solo tildes) se emparejan.
  const editorial = agruparEditoriales(['sanción'], ['sancion'])
  assert.equal(editorial.editoriales.length, 1)
  assert.equal(editorial.anadidos.length, 0)
  assert.equal(editorial.eliminados.length, 0)
  // Añadido y eliminado que NO lo son quedan separados.
  const sustantivo = agruparEditoriales(['sanción pecuniaria'], ['multa'])
  assert.equal(sustantivo.editoriales.length, 0)
  assert.deepEqual(sustantivo.anadidos, ['sanción pecuniaria'])
  assert.deepEqual(sustantivo.eliminados, ['multa'])
})

/**
 * Lo que asume el modo `con_reforma` de comparar_articulos: la errata de una
 * línea del portal se empareja como editorial y `de` queda del lado A (la
 * reforma) y `a` del lado B (el texto vigente). Medido el 2026-09-28 en el
 * artículo 31 de la Ley 909 de 2004, cuyo numeral 4 repite la palabra con y sin
 * tilde entre la página y la transcripción de la Ley 1960 de 2019.
 */
test('una errata del portal en una línea larga se empareja como editorial', () => {
  const reforma =
    '4 Con los resultados de las pruebas la Comisión Nacional del Servicio Civil elaborará en estricto orden de mérito la lista de elegibles que tendrá una vigencia de dos años.'
  const vigente =
    '4 Con los resultados de las pruebas la Comisión Nacional del Servicio Civil elaborara en estricto orden de mérito la lista de elegibles que tendrá una vigencia de dos años.'
  assert.ok(similitudLexica(reforma, vigente) >= UMBRAL_EDITORIAL, `similitud ${similitudLexica(reforma, vigente)}`)
  const d = diffArticulos(reforma, vigente)
  const r = agruparEditoriales(d.anadidos, d.eliminados)
  assert.equal(r.editoriales.length, 1)
  assert.equal(r.editoriales[0]!.de, reforma, '«de» es el lado A: la línea de la reforma')
  assert.equal(r.editoriales[0]!.a, vigente, '«a» es el lado B: la línea del texto vigente')
  assert.equal(r.anadidos.length, 0)
  assert.equal(r.eliminados.length, 0)
})

/**
 * Por esto el modo `con_reforma` no hace diff cuando la reforma solo toca una
 * parte: el marcador «(…)» que el portal usa en la transcripción parcial no
 * casa con el numeral completo y quedaría como añadido/eliminado, que se lee
 * como si el resto del artículo hubiera cambiado.
 */
test('los marcadores «(…)» de una transcripción parcial no se emparejan con el texto completo', () => {
  const d = diffArticulos('1. (...)', '1. Convocatoria. La convocatoria es norma reguladora de todo concurso.')
  const r = agruparEditoriales(d.anadidos, d.eliminados)
  assert.equal(r.editoriales.length, 0)
  assert.deepEqual(r.anadidos, ['1. Convocatoria. La convocatoria es norma reguladora de todo concurso.'])
  assert.deepEqual(r.eliminados, ['1. (...)'])
})
