/**
 * `historial_norma`: la cadena de reformas se estructura desde las notas del
 * Gestor con `historial()` (tres formas: pasiva, activa entre paréntesis,
 * control constitucional). El formateador se prueba sin red con fixtures.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { historial } from '../src/nucleo/parse.ts'
import { formatearHistorial } from '../src/herramientas/historial_norma.ts'

const CON_REFORMAS = `ARTÍCULO 6. <p>El Gobierno reglamentará la materia.</p>
(Modificado por el art. 1 Decreto 666 de 2017)
(Adiciona Art 54 numerales 13, 14, 15 de la Ley 2466 de 2025)
NOTA: Declarada inhibida por ineptitud sustantiva de la demanda (Numeral 1.) Sentencia de la Corte Constitucional C-351 de 2013`

test('historial() estructura las tres formas de nota (pasiva, activa, control)', () => {
  const cambios = historial(CON_REFORMAS)
  assert.ok(cambios.length >= 3, `se esperaban ≥3 cambios, llegaron ${cambios.length}`)
  const pasiva = cambios.find((c) => c.accion === 'modificado')
  assert.ok(pasiva)
  assert.equal(pasiva!.norma, 'Decreto 666')
  assert.equal(pasiva!.anio, '2017')
  assert.equal(pasiva!.articulo, '1')
  const activa = cambios.find((c) => c.accion === 'adicionado')
  assert.ok(activa)
  assert.equal(activa!.norma, 'Ley 2466')
  assert.equal(activa!.anio, '2025')
  assert.equal(activa!.articulo, '54')
})

test('formatearHistorial devuelve la cadena navegable con la nota literal', () => {
  const s = formatearHistorial(historial(CON_REFORMAS), 'Ley 1221 de 2008', 'https://x.gov.co/norma.php?i=1')
  assert.match(s, /MODIFICADO por Decreto 666 de 2017, artículo 1/)
  assert.match(s, /ADICIONADO por Ley 2466 de 2025/)
  assert.match(s, /Nota literal: «/)
  assert.match(s, /ni se deduce cuál rige hoy/)
  assert.match(s, /resolver_cita/)
})

test('norma sin reformas avisa sin afirmar que está intacta', () => {
  const s = formatearHistorial([], 'Ley X de 2000', 'https://x.gov.co/n')
  assert.match(s, /no anota reformas/)
  assert.match(s, /NO equivale a que esté intacta/)
})

test('el tope se pagina con desde/limite y se declara lo que queda', () => {
  const cambios = Array.from({ length: 25 }, (_, i) => ({
    accion: 'modificado',
    norma: `Ley ${i}`,
    anio: '2000',
    articulo: '',
    literal: `nota ${i}`,
  }))
  const s = formatearHistorial(cambios, 'N', 'https://x.gov.co/n')
  assert.match(s, /25 cambio\(s\) anotado\(s\).*se muestran 1–20/s)
  assert.match(s, /Quedan 5: repite con desde=20/)
  const s2 = formatearHistorial(cambios, 'N', 'https://x.gov.co/n', { desde: 20 })
  assert.match(s2, /se muestran 21–25/)
  assert.doesNotMatch(s2, /Quedan/)
  const s3 = formatearHistorial(cambios, 'N', 'https://x.gov.co/n', { desde: 99 })
  assert.match(s3, /Pide un "desde" menor/)
})

test('el filtro por articulo solo trae los cambios de ese artículo', () => {
  const cambios = historial(CON_REFORMAS)
  const s = formatearHistorial(cambios, 'Ley 1221 de 2008', 'https://x.gov.co/norma.php?i=1', { articulo: '54' })
  assert.match(s, /sobre el artículo 54/)
  assert.match(s, /ADICIONADO por Ley 2466 de 2025/)
  assert.doesNotMatch(s, /MODIFICADO por Decreto 666/)
  const vacio = formatearHistorial(cambios, 'Ley 1221 de 2008', 'https://x.gov.co/norma.php?i=1', { articulo: '999' })
  assert.match(vacio, /ninguno sobre el artículo 999/)
  assert.match(vacio, /NO equivale a que siga intacto/)
})
