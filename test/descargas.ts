/**
 * descargas.ts: descarga a disco con `pedirBytes` inyectado —validación de
 * dominio, creación del directorio, nombre seguro y no-sobrescritura— en un
 * directorio temporal que se limpia al final.
 *
 *   node --test test/descargas.ts
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { descargarA, escribirSinColision, nombreSeguro } from '../src/nucleo/descargas.ts'

const DOMINIO = 'https://prueba.gov.co'
const PDF = Buffer.from('%PDF-1.4 contenido de prueba')
const pdfOk = (contenido = PDF) => ({
  status: 200,
  datos: contenido,
  contentType: 'application/pdf',
})

const dir = mkdtempSync(join(tmpdir(), 'desc-'))
test.after(() => rmSync(dir, { recursive: true, force: true }))

test('descarga a una ruta válida: crea el archivo y devuelve ruta absoluta y bytes', async () => {
  const r = await descargarA(DOMINIO, `${DOMINIO}/normas/ley-909.pdf`, dir, {
    pedirBytes: async () => pdfOk(),
  })
  assert.equal(r.rutaAbsoluta, resolve(join(dir, 'ley-909.pdf')))
  assert.equal(r.bytes, PDF.length)
  assert.deepEqual(readFileSync(r.rutaAbsoluta), PDF)
})

test('una ruta no escribible lanza un error claro', async () => {
  // Un archivo donde se pedía un directorio: `mkdir` falla con ENOTDIR.
  const bloqueo = join(dir, 'bloqueo.txt')
  writeFileSync(bloqueo, '')
  await assert.rejects(
    () => descargarA(DOMINIO, `${DOMINIO}/normas/ley-909.pdf`, join(bloqueo, 'anidado'), {
      pedirBytes: async () => pdfOk(),
    }),
    /bloqueo\.txt/,
  )
})

test('un dominio fuera del permitido lanza y NO escribe nada', async () => {
  const antes = readdirSync(dir)
  await assert.rejects(
    () => descargarA(DOMINIO, 'https://otro.gov.co/normas/ley-909.pdf', dir, {
      pedirBytes: async () => pdfOk(),
    }),
    /dominio permitido es https:\/\/prueba\.gov\.co/,
  )
  assert.deepEqual(readdirSync(dir), antes)
})

test('un archivo ya existente se descarga como _1 y el nombre lo informa', async () => {
  const r1 = await descargarA(DOMINIO, `${DOMINIO}/normas/reiterada.pdf`, dir, {
    pedirBytes: async () => pdfOk(),
  })
  const r2 = await descargarA(DOMINIO, `${DOMINIO}/normas/reiterada.pdf`, dir, {
    pedirBytes: async () => pdfOk(),
  })
  assert.equal(r1.rutaAbsoluta, resolve(join(dir, 'reiterada.pdf')))
  assert.equal(r2.rutaAbsoluta, resolve(join(dir, 'reiterada_1.pdf')))
  assert.deepEqual(readFileSync(r1.rutaAbsoluta), PDF, 'el primer archivo no se toca')
  assert.deepEqual(readFileSync(r2.rutaAbsoluta), PDF)
})

test('el nombre se sanitiza: sin separadores, sin .., sin espacios, con extensión', async () => {
  const r = await descargarA(DOMINIO, `${DOMINIO}/docs/../  ley  909.pdf`, dir, {
    pedirBytes: async () => pdfOk(),
  })
  assert.equal(r.rutaAbsoluta, resolve(join(dir, 'ley_909.pdf')))
  assert.ok(!r.rutaAbsoluta.includes('..'), 'nunca puede quedar un .. en la ruta final')
  assert.deepEqual(readFileSync(r.rutaAbsoluta), PDF)
})

test('sin extensión en la URL se añade según el contentType', () => {
  assert.equal(nombreSeguro(`${DOMINIO}/docs/ley909`, 'application/pdf'), 'ley909.pdf')
  assert.equal(
    nombreSeguro(`${DOMINIO}/docs/ley909`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'ley909.docx',
  )
  assert.equal(nombreSeguro(`${DOMINIO}/docs/ley909`, 'text/html; charset=utf-8'), 'ley909.html')
  assert.equal(nombreSeguro(`${DOMINIO}/docs/ley909`, 'application/octet-stream'), 'ley909')
})

test('una URL vacía o con solo separadores no produce un nombre vacío', () => {
  assert.ok(nombreSeguro(`${DOMINIO}/`).length > 0)
  assert.equal(nombreSeguro(`${DOMINIO}/../..`), 'archivo')
})

test('no crea ni toca un archivo auxiliar: un .prueba-escritura del usuario queda intacto', async () => {
  const propio = mkdtempSync(join(tmpdir(), 'desc-aux-'))
  try {
    writeFileSync(join(propio, '.prueba-escritura'), 'DATOS DEL USUARIO')
    const r = await descargarA(DOMINIO, `${DOMINIO}/normas/ley-1.pdf`, propio, {
      pedirBytes: async () => pdfOk(),
    })
    assert.equal(readFileSync(join(propio, '.prueba-escritura'), 'utf8'), 'DATOS DEL USUARIO')
    assert.deepEqual(readdirSync(propio).sort(), ['.prueba-escritura', 'ley-1.pdf'])
    assert.deepEqual(readFileSync(r.rutaAbsoluta), PDF)
  } finally {
    rmSync(propio, { recursive: true, force: true })
  }
})

test('descargas concurrentes del mismo nombre acaban en archivos distintos, cada uno con su contenido', async () => {
  const propio = mkdtempSync(join(tmpdir(), 'desc-conc-'))
  try {
    const contenidos = Array.from({ length: 8 }, (_, i) => Buffer.from(`%PDF-1.4 copia ${i}`))
    const rs = await Promise.all(
      contenidos.map((c) =>
        descargarA(DOMINIO, `${DOMINIO}/normas/misma.pdf`, propio, { pedirBytes: async () => pdfOk(c) }),
      ),
    )
    const rutas = rs.map((r) => r.rutaAbsoluta)
    assert.equal(new Set(rutas).size, contenidos.length, 'ningún nombre se repite')
    rs.forEach((r, i) => assert.deepEqual(readFileSync(r.rutaAbsoluta), contenidos[i]))
    assert.equal(readdirSync(propio).length, contenidos.length)
  } finally {
    rmSync(propio, { recursive: true, force: true })
  }
})

test('escribirSinColision reserva el nombre: concurrentes nunca se pisan y lo previo no se toca', async () => {
  const propio = mkdtempSync(join(tmpdir(), 'desc-wx-'))
  try {
    const base = join(propio, 'texto-gestor.txt')
    writeFileSync(base, 'PREVIO')
    const rutas = await Promise.all(Array.from({ length: 10 }, (_, i) => escribirSinColision(base, `texto ${i}`)))
    assert.equal(readFileSync(base, 'utf8'), 'PREVIO')
    assert.equal(new Set(rutas).size, 10)
    assert.ok(!rutas.includes(base))
    rutas.forEach((r, i) => assert.equal(readFileSync(r, 'utf8'), `texto ${i}`))
  } finally {
    rmSync(propio, { recursive: true, force: true })
  }
})
