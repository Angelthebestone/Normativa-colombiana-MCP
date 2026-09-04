/**
 * Los códigos por su nombre: "art. 191 del Código de Comercio" tiene que
 * resolver contra el Decreto 410 de 1971. Sin red.
 *
 *   node --test test/codigos.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { parsearCita } from '../src/nucleo/citas.ts'
import { CODIGOS, codigoDe, codigosAusentes, referencia } from '../src/nucleo/codigos.ts'

test('el nombre del código resuelve a su norma contenedora', () => {
  const c = parsearCita('art. 191 del Código de Comercio')
  assert.deepEqual(
    { tipo: c?.tipo, numero: c?.numero, anio: c?.anio, articulo: c?.articulo, codigo: c?.codigo },
    { tipo: 'decreto', numero: '410', anio: '1971', articulo: '191', codigo: 'Código de Comercio' },
  )
})

test('los diez códigos de la tabla se citan por su nombre, y la sigla cuando la tienen', () => {
  const casos: [string, string, string][] = [
    ['art. 946 del Código Civil', '84', '1873'],
    ['art. 24 del Código Sustantivo del Trabajo', '2663', '1950'],
    ['art. 24 del CST', '2663', '1950'],
    ['art. 42 del Código Procesal del Trabajo', '2158', '1948'],
    ['art. 83 del Código Penal', '599', '2000'],
    ['art. 8 del Código de Procedimiento Penal', '906', '2004'],
    ['art. 8 del CPP', '906', '2004'],
    ['art. 90 del Código General del Proceso', '1564', '2012'],
    ['art. 90 del CGP', '1564', '2012'],
    ['art. 164 del CPACA', '1437', '2011'],
    ['art. 42 del Código de la Infancia y la Adolescencia', '1098', '2006'],
    ['art. 771-5 del Estatuto Tributario', '624', '1989'],
  ]
  for (const [texto, numero, anio] of casos) {
    const c = parsearCita(texto)
    assert.equal(c?.numero, numero, texto)
    assert.equal(c?.anio, anio, texto)
    assert.ok(c?.codigo, `${texto} debería declarar de qué código viene`)
  }
})

test('el guion es parte del número del artículo: 771-5 no es 771', () => {
  assert.equal(parsearCita('art. 771-5 del Estatuto Tributario')?.articulo, '771-5')
})

/**
 * Con las dos referencias en el texto gana la que se cita, que es la primera:
 * el resto de la frase suele ser la nota de modificación.
 */
test('entre el código y una ley explícita gana la referencia que aparece antes', () => {
  const porCodigo = parsearCita('art. 217 del Código Civil, modificado por la Ley 1060 de 2006')
  assert.equal(porCodigo?.numero, '84')
  assert.equal(porCodigo?.articulo, '217')

  const porLey = parsearCita('art. 5 de la Ley 1060 de 2006, que modifica el Código Civil')
  assert.equal(porLey?.numero, '1060')
  assert.equal(porLey?.anio, '2006')
  assert.equal(porLey?.codigo, undefined)
})

test('una cita normal sigue sin tocarse y un texto sin cita sigue devolviendo null', () => {
  assert.equal(parsearCita('Ley 909 de 2004')?.numero, '909')
  assert.equal(parsearCita('C-337/11')?.sentencia, 'C-337/11')
  assert.equal(parsearCita('la codificación penal del país'), null)
})

test('el Código Civil se declara ausente del corpus, no inexistente', () => {
  const ausentes = codigosAusentes()
  assert.equal(ausentes.length, 1)
  assert.equal(ausentes[0]!.nombre, 'Código Civil')
  const texto = ausentes[0]!.ausente!
  assert.match(texto, /NO está en este corpus/)
  assert.match(texto, /no es que el artículo no exista/i)
})

test('codigoDe encuentra el código por tipo, número y año, y referencia lo escribe como se cita', () => {
  assert.equal(codigoDe('decreto', '410', '1971')?.nombre, 'Código de Comercio')
  assert.equal(codigoDe('ley', '84', '1873')?.nombre, 'Código Civil')
  assert.equal(codigoDe('ley', '909', '2004'), undefined)
  assert.equal(referencia(CODIGOS[1]!), 'Decreto 410 de 1971')
})
