/**
 * Adaptador SIC contra la sede electrónica: marcado real de las tarjetas
 * `.normas--row` (tipo, título, enlace, descripción) y extracción de número,
 * año y fecha desde el texto. Sin red: fixtures del HTML de la sede.
 *
 *   node --test test/sic-sede.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import type * as sectorial from '../src/fuentes/sectorial.ts'
import { _interno } from '../src/fuentes/sectorial/sic.ts'
import { escribir } from '../src/herramientas/buscar_normativa_sectorial.ts'

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

/** Una tarjeta con la etiqueta, el título y el epígrafe dados (la etiqueta puede ir vacía). */
const tarjeta = (etiqueta: string, titulo: string, epigrafe: string) => `<div class="normas--row shadow-sm p-3 mb-5 bg-body rounded">
<div class="row"><div class="col-md-5"><span class="text-secondary">Tipo de norma: <strong>${etiqueta}</strong></span></div></div>
<h2 class="field__label"><a href="/transparencia/normativa/x" hreflang="es">${titulo}</a></h2>
<div class="col-md-12"><p> ${epigrafe} </p></div>
</div>`

test('la etiqueta compuesta «Resoluciones, Nombramientos» se excluye', () => {
  assert.equal(_interno.extraer(`<div>${NOMBRAMIENTO}</div>`).length, 0)
})

test('un proyecto sin etiqueta se excluye por su epígrafe «Proyecto de …»', () => {
  const html = tarjeta('  ', 'Proyecto de Resolución 2026', 'Proyecto de Resolución por la cual se modifica la Circular Única.')
  assert.equal(_interno.extraer(`<div>${html}</div>`).length, 0)
})

test('las etiquetas «Proyectos de resolución/circulares» y las tablas de retención se excluyen', () => {
  for (const etiqueta of ['Proyectos de resolución', 'Proyectos de circulares', 'Tablas de Retención Documental']) {
    assert.equal(_interno.extraer(`<div>${tarjeta(etiqueta, 'Algo No. 1 de 2026', 'Algo.')}</div>`).length, 0, etiqueta)
  }
})

test('una resolución de carácter general sin esas marcas se conserva', () => {
  const html = tarjeta('Resoluciones  ', 'Resolución No. 12345 de 2026', 'Por la cual se imparten instrucciones.')
  const items = _interno.extraer(`<div>${html}</div>`)
  assert.equal(items.length, 1)
  assert.equal(items[0]!.tipo, 'Resoluciones')
  assert.equal(items[0]!.numero, '12345')
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

// --- filas sin número: ni hueco ni «repetidas» falsas (D14) ---

const acto = (tipo: string, numero: string, anio: string, epigrafe: string, fecha = '') => ({
  tipo,
  numero,
  anio,
  fecha,
  epigrafe,
  url: `https://sic.test/${encodeURIComponent(epigrafe)}`,
})

/** El regulador de mentira: devuelve los actos dados, sin salir a ninguna red. */
const regulador = (...items: ReturnType<typeof acto>[]) => ({
  adaptador: (() => ({
    id: 'sic',
    nombre: 'SIC',
    sector: 'consumo',
    portal: 'https://sic.test',
    advertencia: 'No cubre lo que no esté en su repositorio.',
    buscar: async () => ({ items, url: 'https://sic.test/q' }),
  })) as unknown as typeof sectorial.adaptador,
})

const params = { entidad: 'sic', pagina: 1, limite: 15 }

test('dos filas sin número y con epígrafes distintos no son «repetidas» ni se imprimen con hueco', async () => {
  const s = await escribir(
    params,
    regulador(
      acto('Norma', '', '2026', 'Lineamientos para la delegación de funciones'),
      acto('Norma', '', '2025', 'Guía de buenas prácticas de protección de datos'),
    ),
  )
  assert.doesNotMatch(s, /repite en esta misma página/)
  assert.doesNotMatch(s, /norma {2}de|Norma {2}de/i)
  assert.match(s, /- Norma \(2026\)\n {2}Lineamientos/)
  assert.match(s, /- Norma \(2025\)\n {2}Guía/)
})

test('una fila sin número con fecha se rotula por su tipo y su fecha, sin el «de» huérfano', async () => {
  const s = await escribir(params, regulador(acto('Circular', '', '2026', 'Instrucciones generales', '2026-01-15')))
  assert.match(s, /- Circular \(2026-01-15\)\n/)
  assert.doesNotMatch(s, / de \n/)
})

test('la Ley 1333 de 2009 repetida por el portal conserva el aviso', async () => {
  const s = await escribir(
    params,
    regulador(
      acto('Ley', '1333', '2009', 'Procedimiento sancionatorio ambiental', '2009-07-21'),
      acto('Ley', '1333', '2009', 'Procedimiento sancionatorio ambiental (otra copia)', '2009-07-22'),
    ),
  )
  assert.match(s, /repite en esta misma página una entrada \(ley 1333 de 2009\)/)
  assert.match(s, /- Ley 1333 de 2009 \(2009-07-21\)/)
})
