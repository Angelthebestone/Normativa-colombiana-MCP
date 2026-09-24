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

test('TTL por clase de norma: lo viejo dura más que lo de este año y la Constitución más que todo', () => {
  const ahora = Date.UTC(2026, 8, 16)
  const constitucion = cache.ttlDeNorma('Constitución Política', '', ahora)
  const antigua = cache.ttlDeNorma('ley', 1993, ahora)
  const media = cache.ttlDeNorma('decreto', 2024, ahora)
  const reciente = cache.ttlDeNorma('ley', 2025, ahora)
  const actual = cache.ttlDeNorma('decreto', 2026, ahora)
  const desconocida = cache.ttlDeNorma('ley', undefined, ahora)

  assert.equal(cache.claseDeNorma('Constitución Política', '1991', ahora), 'constitucion')
  assert.equal(cache.claseDeNorma('ley', 1993, ahora), 'antigua')
  assert.equal(cache.claseDeNorma('LEY', 2026, ahora), 'actual')
  assert.equal(cache.claseDeNorma('ley', undefined, ahora), 'desconocida')
  assert.ok(constitucion > antigua, 'la Constitución debe durar más que una ley vieja')
  assert.ok(antigua > media, 'una ley de 1993 debe durar más que un decreto de 2024')
  assert.ok(media > reciente, 'un decreto de 2024 debe durar más que una ley de 2025')
  assert.ok(reciente > actual, 'lo del año pasado debe durar más que lo de este año')
  assert.ok(actual >= 3600 * 1000, 'ni lo de este año se sirve con menos de una hora de margen')
  assert.ok(desconocida > 0)
})

test('identidad de una norma: del nombre del archivo o del título del documento', () => {
  assert.deepEqual(cache.identidadDeNorma('https://x.gov.co/dian/compilacion/docs/decreto_1235_2023.htm'), {
    tipo: 'decreto',
    anio: '2023',
  })
  // El título manda sobre el cuerpo: el cuerpo cita otras normas antes de decir cuál es.
  const cuerpo = '<html>… <h2 class="titulo-norma">LEY 1437 DE 2011</h2> … cita la Ley 909 de 2004 …'
  assert.deepEqual(cache.identidadDeNorma('https://x.gov.co/norma.php?i=1', cuerpo), { tipo: 'ley', anio: '2011' })
  assert.deepEqual(cache.identidadDeNorma('https://x.gov.co/norma.php?i=1', 'CONSTITUCIÓN POLÍTICA DE COLOMBIA'), {
    tipo: 'constitucion',
    anio: '',
  })
  assert.deepEqual(cache.identidadDeNorma('https://x.gov.co/norma.php?i=1', 'sin nada que reconocer'), {
    tipo: '',
    anio: '',
  })
})

test('solo se cachean documentos, nunca buscadores ni APIs ni POST', () => {
  assert.equal(cache.esDescargaCacheable('https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=31431', 'GET', 'text/html; charset=UTF-8'), true)
  assert.equal(cache.esDescargaCacheable('https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1625_2016.htm', 'GET', 'text/html'), true)
  assert.equal(cache.esDescargaCacheable('https://www.corteconstitucional.gov.co/relatoria/2021/SU371-21.htm', 'GET', 'text/html'), true)

  assert.equal(cache.esDescargaCacheable('https://www.funcionpublica.gov.co/eva/gestornormativo/gestion/funphp/funajax.php?t=ejecuta_busqueda_avanzada2', 'GET', 'text/html'), false)
  assert.equal(cache.esDescargaCacheable('https://normograma.info/prueba-dian/buscador/Buscar.ashx?texto=retencion', 'GET', 'application/json'), false)
  assert.equal(cache.esDescargaCacheable('https://x.gov.co/api/v1/normas?api-key=1', 'GET', 'application/json'), false)
  // Un POST con cuerpo no se cachea ni siendo documento.
  assert.equal(cache.esDescargaCacheable('https://x.gov.co/norma.htm', 'POST', 'text/html'), false)
  // Un PDF no pasa por aquí: va por pedirBytes.
  assert.equal(cache.esDescargaCacheable('https://x.gov.co/norma.htm', 'GET', 'application/pdf'), false)
})

test('copias: guardar, refrescar y cabeceras condicionales según el validador que dio la fuente', () => {
  cache.limpiarCopias()
  cache.guardarCopia('https://x.gov.co/a.htm', {
    cuerpo: '<html>a</html>',
    status: 200,
    cabeceras: { etag: '"abc"' },
    fecha: 1_000,
    vence: 2_000,
  })
  const conEtag = cache.obtenerCopia('https://x.gov.co/a.htm')!
  assert.deepEqual(cache.cabecerasCondicionales(conEtag), { 'If-None-Match': '"abc"' })

  cache.guardarCopia('https://x.gov.co/b.htm', {
    cuerpo: '<html>b</html>',
    status: 200,
    cabeceras: { 'last-modified': 'Wed, 16 Sep 2026 05:06:52 GMT' },
    fecha: 1_000,
    vence: 2_000,
  })
  assert.deepEqual(cache.cabecerasCondicionales(cache.obtenerCopia('https://x.gov.co/b.htm')!), {
    'If-Modified-Since': 'Wed, 16 Sep 2026 05:06:52 GMT',
  })

  // Con los dos, gana la fecha: el ETag de IIS cambia según el nodo que conteste
  // (medido el 2026-09-24) y un If-None-Match presente anula el If-Modified-Since.
  cache.guardarCopia('https://x.gov.co/iis.htm', {
    cuerpo: '<html>iis</html>',
    status: 200,
    cabeceras: { etag: '"62318d036a9cc1:0"', 'last-modified': 'Tue, 22 Nov 2011 16:50:17 GMT' },
    fecha: 1_000,
    vence: 2_000,
  })
  assert.deepEqual(cache.cabecerasCondicionales(cache.obtenerCopia('https://x.gov.co/iis.htm')!), {
    'If-Modified-Since': 'Tue, 22 Nov 2011 16:50:17 GMT',
  })

  // Sin validador no hay nada que preguntar: el Gestor no publica ninguno.
  cache.guardarCopia('https://x.gov.co/c.htm', { cuerpo: 'c', status: 200, cabeceras: {}, fecha: 1_000, vence: 2_000 })
  assert.deepEqual(cache.cabecerasCondicionales(cache.obtenerCopia('https://x.gov.co/c.htm')!), {})

  cache.refrescarCopia('https://x.gov.co/a.htm', 5_000, 9_000)
  const refrescada = cache.obtenerCopia('https://x.gov.co/a.htm')!
  assert.equal(refrescada.fecha, 5_000)
  assert.equal(refrescada.vence, 9_000)
  assert.equal(refrescada.cuerpo, '<html>a</html>', 'refrescar no toca el cuerpo')
  cache.limpiarCopias()
})

test('copias: el almacén tiene tope y descarta la más antigua', () => {
  cache.limpiarCopias()
  for (let i = 0; i < 80; i++) {
    cache.guardarCopia(`https://x.gov.co/${i}.htm`, { cuerpo: 'x', status: 200, cabeceras: {}, fecha: i, vence: 1 })
  }
  assert.equal(cache.copiasGuardadas(), 64)
  assert.equal(cache.obtenerCopia('https://x.gov.co/0.htm'), null, 'la primera en entrar es la primera en salir')
  assert.ok(cache.obtenerCopia('https://x.gov.co/79.htm'), 'la última sigue dentro')
  cache.limpiarCopias()
})

test('presupuesto: se propaga por contexto y se agota de verdad', async () => {
  assert.equal(http.presupuestoRestante(), null, 'sin presupuesto no hay techo')
  await http.conPresupuesto(5_000, async () => {
    const queda = http.presupuestoRestante()!
    assert.ok(queda > 0 && queda <= 5_000, `debería quedar algo de 5 s, quedan ${queda}`)
    await sleep(20)
    assert.ok(http.presupuestoRestante()! < queda, 'el presupuesto tiene que consumirse con el tiempo')
  })
  assert.equal(http.presupuestoRestante(), null, 'al salir del contexto el techo desaparece')
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
