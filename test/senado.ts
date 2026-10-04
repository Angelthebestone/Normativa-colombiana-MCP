/**
 * El articulado del Código Civil desde la Secretaría del Senado: mapa del
 * `<select>` del índice («artículo → parte»), extracción de un artículo entre
 * anclas y conservación de los apartes tachados en `~~`.
 *
 * Sin red: fixtures REALES recortados de `codigo_civil.html` y de
 * `codigo_civil_pr001.html` (ver la cabecera de cada fixture para saber de dónde
 * sale cada tramo). El caso que consulta el portal (946 y 2341) se salta con
 * SIN_RED=1.
 *
 *   node --test test/senado.ts
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { _interno, articulo, BASE_SENADO } from '../src/fuentes/senado.ts'

const fixture = (f: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/senado/${f}`, import.meta.url)), 'utf8')
const indice = fixture('indice-mini.html')
const parte = fixture('parte-mini.html')

/** Extrae un artículo o falla: deja el tipo estrecho para el resto del caso. */
function extraer(html: string, numero: string) {
  const r = _interno.extraerArticulo(html, numero)
  assert.ok(r, `falta el ancla del artículo ${numero} en el fixture`)
  return r
}

const RED = { timeout: 120_000, skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }

test('el <select> del índice mapea artículo → parte; el 1–32 vive en el propio índice', () => {
  const m = _interno.parsearIndice(indice, 'codigo_civil')
  assert.equal(m.get('1'), 'codigo_civil.html')
  assert.equal(m.get('2'), 'codigo_civil.html')
  assert.equal(m.get('33'), 'codigo_civil_pr001.html')
  assert.equal(m.get('40'), 'codigo_civil_pr001.html')
  assert.equal(m.get('946'), 'codigo_civil_pr029.html')
  assert.equal(m.get('2341'), 'codigo_civil_pr072.html')
  assert.equal(m.get('2684'), 'codigo_civil_pr083.html')
})

test('un artículo que el <select> omite se ubica por su vecino, no como inexistente', () => {
  const m = _interno.parsearIndice(indice, 'codigo_civil')
  // El portal omite 14 artículos del <select> (medido el 2026-09-28); el 35 y el
  // 28 están entre ellos aunque su texto sí se publica.
  assert.equal(m.get('35'), undefined)
  assert.equal(_interno.parteDe(m, '35'), 'codigo_civil_pr001.html')
  assert.equal(m.get('28'), undefined)
  assert.equal(_interno.parteDe(m, '28'), 'codigo_civil.html')
})

test('el texto sale limpio, con el título, y los tachados en ~~', () => {
  const r = extraer(parte, '33')
  assert.ok(r.texto.startsWith('ARTÍCULO 33. <PALABRAS RELACIONADAS CON LAS PERSONAS>.'), r.texto.slice(0, 80))
  assert.equal(r.tachados, true)
  assert.match(r.texto, /~~hombre,~~/)
  // Nada de navegación, flechas ni cajas de notas (que además son de copia prohibida).
  assert.doesNotMatch(r.texto, /Anterior|Siguiente|Ir al inicio|Notas del Editor|Jurisprudencia/)
})

test('el artículo acaba en la frontera siguiente: no se lleva el de al lado', () => {
  const r = extraer(parte, '33')
  assert.doesNotMatch(r.texto, /ARTÍCULO 34/)
  assert.ok(extraer(parte, '34').texto.includes('~~varón~~'))
  assert.equal(extraer(parte, '35').tachados, false)
  assert.ok(extraer(parte, '35').texto.startsWith('ARTÍCULO 35. <PARENTESCO DE CONSANGUINIDAD>.'))
})

test('la página declara su fecha de actualización, que se devuelve sin el aviso de derechos', () => {
  const fecha = _interno.fechaDeActualizacion(indice)
  assert.match(fecha, /^15 de septiembre de 2026/)
  assert.match(fecha, /Diario Oficial No\. 53\.619 - 8 de septiembre de 2026/)
  assert.doesNotMatch(fecha, /Derechos de autor/)
})

test('sin <select>, o con un <select> vacío, el canario avisa: no es «el artículo no existe»', () => {
  assert.throws(() => _interno.parsearIndice('<html><body>sin select</body></html>', 'codigo_civil'), /ya no trae el <select>/)
  assert.throws(() => _interno.parsearIndice('<select></select>', 'codigo_civil'), /no trae ninguna opción/)
})

test('un número sin ancla devuelve null (el módulo decide entonces no-existe)', () => {
  assert.equal(_interno.extraerArticulo(parte, '9999'), null)
})

test('el 946 y el 2341 llegan de la fuente real', RED, async () => {
  const a = await articulo('codigo_civil', '946')
  const b = await articulo('codigo_civil', '2341')
  assert.equal(a.ok, true, a.ok ? '' : a.detalle)
  assert.equal(b.ok, true, b.ok ? '' : b.detalle)
  if (a.ok) {
    assert.ok(a.texto.startsWith('ARTÍCULO 946.'))
    assert.match(
      a.texto,
      /La reivindicación o acción de dominio es la que tiene el dueño de una cosa singular, de que no está en posesión, para que el poseedor de ella sea condenado a restituirla\./,
    )
    assert.equal(a.url, `${BASE_SENADO}/codigo_civil_pr029.html#946`)
    assert.equal(a.tachados, false)
    // La fecha la cambia el portal con cada actualización: se comprueba que se lea, no cuál es.
    assert.match(a.actualizacion, /^\d{1,2} de [a-z]+ de \d{4}/)
  }
  if (b.ok) {
    assert.ok(b.texto.startsWith('ARTÍCULO 2341.'))
    assert.match(b.texto, /El que ha cometido un delito o culpa, que ha inferido daño a otro, es obligado a la indemnización/)
    assert.equal(b.url, `${BASE_SENADO}/codigo_civil_pr072.html#2341`)
  }
})

test('un artículo inexistente se declara no-existe (no formato ni canario)', RED, async () => {
  const r = await articulo('codigo_civil', '9999')
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.razon, 'no-existe')
    assert.match(r.detalle, /9999/)
  }
})
