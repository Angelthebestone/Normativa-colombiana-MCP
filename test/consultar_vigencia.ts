/**
 * `consultar_vigencia`: el veredicto de vigencia con nivel de confianza. El
 * formateador se prueba sin red; los caminos de red se dejan marcados con skip.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { formatear } from '../src/herramientas/consultar_vigencia.ts'

test('formatear: estado de confianza alta con URL y explicación', () => {
  const s = formatear({
    cita: 'Decreto 1072 de 2015',
    estado: 'Vigente',
    confianza: 'alta',
    url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1',
    explicacion: 'Ficha SUIN-Juriscol (índice del 2026-08-01).',
  })
  assert.match(s, /Vigencia de Decreto 1072 de 2015/)
  assert.match(s, /Estado: Vigente/)
  assert.match(s, /Confianza: alta/)
  assert.match(s, /URL: https:\/\//)
})

test('formatear: confianza media avisa de las contradicciones del índice', () => {
  const s = formatear({
    cita: 'Ley 74 de 1923',
    estado: 'Vigencia en Estudio',
    confianza: 'media',
    url: 'https://x.gov.co',
    explicacion: 'Señal del índice de búsqueda de SUIN. OJO: este índice a veces contradice la ficha.',
  })
  assert.match(s, /Confianza: media/)
  assert.match(s, /contradice la ficha/)
})

test('formatear: confianza baja de no consta no afirma nada', () => {
  const s = formatear({
    cita: 'Ley 99999999 de 1800',
    estado: 'no consta',
    confianza: 'baja',
    explicacion: 'Ni el Gestor ni el índice de SUIN tienen esta norma.',
  })
  assert.match(s, /Confianza: baja/)
  assert.match(s, /no consta/)
})
