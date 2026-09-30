/**
 * Cache y ritmo por dominio, sin red: mocks de `pedir` y gestor.
 *
 *   node --test test/cache-ritmo.ts
 */
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import test from 'node:test'

import * as cache from '../src/nucleo/cache.ts'
import * as http from '../src/nucleo/http.ts'

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

  for (let i = 0; i < 3; i++) http.anotarFallo(host, 'HTTP 503')
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

test('circuit breaker: vencida la ventana el host vuelve a intentarse sin restablecerlo a mano', (t) => {
  // Reloj simulado: la ventana es de 60 s reales y esperarla costaba un minuto
  // por cada corrida de la suite. Lo que se comprueba es el VENCIMIENTO, no el paso del tiempo.
  t.mock.timers.enable({ apis: ['Date'] })
  const host = 'breaker-ventana.test'

  for (let i = 0; i < 3; i++) http.anotarFallo(host, 'HTTP 503')
  assert.equal(http.estadoDe(host).degradado, true)
  const cuando = http.estadoDe(host).reintentaEnMs!
  assert.ok(cuando > 0)

  t.mock.timers.tick(cuando - 1)
  assert.equal(http.estadoDe(host).degradado, true, 'a un milisegundo de vencer sigue degradado')
  t.mock.timers.tick(1)
  assert.equal(http.estadoDe(host).degradado, false, 'vencida la ventana se reintenta, sin restablecer a mano')
})

test('circuit breaker: el error nombra la causa, no promete un reintento y distingue la pausa recién armada de la que sigue', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })
  const host = 'breaker-causa.test'
  for (let i = 0; i < 3; i++) http.anotarFallo(host, 'HTTP 503')

  // Recién armada: nombra la causa y dice que se vuelve a llamar a la fuente pasado el plazo.
  const nueva = await http.pedir(`https://${host}/a`, 1000).catch((e: Error) => e)
  assert.ok(nueva instanceof Error)
  assert.match(nueva.message, /HTTP 503/)
  assert.match(nueva.message, /No se reintenta sola/)
  assert.match(nueva.message, /60 s y pasado ese plazo se vuelve a llamar/)
  assert.doesNotMatch(nueva.message, /reintentando/)

  // Dentro de la pausa: cuánto queda, que no se llamó a la fuente y la causa que la armó.
  t.mock.timers.tick(20_000)
  const enPausa = await http.pedir(`https://${host}/b`, 1000).catch((e: Error) => e)
  assert.ok(enPausa instanceof Error)
  assert.match(enPausa.message, /quedan 40 s/)
  assert.match(enPausa.message, /no se llamó a la fuente/)
  assert.match(enPausa.message, /HTTP 503/)
  assert.doesNotMatch(enPausa.message, /reintentando/)
})

test('circuit breaker: pasada la pausa, una respuesta buena restablece el host', async (t) => {
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html>ok</html>')
  })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  const host = `127.0.0.1:${(srv.address() as { port: number }).port}`
  try {
    t.mock.timers.enable({ apis: ['Date'] })
    for (let i = 0; i < 3; i++) http.anotarFallo(host, 'HTTP 502')
    assert.equal(http.estadoDe(host).degradado, true)
    t.mock.timers.tick(60_001)
    assert.equal(http.estadoDe(host).degradado, false, 'vencida la pausa se vuelve a llamar a la fuente')

    const r = await http.pedir(`http://${host}/norma.php?i=1`)
    assert.equal(r.status, 200)
    for (let i = 0; i < 2; i++) http.anotarFallo(host, 'HTTP 502')
    assert.equal(http.estadoDe(host).degradado, false, 'la respuesta buena restableció el host: 2 fallos no lo degradan')
  } finally {
    srv.close()
  }
})

test('circuit breaker: tres redirecciones canónicas seguidas (añadir la barra final) no degradan el host', async () => {
  // Superfinanciera responde `301 /10115974 → /10115974/` en cada listado anual; contarlas como fallo
  // armaba la pausa de 60 s y la fuente devolvía siempre «degradada».
  const srv = createServer((req, res) => {
    res.writeHead(301, { location: `http://${req.headers.host}${req.url}/` })
    res.end()
  })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  const host = `127.0.0.1:${(srv.address() as { port: number }).port}`
  try {
    for (const id of ['10115974', '10115975', '10115976', '10115977']) {
      const r = await http.pedir(`http://${host}/${id}`)
      assert.equal(r.status, 301, `la petición ${id} llegó a la fuente`)
    }
    assert.equal(http.estadoDe(host).degradado, false)
  } finally {
    srv.close()
  }
})

test('circuit breaker: una petición que responde restablece el host', async () => {
  // Servidor local: antes esta prueba pedía a un portal real dentro de una suite «sin red»
  // y tragaba el fallo con un `.catch(() => {})`, así que no comprobaba nada.
  const srv = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html>ok</html>')
  })
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok))
  const host = `127.0.0.1:${(srv.address() as { port: number }).port}`
  try {
    // Dos fallos: a uno del umbral. Sin restablecer, otros dos degradarían el host.
    for (let i = 0; i < 2; i++) http.anotarFallo(host, 'HTTP 503')
    assert.equal(http.estadoDe(host).degradado, false)

    const r = await http.pedir(`http://${host}/norma.php?i=1`)
    assert.equal(r.status, 200)

    for (let i = 0; i < 2; i++) http.anotarFallo(host, 'HTTP 503')
    assert.equal(http.estadoDe(host).degradado, false, 'la respuesta puso el contador a cero: 2 + 2 ya no suma 4')
  } finally {
    srv.close()
  }
})
