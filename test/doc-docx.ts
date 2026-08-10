/**
 * Word sectorial: validación de dominio, detección por contenido (ZIP `.docx`
 * vs OLE2 `.doc`) y extracción de `word/document.xml`. El `.docx` se genera EN
 * MEMORIA en el test (ZIP mínimo con `node:zlib`), y `pedirBytes`/`
 * descomprimirZip` se inyectan para que nada toque la red.
 *
 *   node --test test/doc-docx.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'

import { extraerTextoWord } from '../src/fuentes/sectorial/word.ts'
import { fragmentos, trocear } from '../src/nucleo/parse.ts'
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

// --- ZIP mínimo para el fixture `.docx` -----------------------------------

/** Cabecera local más los datos de la entrada, con los tamaños ya puestos (sin data descriptor). */
function cabeceraLocal(nombre: string, datos: Buffer): Buffer {
  const b = Buffer.alloc(30 + nombre.length + datos.length)
  b.writeUInt32LE(0x04034b50, 0) // firma local
  b.writeUInt16LE(20, 4) // versión mínima (2.0: deflate)
  b.writeUInt16LE(0x0800, 6) // flags: UTF-8 en los nombres
  b.writeUInt16LE(8, 8) // método: deflate
  b.writeUInt32LE(datos.length, 18) // tamaño comprimido
  b.writeUInt32LE(datos.length, 22) // tamaño sin comprimir
  b.writeUInt16LE(nombre.length, 26)
  b.write(nombre, 30)
  datos.copy(b, 30 + nombre.length)
  return b
}

/** Entrada del directorio central; el CRC no se comprueba al leer, se deja en cero. */
function entradaCentral(nombre: string, datos: Buffer, offLocal: number): Buffer {
  const b = Buffer.alloc(46 + nombre.length)
  b.writeUInt32LE(0x02014b50, 0) // firma del directorio central
  b.writeUInt16LE(20, 4) // versión que creó (2.0)
  b.writeUInt16LE(20, 6) // versión mínima
  b.writeUInt16LE(0x0800, 8) // flags: UTF-8 en los nombres
  b.writeUInt16LE(8, 10) // método: deflate
  b.writeUInt32LE(datos.length, 20) // tamaño comprimido
  b.writeUInt32LE(datos.length, 24) // tamaño sin comprimir
  b.writeUInt16LE(nombre.length, 28)
  b.writeUInt32LE(offLocal, 42) // offset de la cabecera local
  b.write(nombre, 46)
  return b
}

const zipCon = (entradas: { nombre: string; datos: Buffer }[]): Buffer => {
  let p = 0
  const locales: Buffer[] = []
  for (const { nombre, datos } of entradas) {
    locales.push(cabeceraLocal(nombre, datos))
    p += 30 + nombre.length + datos.length
  }
  const centrales: Buffer[] = []
  let offCentral = p
  let offLocal = 0 // el directorio central apunta a cada cabecera LOCAL, no a sí mismo
  for (const { nombre, datos } of entradas) {
    centrales.push(entradaCentral(nombre, datos, offLocal))
    offLocal += 30 + nombre.length + datos.length
    offCentral += 46 + nombre.length
  }
  const tamCentral = centrales.reduce((t, b) => t + b.length, 0)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0) // firma del fin de directorio central
  fin.writeUInt16LE(entradas.length, 8)
  fin.writeUInt16LE(entradas.length, 10)
  fin.writeUInt32LE(tamCentral, 12)
  fin.writeUInt32LE(p, 16)
  return Buffer.concat([...locales, ...centrales, fin])
}

const DOCX = (xml: string): Buffer =>
  zipCon([{ nombre: 'word/document.xml', datos: deflateRawSync(Buffer.from(xml, 'utf-8')) }])

const XML_EJEMPLO =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:body><w:p><w:r><w:t>RESOLUCIÓN 012 de 2026</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>por la cual se expide el reglamento.</w:t></w:r></w:p></w:body></w:document>'

const DOCX_BYTES = DOCX(XML_EJEMPLO)
/** Bytes de un `.doc` binario: la firma OLE2 basta para detectarlo. */
const DOC_BYTES = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)])

test('un dominio no permitido se rechaza antes de descargar', async () => {
  await assert.rejects(
    () => extraerTextoWord(adaptador, 'https://otro.gov.co/acto.docx'),
    /dominio permitido/,
  )
})

test('un .docx extrae el texto de word/document.xml', async () => {
  const r = await extraerTextoWord(adaptador, 'https://prueba.gov.co/acto.docx', {
    pedirBytes: async () => ({ status: 200, datos: DOCX_BYTES, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  })
  assert.ok(!('sinTexto' in r), 'un ZIP con word/document.xml no es sinTexto')
  if ('texto' in r) {
    assert.equal(r.texto, 'RESOLUCIÓN 012 de 2026\npor la cual se expide el reglamento.')
  }
})

test('un .doc binario (OLE2) devuelve sinTexto, no texto inventado', async () => {
  const r = await extraerTextoWord(adaptador, 'https://prueba.gov.co/acto.doc', {
    pedirBytes: async () => ({ status: 200, datos: DOC_BYTES, contentType: 'application/msword' }),
  })
  assert.ok('sinTexto' in r && r.sinTexto === true)
})

test('un documento que no es Word reconocible lanza, no devuelve vacío', async () => {
  await assert.rejects(
    () =>
      extraerTextoWord(adaptador, 'https://prueba.gov.co/acto.bin', {
        pedirBytes: async () => ({ status: 200, datos: Buffer.from('no soy un word'), contentType: 'application/octet-stream' }),
      }),
    /no es un .docx/,
  )
})

test('una descarga fallida lanza con el estado', async () => {
  await assert.rejects(
    () =>
      extraerTextoWord(adaptador, 'https://prueba.gov.co/roto.docx', {
        pedirBytes: async () => ({ status: 500, datos: Buffer.from(''), contentType: 'application/msword' }),
      }),
    /500/,
  )
})

test('un ZIP sin word/document.xml se trata como sinTexto', async () => {
  const zipVacio = zipCon([{ nombre: 'readme.txt', datos: Buffer.from('hola') }])
  const r = await extraerTextoWord(adaptador, 'https://prueba.gov.co/vacio.docx', {
    pedirBytes: async () => ({ status: 200, datos: zipVacio, contentType: 'application/msword' }),
  })
  assert.ok('sinTexto' in r && r.sinTexto === true)
})

test('un ZIP con document.xml vacío se trata como sinTexto', async () => {
  const r = await extraerTextoWord(adaptador, 'https://prueba.gov.co/vacio.docx', {
    pedirBytes: async () => ({ status: 200, datos: DOCX(''), contentType: 'application/msword' }),
  })
  assert.ok('sinTexto' in r && r.sinTexto === true)
})

test('descomprimirZip inyectado se usa en lugar del lector ZIP interno', async () => {
  let usado = false
  const r = await extraerTextoWord(adaptador, 'https://prueba.gov.co/acto.docx', {
    pedirBytes: async () => ({ status: 200, datos: DOCX_BYTES, contentType: 'application/msword' }),
    descomprimirZip: async (bytes) => {
      usado = true
      assert.ok(bytes instanceof Uint8Array)
      return new TextEncoder().encode(
        '<w:document><w:body><w:p><w:r><w:t>Texto del zip inyectado</w:t></w:r></w:p></w:body></w:document>',
      )
    },
  })
  assert.ok(usado, 'el descomprimidor inyectado tiene que ganar al interno')
  assert.ok(!('sinTexto' in r) && 'texto' in r)
  if ('texto' in r) assert.equal(r.texto, 'Texto del zip inyectado')
})

test('el texto devuelto respeta trocear y fragmentos (desde, limite, pasajes)', async () => {
  const r = await extraerTextoWord(adaptador, 'https://prueba.gov.co/acto.docx', {
    pedirBytes: async () => ({ status: 200, datos: DOCX_BYTES, contentType: 'application/msword' }),
  })
  assert.ok('texto' in r)
  if ('texto' in r) {
    const t = trocear(r.texto, 0, 20)
    assert.equal(t.texto, r.texto.slice(0, 20))
    assert.equal(t.total, r.texto.length)
    assert.equal(t.omitido, r.texto.length - 20)

    const f = fragmentos(r.texto, 'reglamento')
    assert.ok(f.total >= 1)
    assert.ok(f.mostrados >= 1)
    assert.ok(f.trozos.some((z) => z.includes('reglamento')))
  }
})
