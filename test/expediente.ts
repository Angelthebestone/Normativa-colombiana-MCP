/**
 * Pruebas del expediente: el gate EXPEDIENTES, el ciclo crear/agregar/leer,
 * la expiración por TTL y la persistencia en disco con EXPEDIENTES_DIR.
 *
 *   node --test test/expediente.ts
 */
import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'

import { agregar, crear, enDisco, habilitado, leer, recargar } from '../src/nucleo/expediente.ts'

test('habilitado() es false sin la variable EXPEDIENTES', () => {
  delete process.env['EXPEDIENTES']
  assert.equal(habilitado(), false)
})

test('con EXPEDIENTES=1, crear/agregar/leer funcionan', () => {
  process.env['EXPEDIENTES'] = '1'
  assert.equal(habilitado(), true)
  const id = crear()
  assert.equal(agregar(id, 'preguntas', '¿qué dice la Ley 909 de 2004?'), true)
  const datos = leer(id)
  assert.ok(datos)
  assert.deepEqual(datos.preguntas, ['¿qué dice la Ley 909 de 2004?'])
  assert.deepEqual(datos.fuentes, [])
  assert.equal(agregar(id, 'citas', ''), false) // texto vacío no se agrega
})

test('agregar a un id inexistente devuelve false', () => {
  assert.equal(agregar('no-existe', 'documentos', 'algo'), false)
})

test('un expediente con TTL corto expira y se borra', async () => {
  const id = crear(10)
  assert.equal(agregar(id, 'documentos', 'texto'), true)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(leer(id), null)
  assert.equal(agregar(id, 'documentos', 'más'), false) // ya borrado
})

test('sin TTL configurado un expediente no expira aunque pase el tiempo', async () => {
  const id = crear()
  assert.equal(agregar(id, 'citas', 'texto'), true)
  await new Promise((r) => setTimeout(r, 20))
  const datos = leer(id)
  assert.ok(datos)
  assert.deepEqual(datos.citas, ['texto'])
})

test('enDisco() refleja EXPEDIENTES_DIR', () => {
  delete process.env['EXPEDIENTES_DIR']
  assert.equal(enDisco(), false)
  process.env['EXPEDIENTES_DIR'] = path.join(os.tmpdir(), 'expedientes-prueba')
  assert.equal(enDisco(), true)
  delete process.env['EXPEDIENTES_DIR']
})

test('con EXPEDIENTES_DIR cada mutación persiste y recargar la vuelve a leer', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  const previa = process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES_DIR'] = dir
  try {
    assert.equal(enDisco(), true)
    const id = crear()
    assert.equal(agregar(id, 'preguntas', 'persistencia'), true)
    assert.equal(agregar(id, 'decisiones', 'se guarda'), true)

    const archivo = path.join(dir, `${id}.json`)
    const enDisco1 = JSON.parse(readFileSync(archivo, 'utf8'))
    assert.deepEqual(enDisco1.datos.preguntas, ['persistencia'])
    assert.deepEqual(enDisco1.datos.decisiones, ['se guarda'])

    // Un "reinicio": se recarga el mapa desde el directorio.
    assert.equal(recargar(), 1)
    const datos = leer(id)
    assert.ok(datos)
    assert.deepEqual(datos.preguntas, ['persistencia'])
  } finally {
    if (previa === undefined) delete process.env['EXPEDIENTES_DIR']
    else process.env['EXPEDIENTES_DIR'] = previa
    rmSync(dir, { recursive: true, force: true })
  }
})

test('recargar ignora un archivo corrupto y sigue con los sanos', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  const previa = process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES_DIR'] = dir
  try {
    const sano = crear()
    assert.equal(agregar(sano, 'fuentes', 'ok'), true)
    // Corrupto: no tumba la recarga.
    writeFileSync(path.join(dir, 'corrupto.json'), '{no es json')
    writeFileSync(path.join(dir, 'mal.json'), '{"datos": {"preguntas": "no-es-array"}, "creado": 1}')

    assert.equal(recargar(), 1)
    assert.ok(leer(sano))
  } finally {
    if (previa === undefined) delete process.env['EXPEDIENTES_DIR']
    else process.env['EXPEDIENTES_DIR'] = previa
    rmSync(dir, { recursive: true, force: true })
  }
})

test('si EXPEDIENTES_DIR no se puede escribir, crear lanza y no deja el expediente en memoria', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  const previa = process.env['EXPEDIENTES_DIR']
  // Un archivo donde se pedía un directorio: mkdir falla con ENOTDIR/EEXIST.
  const bloqueo = path.join(base, 'bloqueo')
  writeFileSync(bloqueo, '')
  process.env['EXPEDIENTES_DIR'] = path.join(bloqueo, 'anidado')
  try {
    recargar()
    assert.throws(() => crear(), /No se pudo guardar el expediente .* El cambio no se aplicó/)
    assert.equal(recargar(), 0)
  } finally {
    if (previa === undefined) delete process.env['EXPEDIENTES_DIR']
    else process.env['EXPEDIENTES_DIR'] = previa
    rmSync(base, { recursive: true, force: true })
  }
})

test('si agregar no llega a disco, lanza y ni la memoria ni el archivo cambian', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  const previa = process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES_DIR'] = dir
  try {
    recargar()
    const id = crear()
    assert.equal(agregar(id, 'citas', 'primera'), true)
    const archivo = path.join(dir, `${id}.json`)
    const antes = readFileSync(archivo, 'utf8')

    // El rename sobre `<id>.json` falla si en su lugar hay un directorio no vacío.
    rmSync(archivo)
    mkdirSync(path.join(archivo, 'ocupado'), { recursive: true })
    assert.throws(() => agregar(id, 'citas', 'segunda'), /No se pudo guardar el expediente/)
    assert.deepEqual(leer(id)?.citas, ['primera'], 'la memoria no adelanta lo que el disco no tiene')
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.endsWith('.tmp')),
      [],
      'el temporal se limpia',
    )

    rmSync(archivo, { recursive: true })
    writeFileSync(archivo, antes)
    assert.equal(agregar(id, 'citas', 'segunda'), true)
    assert.deepEqual(JSON.parse(readFileSync(archivo, 'utf8')).datos.citas, ['primera', 'segunda'])
  } finally {
    if (previa === undefined) delete process.env['EXPEDIENTES_DIR']
    else process.env['EXPEDIENTES_DIR'] = previa
    rmSync(dir, { recursive: true, force: true })
  }
})

test('la escritura no deja temporales y el JSON queda completo tras muchas mutaciones', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  const previa = process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES_DIR'] = dir
  try {
    recargar()
    const id = crear()
    for (let i = 0; i < 50; i++) assert.equal(agregar(id, 'observaciones', `obs ${i}`), true)
    assert.deepEqual(readdirSync(dir), [`${id}.json`])
    assert.equal(JSON.parse(readFileSync(path.join(dir, `${id}.json`), 'utf8')).datos.observaciones.length, 50)
  } finally {
    if (previa === undefined) delete process.env['EXPEDIENTES_DIR']
    else process.env['EXPEDIENTES_DIR'] = previa
    rmSync(dir, { recursive: true, force: true })
  }
})
