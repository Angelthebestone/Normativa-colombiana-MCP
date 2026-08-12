/**
 * Advertencia de «portal roto»: discordancia entre el número del epígrafe y el
 * del archivo enlazado. Regla conservadora: solo marca cuando hay discordancia
 * clara; un archivo genérico o una variante del mismo número no marca.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { advertenciaPortalRoto, numeroDelArchivo, numeroDelEpigrafe } from '../src/nucleo/portal-roto.ts'

test('discordancia clara devuelve advertencia', () => {
  const aviso = advertenciaPortalRoto('Ley 2021 de 2021', 'https://www.mintrabajo.gov.co/documents/d/guest/ley-2101-2021.pdf')
  assert.ok(aviso)
  assert.match(aviso!, /2021/)
  assert.match(aviso!, /2101/)
  assert.match(aviso!, /Verifica antes de citar/)
})

test('concordancia no marca', () => {
  assert.equal(advertenciaPortalRoto('Resolución 1234 de 2020', 'https://x.gov.co/resolucion-1234-2020.pdf'), null)
})

test('archivo genérico sin número no marca', () => {
  assert.equal(advertenciaPortalRoto('Ley 100 de 1993', 'https://x.gov.co/documents/documento.pdf'), null)
  assert.equal(advertenciaPortalRoto('Decreto 1072 de 2015', 'https://x.gov.co/acta'), null)
})

test('variante del mismo número (subcadena) no marca', () => {
  assert.equal(advertenciaPortalRoto('Ley 1333 de 2009', 'https://x.gov.co/ley-1333-2009.pdf'), null)
})

test('epígrafe sin número no marca', () => {
  assert.equal(advertenciaPortalRoto('Lineamientos generales', 'https://x.gov.co/resolucion-1234.pdf'), null)
})

test('numeroDelEpigrafe y numeroDelArchivo extraen lo esperado', () => {
  assert.deepEqual(numeroDelEpigrafe('Ley 2021 de 2021'), ['2021'])
  assert.deepEqual(numeroDelEpigrafe('Resolución No. 056 del 28 de abril'), ['056'])
  // El año del archivo no cuenta como número de norma: "ley-2101-2021.pdf" → solo "2101".
  assert.deepEqual(numeroDelArchivo('https://x.gov.co/documents/d/guest/ley-2101-2021.pdf'), ['2101'])
  assert.deepEqual(numeroDelArchivo('https://x.gov.co/documento.pdf'), [])
})
