/**
 * Red de regresión — dominio sectorial/entero/citas: casos de integración de
 * obtener_documento con fuente="sectorial" (PDF y Word troceados o aviso),
 * entero=true con ruta_destino (archivo creado y ruta+bytes devueltos),
 * ruta_destino sin entero (descarga), límites respetados y citas navegables.
 *
 * Se prueban con `deps` inyectadas (sin red ni TLS) y contra el servidor
 * compilado para el contrato del esquema.
 *
 *   npm run build && node --test test/red-v3.ts
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

import { escribir, mencionesDe } from '../src/herramientas/obtener_documento.ts'
import '../src/fuentes/sectorial/registro.ts'
import { abrirCliente, CONTRATO, type Cliente } from './red.ts'

/** Bytes de un PDF "textual" (con fuente incrustada). */
const PDF = Buffer.from('%PDF-1.4\n/FontFile2 12 0 R\n1 0 obj\nstream\n(contenido)\nendstream\nendobj\n%%EOF', 'latin1')
/** Bytes de un PDF "escaneado" (DCTDecode sin fuentes). */
const PDF_ESCANEO = Buffer.from('%PDF-1.4\n/Filter /DCTDecode\n1 0 obj\nstream\n\x00\nendstream\nendobj\n%%EOF', 'latin1')

const pdfOk = (datos = PDF) => async () => ({ status: 200, datos, contentType: 'application/pdf' })

const dir = mkdtempSync(join(tmpdir(), 'red-v3-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

// --- citas navegables (unitario del helper) -------------------------------

test('mencionesDe detecta normas y sentencias en forma canónica y sin repetir', () => {
  const s = mencionesDe(
    'El artículo remite a la Ley 100 de 1993 y al Decreto 1072 de 2015, y cita la C-337/11. La misma Ley 100 de 1993 vuelve al final.',
  )
  assert.match(s, /Ley 100 de 1993/)
  assert.match(s, /Decreto 1072 de 2015/)
  assert.match(s, /C-337\/11/)
  assert.match(s, /resuélvelas con resolver_cita/)
  // Una sola mención por cita aunque el texto la repita.
  const cuantas = (s.match(/Ley 100 de 1993/g) ?? []).length
  assert.equal(cuantas, 1)
})

test('mencionesDe no añade nada cuando no hay citas', () => {
  assert.equal(mencionesDe('Texto sin referencias a normas concretas.'), '')
})

// --- fuente sectorial ------------------------------------------------------

test('sectorial: un PDF textual se trocea y trae la advertencia de la fuente', async () => {
  const texto = 'Resolución 100 de 2026.\npor la cual se reglamenta el teletrabajo, según la Ley 100 de 1993.'
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/acto.pdf' },
    { pedirBytes: pdfOk(), extraerPdf: async () => texto },
  )
  assert.match(salida, /Fuente: Superintendencia Nacional de Salud/)
  assert.match(salida, /Qué NO cubre:/)
  assert.match(salida, /Texto total: \d+ caracteres/)
  assert.match(salida, /URL: https:\/\/normograma\.supersalud\.gov\.co/)
  assert.match(salida, /Ley 100 de 1993/)
  assert.match(salida, /Este documento menciona/)
})

test('sectorial: un PDF escaneado devuelve el aviso, no texto inventado', async () => {
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/escaneo.pdf' },
    { pedirBytes: pdfOk(PDF_ESCANEO), extraerPdf: async () => '' },
  )
  assert.match(salida, /ESCANEO/)
  assert.match(salida, /no se puede leer su contenido aquí/)
  assert.doesNotMatch(salida, /Texto total:/)
})

test('sectorial: un .docx extrae su texto y lo trocea', async () => {
  const docx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/acto.docx' },
    {
      pedirBytes: async () => ({ status: 200, datos: docx, contentType: 'application/msword' }),
      descomprimirZip: async () =>
        new TextEncoder().encode(
          '<w:document><w:body><w:p><w:r><w:t>RESOLUCIÓN 012 de 2026 que remite a la Ley 909 de 2004.</w:t></w:r></w:p></w:body></w:document>',
        ),
    },
  )
  assert.match(salida, /RESOLUCIÓN 012 de 2026/)
  assert.match(salida, /Ley 909 de 2004/)
  assert.match(salida, /Este documento menciona/)
})

test('sectorial: un .doc binario (OLE2) avisa sin texto', async () => {
  const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)])
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/acto.doc' },
    { pedirBytes: async () => ({ status: 200, datos: ole, contentType: 'application/msword' }) },
  )
  assert.match(salida, /sin texto/)
  assert.match(salida, /NO significa que no diga nada/)
})

test('sectorial: sin entidad o sin url es un error de validación', async () => {
  await assert.rejects(() => escribir({ fuente: 'sectorial' } as never), /entidad y url/)
  await assert.rejects(() => escribir({ fuente: 'sectorial', entidad: 'supersalud' } as never), /entidad y url/)
})

test('sectorial: una entidad inexistente se informa, no se rompe', async () => {
  const salida = await escribir({
    fuente: 'sectorial',
    entidad: 'noexiste',
    url: 'https://normograma.supersalud.gov.co/x.pdf',
  })
  assert.match(salida, /No hay un regulador sectorial llamado/)
})

test('sectorial: un enlace fuera del dominio permitido se rechaza', async () => {
  await assert.rejects(
    () =>
      escribir(
        { fuente: 'sectorial', entidad: 'supersalud', url: 'https://otro.gov.co/acto.pdf' },
        { pedirBytes: pdfOk() },
      ),
    /dominio permitido/,
  )
})

test('sectorial: limite_caracteres acota el trozo devuelto', async () => {
  const texto = 'x'.repeat(10_000)
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/grande.pdf', limite_caracteres: 1200 },
    { pedirBytes: pdfOk(), extraerPdf: async () => texto },
  )
  assert.match(salida, /quedan \d+ sin mostrar|se muestran \d+ desde/)
  assert.ok(salida.length < 5000, `devolvió ${salida.length} caracteres`)
})

// --- entero=true -----------------------------------------------------------

test('entero=true con ruta_destino descarga y devuelve ruta y bytes', async () => {
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/acto.pdf', entero: true, ruta_destino: dir },
    { pedirBytes: pdfOk() },
  )
  const ruta = salida.match(/Archivo guardado en: (.+?) \(\d+ bytes\)/)?.[1]
  assert.ok(ruta, `sin ruta devuelta: ${salida.slice(0, 200)}`)
  assert.match(salida, /URL de origen: https:\/\/normograma\.supersalud\.gov\.co/)
  assert.deepEqual(readFileSync(ruta!), PDF)
})

test('entero=true sin ruta_destino usa un directorio temporal', async () => {
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/acto.pdf', entero: true },
    { pedirBytes: pdfOk() },
  )
  const ruta = salida.match(/Archivo guardado en: (.+?) \(\d+ bytes\)/)?.[1]
  assert.ok(ruta, 'debe devolver la ruta absoluta')
  assert.match(ruta!, /normativa-/)
  assert.deepEqual(readFileSync(ruta!), PDF)
})

// --- ruta_destino sin entero (descarga) ------------------------------------

test('ruta_destino sin entero descarga el archivo y no devuelve el texto', async () => {
  const salida = await escribir(
    { fuente: 'sectorial', entidad: 'supersalud', url: 'https://normograma.supersalud.gov.co/compilacion/docs/acto.pdf', ruta_destino: dir },
    { pedirBytes: pdfOk() },
  )
  assert.match(salida, /Archivo guardado en: .+ \(\d+ bytes\)/)
  assert.doesNotMatch(salida, /Texto total:/)
})

test('una descarga fuera del dominio permitido lanza', async () => {
  await assert.rejects(
    () =>
      escribir(
        { fuente: 'sectorial', entidad: 'supersalud', url: 'https://otro.gov.co/acto.pdf', ruta_destino: dir },
        { pedirBytes: pdfOk() },
      ),
    /dominio permitido/,
  )
})

// --- contrato del esquema (servidor compilado) ------------------------------

let c: Cliente
before(async () => {
  c = await abrirCliente()
})
after(() => c?.cerrar())

test('obtener_documento declara sectorial y los nuevos parámetros', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  const t = tools.find((x: any) => x.name === 'obtener_documento')
  assert.ok(t.inputSchema.properties.fuente.enum.includes('sectorial'), 'falta sectorial en el enum')
  assert.ok(t.inputSchema.properties.entidad, 'falta entidad en el esquema')
  assert.ok(t.inputSchema.properties.url, 'falta url en el esquema')
  assert.ok(t.inputSchema.properties.entero, 'falta entero en el esquema')
  assert.ok(t.inputSchema.properties.ruta_destino, 'falta ruta_destino en el esquema')
})

test('obtener_documento: sectorial sin entidad ni url se rechaza por validación', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'sectorial' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /entidad y url/)
})

test('buscar_normativa_sectorial acepta categoria en el esquema', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  const t = tools.find((x: any) => x.name === 'buscar_normativa_sectorial')
  assert.ok(t.inputSchema.properties.categoria, 'falta categoria en el esquema')
})
