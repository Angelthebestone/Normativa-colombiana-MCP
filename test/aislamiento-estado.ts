/**
 * El estado de la caché, los expedientes y el transporte vive en instancias:
 * dos instancias no se ven entre sí, y la del proceso es una más.
 */
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { test } from 'node:test'

import { crearCache } from '../src/nucleo/cache.ts'
import { crearExpedientes } from '../src/nucleo/expediente.ts'
import { crearRed } from '../src/nucleo/http.ts'

test('dos cachés no comparten búsquedas ni copias', () => {
  const a = crearCache()
  const b = crearCache()
  a.memoria.poner('k', 'valor', 60_000)
  assert.equal(a.memoria.obtener('k'), 'valor')
  assert.equal(b.memoria.obtener('k'), null)

  const copia = { cuerpo: 'x', status: 200, cabeceras: {}, fecha: Date.now(), vence: Date.now() + 1000 }
  a.copias.guardarCopia('u', copia)
  assert.equal(a.copias.copiasGuardadas(), 1)
  assert.equal(b.copias.copiasGuardadas(), 0)
  assert.equal(b.copias.obtenerCopia('u'), null)
})

test('dos almacenes de expedientes no se ven', () => {
  delete process.env['EXPEDIENTES_DIR']
  const a = crearExpedientes()
  const b = crearExpedientes()
  const id = a.crear()
  assert.equal(a.agregar(id, 'preguntas', 'p'), true)
  assert.ok(a.leer(id))
  assert.equal(b.leer(id), null)
  assert.equal(b.agregar(id, 'preguntas', 'p'), false)
})

test('dos redes llevan contadores, interruptores y ritmo por separado', async () => {
  let golpes = 0
  const srv = createServer((_req, res) => {
    golpes++
    res.writeHead(500).end('caído')
  })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  const host = `127.0.0.1:${(srv.address() as { port: number }).port}`
  try {
    const a = crearRed({ copias: crearCache().copias })
    const b = crearRed({ copias: crearCache().copias })
    for (let i = 0; i < 3; i++) await a.pedir(`http://${host}/x`).catch(() => {})
    assert.equal(a.estadoDe(host).degradado, true, 'tres 5xx pausan el host en la red que los vio')
    assert.equal(b.estadoDe(host).degradado, false, 'la otra red no se entera')
    assert.equal(a.redResumen().peticiones, 0)
    assert.equal(b.redResumen().peticiones, 0)
    assert.equal(a.ritmoPorDominio(host).length, 3)
    assert.equal(b.ritmoPorDominio(host).length, 0)
    assert.equal(golpes, 3)
  } finally {
    srv.closeAllConnections()
    srv.close()
  }
})
