/**
 * Fusión de peticiones idénticas en vuelo, contra servidores locales que cuentan
 * los golpes. Sin red externa: lo que se mide es CUÁNTAS VECES habla `pedir` con
 * el portal, que es lo que hay que cuidar.
 *
 * Cada caso tiene su contrapartida —lo que NO debe fusionarse— porque una
 * fusión que se pasa de lista devuelve la respuesta de otra consulta, que es
 * peor que la descarga repetida que evita.
 *
 * Cada caso levanta su propio servidor: el ritmo de 1 petición por segundo es
 * POR HOST y el host incluye el puerto, así que con servidor propio los casos no
 * se esperan entre sí y la prueba entera dura lo que dura lo que se mide.
 *
 * Las rutas son de búsqueda (`/buscar?…`), que no se cachean: así el recuento de
 * golpes es de la fusión y no de la copia en memoria, que ya cubría los repetidos
 * secuenciales.
 */
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import { describe, test } from 'node:test'

import { pedir } from '../src/nucleo/http.ts'

type Servidor = { base: string; golpes: () => number; colgar: (v: boolean) => void }

/** Servidor propio con demora, que cuenta golpes y puede cortar el socket. */
async function conServidor(caso: (s: Servidor) => Promise<void>): Promise<void> {
  let n = 0
  let cortar = false
  const srv = createServer((req, res) => {
    n++
    if (cortar) {
      req.socket.destroy()
      return
    }
    // La demora deja la primera petición en vuelo mientras llegan las demás.
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<html>${req.url}|${req.headers['accept']}</html>`)
    }, 150)
  })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  try {
    await caso({
      base: `http://127.0.0.1:${(srv.address() as { port: number }).port}`,
      golpes: () => n,
      colgar: (v) => {
        cortar = v
      },
    })
  } finally {
    srv.close()
  }
}

// Concurrentes a propósito: cada caso tiene servidor y host propios, así que no se
// esperan entre sí y la prueba dura lo que el más lento en vez de la suma.
describe('fusión en vuelo', { concurrency: true }, () => {
  test('tres GET simultáneos a la misma URL son UN golpe al servidor, y los tres reciben lo mismo', () =>
    conServidor(async (s) => {
      const url = `${s.base}/buscar?q=igual`
      const [a, b, c] = await Promise.all([pedir(url), pedir(url), pedir(url)])
      assert.equal(s.golpes(), 1, 'sin fusión eran 3 golpes y 3 s por el ritmo del host')
      assert.equal(a.cuerpo, b.cuerpo)
      assert.equal(b.cuerpo, c.cuerpo)
      assert.match(a.cuerpo, /\/buscar\?q=igual/)
    }))

  test('terminada la petición no queda nada pegado: la siguiente llamada vuelve a salir', () =>
    conServidor(async (s) => {
      const url = `${s.base}/buscar?q=despues`
      await pedir(url)
      await pedir(url)
      assert.equal(s.golpes(), 2, 'la fusión es de lo que está EN VUELO, no una caché')
    }))

  test('lo que difiere en la URL o en el accept NO se fusiona: no es la misma consulta', () =>
    conServidor(async (s) => {
      const [a, b, c] = await Promise.all([
        pedir(`${s.base}/buscar?q=uno`),
        pedir(`${s.base}/buscar?q=dos`),
        pedir(`${s.base}/buscar?q=uno`, 60_000, 'application/json'),
      ])
      assert.equal(s.golpes(), 3, 'tres consultas distintas = tres golpes')
      assert.match(a.cuerpo, /q=uno\|text\/html/)
      assert.match(b.cuerpo, /q=dos/)
      assert.match(c.cuerpo, /q=uno\|application\/json/, 'el accept distinto tiene que llegar al servidor')
    }))

  test('un fallo se comparte con quien esperaba y no se queda pegado', () =>
    conServidor(async (s) => {
      const url = `${s.base}/buscar?q=falla`
      s.colgar(true)
      const par = await Promise.allSettled([pedir(url), pedir(url)])
      assert.deepEqual(par.map((r) => r.status), ['rejected', 'rejected'])
      assert.equal(
        (par[0] as PromiseRejectedResult).reason.message,
        (par[1] as PromiseRejectedResult).reason.message,
        'los dos esperan lo mismo, así que reciben el mismo error',
      )
      assert.equal(s.golpes(), 1, 'un solo intento para los dos')

      s.colgar(false)
      const luego = await pedir(url)
      assert.equal(luego.status, 200, 'la promesa rechazada no puede quedarse en el mapa')
    }))
})
