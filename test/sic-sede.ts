/**
 * Adaptador SIC contra la sede electrónica: marcado real de las tarjetas
 * `.normas--row` (tipo, título, enlace, descripción) y extracción de número,
 * año y fecha desde el texto. Sin red: fixtures del HTML de la sede.
 *
 *   node --test test/sic-sede.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { _interno } from '../src/fuentes/sectorial/sic.ts'

const TARJETA = `<div class="normas--row shadow-sm p-3 mb-5 bg-body rounded">
<div class="row"><div class="col-md-5">
<span class="text-secondary">Tipo de norma: <strong>Circulares  </strong></span>
</div><div class="col-md-7">
<span class="badge tag--pin label--pin mb-2 ms-2">Protección de Datos Personales </span>
</div></div>
<h2 class="field__label"><a href="/transparencia/normativa/circular-externa-no-002-del-15-de-enero-de-2026" hreflang="es">Circular externa No. 002 del 15 de enero de 2026</a></h2>
<div class="col-md-12">
<p> Circular externa No. 002 del 15 de enero de 2026. Publicada en el Diario Oficial No. 53.368 del 15 de enero de 2026. </p>
</div>
</div>`

const NOMBRAMIENTO = `<div class="normas--row shadow-sm p-3 mb-5 bg-body rounded">
<div class="row"><div class="col-md-5">
<span class="text-secondary">Tipo de norma: <strong>Resoluciones, Nombramientos  </strong></span>
</div><div class="col-md-7"></div></div>
<h2 class="field__label"><a href="/transparencia/normativa/resolucion-no-65014-de-2026" hreflang="es">Resolución No. 65014 de 2026 - Secretario Ejecutivo</a></h2>
<div class="col-md-12"><p> De conformidad con el Capítulo I (Nombramiento y Posesión) del Decreto 1083 de 2015. </p></div>
</div>`

test('extrae tipo, título, enlace absoluto y descripción de la tarjeta', () => {
  const items = _interno.extraer(`<div class="view-content"><div>${TARJETA}</div></div>`)
  assert.equal(items.length, 1)
  assert.equal(items[0]!.tipo, 'Circulares')
  assert.ok(items[0]!.epigrafe.includes('Publicada en el Diario Oficial'))
  assert.equal(items[0]!.url, 'https://sedeelectronica.sic.gov.co/transparencia/normativa/circular-externa-no-002-del-15-de-enero-de-2026')
  assert.equal(items[0]!.numero, '002')
  assert.equal(items[0]!.anio, '2026')
  assert.equal(items[0]!.fecha, '2026-01-15')
})

test('el nombramiento se extrae (el filtro de tipos lo quita quien llama)', () => {
  const items = _interno.extraer(`<div>${NOMBRAMIENTO}</div>`)
  assert.equal(items.length, 1)
  assert.equal(items[0]!.numero, '65014')
  assert.equal(items[0]!.anio, '2026')
})

test('sin tarjetas ni aviso de vacío el canario avisa (la sede cambió el marcado)', () => {
  assert.throws(() => _interno.extraer('<html><body><div>otra cosa</div></body></html>'), /no aparecen ni las tarjetas/)
})

test('numeroYAnio lee "Resolución No. 65014 de 2026" y "Circular No. 002 del 15 de enero de 2026"', () => {
  assert.deepEqual(_interno.numeroYAnio('Resolución No. 65014 de 2026 - Secretario Ejecutivo'), { numero: '65014', anio: '2026' })
  assert.deepEqual(_interno.numeroYAnio('Circular externa No. 002 del 15 de enero de 2026'), { numero: '002', anio: '2026' })
  assert.deepEqual(_interno.numeroYAnio('Seguimiento legislativo agosto 2026'), { numero: '', anio: '2026' })
})

test('fechaDe convierte "15 de enero de 2026" a ISO', () => {
  assert.equal(_interno.fechaDe('Publicada en el Diario Oficial No. 53.368 del 15 de enero de 2026.'), '2026-01-15')
  assert.equal(_interno.fechaDe('sin fecha aquí'), '')
})
