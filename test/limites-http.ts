/**
 * Límites del transporte, contra servidores locales: el tope de tamaño del
 * cuerpo (en `pedir` y en `pedirBytes`) y la política de reintento ante 429/503,
 * que `pedirBytes` comparte con `pedir`.
 *
 * Cada caso levanta su propio servidor: el ritmo de 1 petición por segundo es
 * POR HOST y el host incluye el puerto, así que los casos no se esperan entre sí.
 */
import { strict as assert } from 'node:assert'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, test } from 'node:test'
import { gzipSync } from 'node:zlib'

import { cuerpoDe, estadoDe, pedir, pedirBytes, TopeExcedido } from '../src/nucleo/http.ts'

type Servidor = { base: string; host: string; golpes: () => number }

async function conServidor(
  responder: (n: number, req: IncomingMessage, res: ServerResponse) => void,
  caso: (s: Servidor) => Promise<void>,
): Promise<void> {
  let n = 0
  const srv = createServer((req, res) => responder(++n, req, res))
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  const host = `127.0.0.1:${(srv.address() as { port: number }).port}`
  try {
    await caso({ base: `http://${host}`, host, golpes: () => n })
  } finally {
    srv.closeAllConnections()
    srv.close()
  }
}

/** Un flujo con cabeceras, como el `IncomingMessage` que recibe `cuerpoDe`. */
function respuesta(datos: Buffer, headers: Record<string, string> = {}): Readable & { headers: Record<string, string> } {
  return Object.assign(Readable.from([datos]), { headers })
}

describe('tope de cuerpo', { concurrency: true }, () => {
  test('un cuerpo dentro del tope pasa entero', async () => {
    const datos = await cuerpoDe(respuesta(Buffer.alloc(1000, 'a')), 1000)
    assert.equal(datos.length, 1000)
  })

  test('un cuerpo que pasa el tope se corta con TopeExcedido y el flujo queda destruido', async () => {
    const res = respuesta(Buffer.alloc(1001, 'a'))
    await assert.rejects(cuerpoDe(res, 1000), TopeExcedido)
    assert.ok(res.destroyed, 'el flujo tiene que cerrarse para soltar el socket')
  })

  test('el tope cuenta bytes descomprimidos: un gzip pequeño que se expande se corta', async () => {
    // 8 KB comprimidos que se expanden a 16 MB.
    const bomba = gzipSync(Buffer.alloc(16 * 1024 * 1024))
    assert.ok(bomba.length < 64 * 1024)
    const e = await cuerpoDe(respuesta(bomba, { 'content-encoding': 'gzip' }), 1024 * 1024).then(
      () => null,
      (err: unknown) => err,
    )
    assert.ok(e instanceof TopeExcedido)
    assert.ok(e.bytes < 2 * 1024 * 1024, `se cortó tarde: ${e.bytes} bytes descomprimidos`)
  })

  test('un content-length declarado por encima del tope se rechaza sin leer', async () => {
    const res = respuesta(Buffer.alloc(10), { 'content-length': String(5000) })
    const e = await cuerpoDe(res, 1000).then(
      () => null,
      (err: unknown) => err,
    )
    assert.ok(e instanceof TopeExcedido)
    assert.equal(e.bytes, 5000)
    assert.match(e.message, /tope/)
  })

  test('pedirBytes corta una descarga que pasa su tope y no marca el host como caído', () =>
    conServidor(
      (_n, _req, res) => {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        // 65 MB en trozos de 1 MB, sin content-length: el corte tiene que ser al leer.
        const trozo = Buffer.alloc(1024 * 1024)
        let enviados = 0
        const seguir = (): void => {
          while (enviados < 65 && !res.destroyed) {
            enviados++
            if (!res.write(trozo)) return void res.once('drain', seguir)
          }
          res.end()
        }
        seguir()
      },
      async (s) => {
        await assert.rejects(pedirBytes(`${s.base}/grande.pdf`), TopeExcedido)
        assert.equal(estadoDe(s.host).degradado, false)
      },
    ))
})

describe('reintento ante 429/503', { concurrency: true }, () => {
  test('pedirBytes respeta Retry-After y reintenta un 429 una vez', () =>
    conServidor(
      (n, _req, res) => {
        if (n === 1) {
          res.writeHead(429, { 'retry-after': '1' })
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end('%PDF-1.4')
      },
      async (s) => {
        const t0 = Date.now()
        const r = await pedirBytes(`${s.base}/doc.pdf`)
        assert.equal(r.status, 200)
        assert.equal(r.datos.toString(), '%PDF-1.4')
        assert.equal(s.golpes(), 2)
        assert.ok(Date.now() - t0 >= 1000, 'no esperó lo que pedía Retry-After')
      },
    ))

  test('pedirBytes ante un 429 persistente falla con el motivo tras un solo reintento', () =>
    conServidor(
      (_n, _req, res) => {
        res.writeHead(429, { 'retry-after': '0' })
        res.end()
      },
      async (s) => {
        await assert.rejects(pedirBytes(`${s.base}/doc.pdf`), /limitando las consultas \(429\)/)
        assert.equal(s.golpes(), 2, 'un reintento, no más')
      },
    ))

  test('tres 503 persistentes en pedirBytes pausan el host como en pedir', () =>
    conServidor(
      (_n, _req, res) => {
        res.writeHead(503, { 'retry-after': '0' })
        res.end()
      },
      async (s) => {
        for (let i = 0; i < 3; i++) await assert.rejects(pedirBytes(`${s.base}/doc.pdf`), /\(503\)/)
        assert.equal(estadoDe(s.host).degradado, true)
        assert.equal(estadoDe(s.host).causa, 'HTTP 503')
      },
    ))

  test('pedir mantiene el mismo reintento: 503 y luego 200', () =>
    conServidor(
      (n, _req, res) => {
        if (n === 1) {
          res.writeHead(503, { 'retry-after': '0' })
          res.end()
          return
        }
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('<html>ok</html>')
      },
      async (s) => {
        const r = await pedir(`${s.base}/buscar?q=1`)
        assert.equal(r.cuerpo, '<html>ok</html>')
        assert.equal(s.golpes(), 2)
      },
    ))
})
