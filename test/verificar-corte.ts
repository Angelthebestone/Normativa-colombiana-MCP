/**
 * `corte.verificar` guarda sus veredictos firmes cinco minutos: preguntar dos veces
 * por la misma sentencia no vuelve a la relatoría. Sin red: `buscar` se inyecta y
 * cuenta las idas. Cada prueba usa su propia sentencia porque la caché es del proceso.
 */
import { strict as assert } from 'node:assert'
import { mock, test } from 'node:test'
import { type buscar, verificar } from '../src/fuentes/jurisprudencia/corte.ts'

type Buscar = typeof buscar

/** Una relatoría de mentira: contesta con `items` y cuenta cuántas veces la preguntan. */
function relatoria(items: { sentencia: string }[] | Error) {
  const estado = { idas: 0 }
  const buscar = (async () => {
    estado.idas += 1
    if (items instanceof Error) throw items
    return { items }
  }) as unknown as Buscar
  return { estado, buscar }
}

test('una sentencia que existe se pregunta una sola vez', async () => {
  const r = relatoria([{ sentencia: 'C-101/01' }])
  const a = await verificar('C-101/01', { buscar: r.buscar })
  const b = await verificar('C-101/01', { buscar: r.buscar })
  assert.equal(a.estado, 'existe')
  assert.equal(b.estado, 'existe')
  assert.equal(r.estado.idas, 1)
})

test('una inexistente paga sus tres sondeos la primera vez y ninguno la segunda', async () => {
  const r = relatoria([])
  const a = await verificar('C-102/02', { buscar: r.buscar })
  assert.equal(a.estado, 'no-existe')
  assert.equal(r.estado.idas, 3, 'literal, sin guion y «C-102 de 2002»')
  const b = await verificar('C-102/02', { buscar: r.buscar })
  assert.equal(b.estado, 'no-existe')
  assert.deepEqual(b.sondeos, a.sondeos, 'sigue declarando qué se sondeó')
  assert.equal(r.estado.idas, 3)
})

test('un fallo de la fuente no se guarda: un error de red no es un dato', async () => {
  const caida = relatoria(new Error('tiempo de espera agotado'))
  const a = await verificar('C-103/03', { buscar: caida.buscar })
  assert.equal(a.estado, 'no-medido')
  const viva = relatoria([{ sentencia: 'C-103/03' }])
  const b = await verificar('C-103/03', { buscar: viva.buscar })
  assert.equal(b.estado, 'existe', 'la segunda vez vuelve a preguntar')
  assert.equal(viva.estado.idas, 1)
})

test('sentencias distintas no comparten veredicto', async () => {
  const r = relatoria([{ sentencia: 'C-104/04' }])
  await verificar('C-104/04', { buscar: r.buscar })
  const otra = await verificar('C-105/05', { buscar: r.buscar })
  assert.equal(otra.estado, 'no-existe', 'C-105/05 no está entre los items')
  assert.ok(r.estado.idas > 1, 'preguntó por la segunda')
})

test('el veredicto guardado caduca a los cinco minutos', async () => {
  mock.timers.enable({ apis: ['Date'] })
  try {
    const r = relatoria([{ sentencia: 'C-106/06' }])
    await verificar('C-106/06', { buscar: r.buscar })
    mock.timers.tick(5 * 60_000 - 1)
    await verificar('C-106/06', { buscar: r.buscar })
    assert.equal(r.estado.idas, 1, 'a 1 ms de vencer sigue guardado')
    mock.timers.tick(2)
    await verificar('C-106/06', { buscar: r.buscar })
    assert.equal(r.estado.idas, 2, 'vencido, vuelve a preguntar')
  } finally {
    mock.timers.reset()
  }
})
