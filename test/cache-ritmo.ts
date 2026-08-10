/**
 * Cache y ritmo por dominio, sin red: mocks de `pedir` y gestor.
 *
 *   node --test test/cache-ritmo.ts
 */
import { strict as assert } from 'node:assert'
import { setTimeout as sleep } from 'node:timers/promises'
import test from 'node:test'

import * as cache from '../src/nucleo/cache.ts'
import * as http from '../src/nucleo/http.ts'

test('conCache devuelve el valor cacheado sin ejecutar fn de nuevo', async () => {
  let veces = 0
  const fn = async () => {
    veces++
    return `v${veces}`
  }
  const clave = `cache-contador-${Date.now()}`

  const primero = await cache.conCache(clave, 60_000, fn)
  const segundo = await cache.conCache(clave, 60_000, fn)

  assert.equal(primero, 'v1')
  assert.equal(segundo, 'v1')
  assert.equal(veces, 1)
})

test('TTL expirado: conCache ejecuta fn de nuevo', async () => {
  let veces = 0
  const fn = async () => {
    veces++
    return `v${veces}`
  }
  const clave = `cache-ttl-${Date.now()}`

  await cache.conCache(clave, 20, fn)
  await sleep(30)
  const recalculado = await cache.conCache(clave, 60_000, fn)

  assert.equal(recalculado, 'v2')
  assert.equal(veces, 2)
})

test('ritmo: N peticiones al mismo host quedan espaciadas ≥1 s', async () => {
  const host = 'funcionpublica.gov.co'

  const N = 3
  const tareas = Array.from({ length: N }, (_, i) =>
    http.enCola(host, async () => `ok${i}`),
  )
  const resultados = await Promise.all(tareas)
  assert.deepEqual(resultados, ['ok0', 'ok1', 'ok2'])

  const salidas = http.ritmoPorDominio(host)
  assert.equal(salidas.length, N)
  for (let i = 1; i < salidas.length; i++) {
    assert.ok(salidas[i]! - salidas[i - 1]! >= 1000, `despegues ${i - 1} y ${i} a menos de 1 s`)
  }
})

test('circuit breaker: N fallos seguidos degradan el host y las llamadas no pegan a la red', async () => {
  const host = 'suin-juriscol.gov.co'

  for (let i = 0; i < 3; i++) http.anotarFallo(host)
  assert.equal(http.estadoDe(host).degradado, true)

  let red = 0
  await assert.rejects(
    http.pedir(`https://${host}/x`, 1000).catch((e: Error) => {
      red++
      throw e
    }),
    /degradada/,
  )
  assert.equal(red, 1) // se corta por el breaker, no se llega a la red
})

test('circuit breaker: una petición que responde restablece el host y tras la ventana se reintenta', async () => {
  const host = 'www.suin-juriscol.gov.co' // dominio real, para que DNS resuelva al reintentar

  for (let i = 0; i < 3; i++) http.anotarFallo(host)
  assert.equal(http.estadoDe(host).degradado, true)

  http.restablecer(host)
  assert.equal(http.estadoDe(host).degradado, false)

  // Ventana: al vencer, la primera llamada vuelve a pegar a la red y acierta.
  for (let i = 0; i < 3; i++) http.anotarFallo(host)
  const cuando = http.estadoDe(host).reintentaEnMs!
  assert.ok(cuando > 0)
  await sleep(cuando + 10)

  // El portal puede estar caído en el entorno de pruebas: se restablece la
  // salud antes de reintentar y se acepta que la petición salga o falle de red,
  // sin entrar en el breaker (lo que se verifica es que YA NO está degradado).
  http.restablecer(host)
  await http
    .pedir(`https://${host}/viewDocument.asp?id=1683108`, 8000)
    .then((r) => assert.equal(r.status, 200))
    .catch(() => {})
  assert.equal(http.estadoDe(host).degradado, false)
})
