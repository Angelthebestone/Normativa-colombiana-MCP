/**
 * PDF-texto sectorial: validación de dominio, detección de escaneo y
 * extracción. Se prueba con `pedirBytes`/`extraer` inyectados (sin red ni
 * TLS), controlando qué bytes devuelve la descarga y qué texto el extractor.
 *
 *   node --test test/pdf-texto.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { textoDePdfSectorial } from '../src/fuentes/sectorial/pdf.ts'
import type { Adaptador } from '../src/fuentes/sectorial.ts'

const adaptador: Adaptador = {
  id: 'prueba',
  nombre: 'Entidad de prueba',
  sector: 'prueba',
  portal: 'https://prueba.gov.co',
  dominioPermitido: 'https://prueba.gov.co',
  tiposDocumento: ['Resolución'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'prueba',
  advertencia: 'Prueba',
  buscar: async () => ({ items: [], url: 'https://prueba.gov.co' }),
}

/** Bytes de un PDF "textual" (con fuente incrustada). */
const PDF_TEXTO = Buffer.from('%PDF-1.4\n/FontFile2 12 0 R\n1 0 obj\nstream\n(Hola)\nendstream\nendobj\n%%EOF', 'latin1')
/** Bytes de un PDF "escaneado" (DCTDecode sin fuentes). */
const PDF_ESCANEO = Buffer.from('%PDF-1.4\n/Filter /DCTDecode\n1 0 obj\nstream\n\x00\nendstream\nendobj\n%%EOF', 'latin1')

test('un dominio no permitido se rechaza antes de descargar', async () => {
  await assert.rejects(
    () => textoDePdfSectorial(adaptador, 'https://otro.gov.co/acto.pdf'),
    /dominio permitido/,
  )
})

test('un PDF escaneado devuelve escaneo, no texto inventado', async () => {
  const r = await textoDePdfSectorial(adaptador, 'https://prueba.gov.co/escaneo.pdf', {
    pedirBytes: async () => ({ status: 200, datos: PDF_ESCANEO, contentType: 'application/pdf' }),
  })
  assert.ok('escaneo' in r && r.escaneo === true)
})

test('un PDF textual extrae su texto', async () => {
  const r = await textoDePdfSectorial(adaptador, 'https://prueba.gov.co/acto.pdf', {
    pedirBytes: async () => ({ status: 200, datos: PDF_TEXTO, contentType: 'application/pdf' }),
    extraer: async () => 'Hola sectorial',
  })
  assert.ok(!('escaneo' in r), 'un PDF con fuente incrustada no es escaneo')
  if ('texto' in r) assert.match(r.texto, /Hola sectorial/)
})

test('una descarga fallida lanza, no devuelve vacío', async () => {
  await assert.rejects(
    () =>
      textoDePdfSectorial(adaptador, 'https://prueba.gov.co/roto.pdf', {
        pedirBytes: async () => ({ status: 500, datos: Buffer.from(''), contentType: 'application/pdf' }),
      }),
    /500/,
  )
})

test('un extractor que devuelve vacío se trata como escaneo', async () => {
  const r = await textoDePdfSectorial(adaptador, 'https://prueba.gov.co/vacio.pdf', {
    pedirBytes: async () => ({ status: 200, datos: PDF_TEXTO, contentType: 'application/pdf' }),
    extraer: async () => '',
  })
  assert.ok('escaneo' in r && r.escaneo === true, 'sin texto extraído no hay nada que devolver')
})
