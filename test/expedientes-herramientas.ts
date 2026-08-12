/**
 * Pruebas de la herramienta de expediente (src/herramientas/expedientes.ts):
 * el aviso de desactivado, el ciclo crear/agregar/leer, el aviso de persistencia
 * con EXPEDIENTES_DIR y la exportación a markdown.
 *
 *   node --test test/expedientes-herramientas.ts
 */
import { strict as assert } from 'node:assert'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import test from 'node:test'

import { escribir, DESCRIPCION } from '../src/herramientas/expedientes.ts'

test('sin EXPEDIENTES las acciones avisan del feature desactivado', async () => {
  delete process.env['EXPEDIENTES']
  const aviso = /desactivada|EXPEDIENTES=1/
  assert.match(await escribir({ accion: 'crear' }), aviso)
  assert.match(await escribir({ accion: 'agregar', id: 'x', campo: 'preguntas', texto: 'algo' }), aviso)
  assert.match(await escribir({ accion: 'leer', id: 'x' }), aviso)
  assert.match(await escribir({ accion: 'exportar', id: 'x', ruta: '/tmp/x.md' }), aviso)
})

test('el aviso y la DESCRIPCION documentan el opt-in (EXPEDIENTES=1 y EXPEDIENTES_DIR)', async () => {
  delete process.env['EXPEDIENTES']
  const aviso = await escribir({ accion: 'crear' })
  assert.match(aviso, /EXPEDIENTES=1/)
  assert.match(aviso, /EXPEDIENTES_DIR/)
  assert.match(DESCRIPCION, /EXPEDIENTES=1/)
  assert.match(DESCRIPCION, /EXPEDIENTES_DIR/)
})

test('con EXPEDIENTES=1 el ciclo crear/agregar/leer funciona y los ids falsos avisan', async () => {
  process.env['EXPEDIENTES'] = '1'

  const creado = await escribir({ accion: 'crear' })
  const m = creado.match(/Expediente (\w+) creado/)
  assert.ok(m, creado)
  const id = m[1]!

  const agregado = await escribir({ accion: 'agregar', id, campo: 'preguntas', texto: '¿qué dice la Ley 909 de 2004?' })
  assert.match(agregado, /Agregado/)

  const leido = await escribir({ accion: 'leer', id })
  assert.ok(leido.includes('¿qué dice la Ley 909 de 2004?'), leido)

  assert.match(await escribir({ accion: 'leer', id: 'falso' }), /No existe un expediente/)
  assert.match(await escribir({ accion: 'agregar', id: 'falso', campo: 'citas', texto: 'algo' }), /No existe un expediente/)
})

test('con EXPEDIENTES_DIR el aviso de crear menciona la persistencia', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  const previa = process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES'] = '1'
  process.env['EXPEDIENTES_DIR'] = dir
  try {
    const respuesta = await escribir({ accion: 'crear' })
    assert.match(respuesta, /EXPEDIENTES_DIR/)
  } finally {
    if (previa === undefined) delete process.env['EXPEDIENTES_DIR']
    else process.env['EXPEDIENTES_DIR'] = previa
    rmSync(dir, { recursive: true, force: true })
  }
})

test('exportar escribe el markdown agrupado y devuelve ruta absoluta y tamaño', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  delete process.env['EXPEDIENTES_DIR'] // sin persistencia: solo memoria
  process.env['EXPEDIENTES'] = '1'
  try {
    const m = (await escribir({ accion: 'crear' })).match(/Expediente (\w+) creado/)
    assert.ok(m)
    const id = m[1]!
    await escribir({ accion: 'agregar', id, campo: 'preguntas', texto: '¿qué dice la Ley 909 de 2004?' })
    await escribir({ accion: 'agregar', id, campo: 'citas', texto: 'Ley 909 de 2004, art. 28' })

    const rutaArchivo = path.join(dir, 'mi-expediente.md')
    const r = await escribir({ accion: 'exportar', id, ruta: rutaArchivo })
    assert.match(r, /exportado a .*mi-expediente\.md \(\d+ bytes\)/)

    const contenido = readFileSync(rutaArchivo, 'utf8')
    assert.ok(contenido.startsWith(`# Expediente ${id}`), contenido)
    assert.ok(contenido.includes('## preguntas'), contenido)
    assert.ok(contenido.includes('- ¿qué dice la Ley 909 de 2004?'), contenido)
    assert.ok(contenido.includes('## citas'), contenido)
    assert.ok(contenido.includes('- Ley 909 de 2004, art. 28'), contenido)
    assert.ok(contenido.includes('## observaciones'), contenido) // sección vacía también aparece
    assert.ok(statSync(rutaArchivo).size > 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('exportar con ruta de directorio escribe `<id>.md` dentro', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  delete process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES'] = '1'
  try {
    const m = (await escribir({ accion: 'crear' })).match(/Expediente (\w+) creado/)
    assert.ok(m)
    const id = m[1]!
    await escribir({ accion: 'agregar', id, campo: 'decisiones', texto: 'resolver' })

    const r = await escribir({ accion: 'exportar', id, ruta: dir })
    assert.match(r, /exportado a .*[\\/]expedientes-.*\.md/)

    const archivo = path.join(dir, `${id}.md`)
    const contenido = readFileSync(archivo, 'utf8')
    assert.ok(contenido.includes('## decisiones'), contenido)
    assert.ok(contenido.includes('- resolver'), contenido)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('exportar con ruta inexistente da un error claro y no crea archivo', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  delete process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES'] = '1'
  try {
    const m = (await escribir({ accion: 'crear' })).match(/Expediente (\w+) creado/)
    assert.ok(m)
    const id = m[1]!

    const ruta = path.join(dir, 'carpeta-inexistente', 'salida.md')
    const r = await escribir({ accion: 'exportar', id, ruta })
    assert.match(r, /No existe el directorio/)
    assert.match(r, /No se creó ningún archivo/)
    assert.throws(() => statSync(ruta))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('exportar un expediente inexistente avisa y no crea archivo', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'expedientes-'))
  delete process.env['EXPEDIENTES_DIR']
  process.env['EXPEDIENTES'] = '1'
  try {
    const ruta = path.join(dir, 'fantasma.md')
    const r = await escribir({ accion: 'exportar', id: 'no-existe', ruta })
    assert.match(r, /No existe un expediente con id no-existe/)
    assert.match(r, /No se creó ningún archivo/)
    assert.throws(() => statSync(ruta))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
