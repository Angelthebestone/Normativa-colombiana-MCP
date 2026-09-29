/**
 * Las búsquedas del Gestor y las fichas de SUIN se recuerdan cinco minutos (`TTL_BUSQUEDA_MS`):
 * consultar_vigencia y luego resolver_cita sobre la misma norma no repiten la búsqueda. Sin red: la
 * lectura del Gestor y el índice de SUIN se inyectan y cuentan las idas. La caché es del proceso, así
 * que cada prueba usa sus propias palabras o su propio número.
 */
import { strict as assert } from 'node:assert'
import { mock, test } from 'node:test'
import { buscar } from '../src/fuentes/gestor.ts'
import { ficha, type RespuestaFichas } from '../src/fuentes/suin.ts'

// --- Gestor ----------------------------------------------------------------

const con = (...ids: string[]): string =>
  `Número de documentos encontrados: ${ids.length} ` +
  ids.map((id) => `<a href="norma.php?i=${id}"><h5>Norma ${id}</h5><p>resumen ${id}</p></a>`).join('')

/** Un portal de mentira: contesta lo que le den, o falla, y cuenta cuántas veces le preguntan. */
function portal(respuestas: (string | Error)[]) {
  const estado = { idas: 0 }
  const leer = async (): Promise<string> => {
    const r = respuestas[Math.min(estado.idas, respuestas.length - 1)]!
    estado.idas += 1
    if (r instanceof Error) throw r
    return r
  }
  return { estado, leer }
}

test('gestor: la misma búsqueda se pregunta una sola vez y devuelve lo mismo', async () => {
  const p = portal([con('214411', '76835')])
  const a = await buscar({ palabras: 'nomina electronica' }, { leer: p.leer })
  const b = await buscar({ palabras: 'nomina electronica' }, { leer: p.leer })
  assert.equal(p.estado.idas, 1)
  assert.deepEqual(b.items.map((i) => i.id), ['214411', '76835'])
  assert.deepEqual(b.items, a.items)
})

test('gestor: lo devuelto es una copia, ordenarlo o recortarlo no cambia lo recordado', async () => {
  const p = portal([con('1', '2', '3')])
  const a = await buscar({ palabras: 'contratacion directa' }, { leer: p.leer })
  a.items.reverse()
  a.items.length = 1
  // Y lo servido desde la memoria tampoco es el arreglo guardado.
  const b = await buscar({ palabras: 'contratacion directa' }, { leer: p.leer })
  assert.deepEqual(b.items.map((i) => i.id), ['1', '2', '3'])
  b.items.reverse()
  b.items.length = 1
  const c = await buscar({ palabras: 'contratacion directa' }, { leer: p.leer })
  assert.deepEqual(c.items.map((i) => i.id), ['1', '2', '3'])
  assert.equal(p.estado.idas, 1)
})

test('gestor: un vacío no se recuerda, porque puede ser un fallo pasajero del portal', async () => {
  const p = portal(['Número de documentos encontrados: 0', con('9')])
  const a = await buscar({ palabras: 'regimen sancionatorio' }, { leer: p.leer })
  assert.equal(a.items.length, 0)
  const b = await buscar({ palabras: 'regimen sancionatorio' }, { leer: p.leer })
  assert.deepEqual(b.items.map((i) => i.id), ['9'], 'la segunda vez vuelve a preguntar')
  assert.equal(p.estado.idas, 2)
})

test('gestor: un fallo no se recuerda', async () => {
  const p = portal([new Error('tiempo de espera agotado'), con('7')])
  await assert.rejects(() => buscar({ palabras: 'teletrabajo remoto' }, { leer: p.leer }))
  const b = await buscar({ palabras: 'teletrabajo remoto' }, { leer: p.leer })
  assert.deepEqual(b.items.map((i) => i.id), ['7'])
  assert.equal(p.estado.idas, 2)
})

test('gestor: consultas distintas no comparten respuesta', async () => {
  const p = portal([con('1'), con('2')])
  const a = await buscar({ palabras: 'licencia ambiental' }, { leer: p.leer })
  const b = await buscar({ palabras: 'licencia minera' }, { leer: p.leer })
  assert.equal(p.estado.idas, 2)
  assert.notDeepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id))
})

test('gestor: lo recordado caduca a los cinco minutos', async () => {
  mock.timers.enable({ apis: ['Date'] })
  try {
    const p = portal([con('5')])
    await buscar({ palabras: 'contrato estatal' }, { leer: p.leer })
    mock.timers.tick(5 * 60_000 - 1)
    await buscar({ palabras: 'contrato estatal' }, { leer: p.leer })
    assert.equal(p.estado.idas, 1, 'a 1 ms de vencer sigue guardado')
    mock.timers.tick(2)
    await buscar({ palabras: 'contrato estatal' }, { leer: p.leer })
    assert.equal(p.estado.idas, 2, 'vencido, vuelve a preguntar')
  } finally {
    mock.timers.reset()
  }
})

// --- SUIN ------------------------------------------------------------------

type Doc = { tipo: string; numero: string; anio: string }
const indice = (docs: Doc[]) => async (): Promise<RespuestaFichas> => ({
  hits: { hits: docs.map((d, i) => ({ _source: { id: 900 + i, visualizacion: null, epigrafe: 'x', estado: 'Vigente', ...d } })) },
})

/** Un índice de mentira que cuenta las idas. */
function suin(respuesta: () => Promise<RespuestaFichas>) {
  const estado = { idas: 0 }
  return {
    estado,
    pedirJson: async () => {
      estado.idas += 1
      return respuesta()
    },
  }
}

test('suin: «no consta» se recuerda: una norma posterior a 2020 se pregunta una sola vez', async () => {
  const s = suin(indice([]))
  const a = await ficha('Decreto', '4001', '2023', { pedirJson: s.pedirJson })
  const b = await ficha('Decreto', '4001', '2023', { pedirJson: s.pedirJson })
  assert.equal(a.ok, false)
  assert.deepEqual(b, a, 'devuelve el mismo veredicto, con su explicación')
  assert.equal(s.estado.idas, 1)
})

test('suin: una ficha caída no se recuerda', async () => {
  let vez = 0
  const s = suin(async () => {
    vez += 1
    if (vez === 1) throw new Error('ETIMEDOUT')
    return indice([{ tipo: 'DECRETO', numero: '4002', anio: '2015' }])()
  })
  const a = await ficha('Decreto', '4002', '2015', { pedirJson: s.pedirJson })
  assert.equal(a.ok === false && a.razon, 'ficha-caida')
  const b = await ficha('Decreto', '4002', '2015', { pedirJson: s.pedirJson })
  assert.equal(b.ok, true, 'la segunda vez vuelve a preguntar y encuentra la ficha')
  assert.equal(s.estado.idas, 2)
})

test('suin: «no consta» caduca a los cinco minutos y una ficha, a los treinta', async () => {
  mock.timers.enable({ apis: ['Date'] })
  try {
    const sin = suin(indice([]))
    const con = suin(indice([{ tipo: 'DECRETO', numero: '4004', anio: '2015' }]))
    await ficha('Decreto', '4003', '2015', { pedirJson: sin.pedirJson })
    await ficha('Decreto', '4004', '2015', { pedirJson: con.pedirJson })
    mock.timers.tick(5 * 60_000 + 1)
    await ficha('Decreto', '4003', '2015', { pedirJson: sin.pedirJson })
    await ficha('Decreto', '4004', '2015', { pedirJson: con.pedirJson })
    assert.equal(sin.estado.idas, 2, 'el «no consta» vencido vuelve a preguntar')
    assert.equal(con.estado.idas, 1, 'la ficha sigue guardada a los 5 min')
    mock.timers.tick(25 * 60_000)
    await ficha('Decreto', '4004', '2015', { pedirJson: con.pedirJson })
    assert.equal(con.estado.idas, 2, 'y vence a los 30')
  } finally {
    mock.timers.reset()
  }
})
