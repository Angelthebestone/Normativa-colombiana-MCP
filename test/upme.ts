/**
 * Pruebas del fallback de la UPME al buscador del portal (SearchWP) cuando el
 * REST de WordPress devuelve 0: parser de tarjetas `.bj-tarjeta` y la caída
 * declarada al `?q=`. Deterministas, sin red.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { buscar, parsearPortal } from '../src/fuentes/upme.ts'

const fixture = readFileSync(fileURLToPath(new URL('./fixtures/upme-portal.html', import.meta.url)), 'utf8')

test('parsearPortal extrae las tarjetas del portal (título, número, año, url) y filtra actos de personal', () => {
  const items = parsearPortal(fixture)
  assert.equal(items.length, 2, 'el acto de personal debe filtrarse')
  const r692 = items.find((d) => d.titulo.includes('Resolución 692'))
  assert.ok(r692)
  assert.equal(r692!.numero, '692')
  assert.equal(r692!.anio, '2025')
  assert.equal(r692!.url, 'https://docs.upme.gov.co/pdf/resolucion_692_2025.pdf')
  assert.ok(r692!.epigrafe.includes('vehículos eléctricos'), r692!.epigrafe)
  const circ = items.find((d) => d.titulo.includes('Circular'))
  assert.ok(circ)
  assert.equal(circ!.numero, '20241100000904')
})

test('buscar cae al portal cuando el REST devuelve 0 y marca procedencia', async () => {
  const r = await buscar({ texto: 'vehículos eléctricos' }, {
    pedirPortal: async () => ({ status: 200, cuerpo: fixture }),
  })
  assert.equal(r.procedencia, 'portal')
  assert.ok(r.items.length >= 2, 'el portal debe devolver las tarjetas')
  assert.ok(r.items.every((d) => d.url.startsWith('https://docs.upme.gov.co/')), 'enlaces del portal')
})

test('buscar con REST vacío y portal no parseable degrada sin romper el camino REST', async () => {
  const r = await buscar({ texto: 'algo' }, {
    pedirPortal: async () => ({ status: 200, cuerpo: '<html><body>sin tarjetas</body></html>' }),
  })
  assert.equal(r.procedencia, 'portal')
  assert.equal(r.items.length, 0)
  assert.equal(r.total, 0)
})
