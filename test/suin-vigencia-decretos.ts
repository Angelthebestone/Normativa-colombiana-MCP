/**
 * La ficha de SUIN por tipo, número y año (`ficha`): distingue ficha / no
 * consta / ficha caída, comprueba la identidad y cachea. Se prueba con el
 * índice inyectado para no depender de la red: cada caso controla qué devuelve.
 *
 * Cada test usa un número DISTINTO para no colisionar con la caché de 30 min
 * que comparte el módulo.
 *
 *   node --test test/suin-vigencia-decretos.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { ficha, type RespuestaFichas } from '../src/fuentes/suin.ts'

type Doc = { tipo: string; subtipo?: string; numero: string; anio: string; estado?: string; id?: number; visualizacion?: number }

/** Una respuesta del índice con esos documentos, en la forma real de Elasticsearch. */
const indice = (docs: Doc[]) => async (): Promise<RespuestaFichas> => ({
  hits: { hits: docs.map((d, i) => ({ _source: { id: d.id ?? 900 + i, visualizacion: d.visualizacion ?? null, epigrafe: 'x', estado: 'Vigente', ...d } })) },
})

test('con ficha devuelve el estado con el id clásico y cachea', async () => {
  let consultas = 0
  const d = {
    pedirJson: async () => {
      consultas++
      return indice([{ tipo: 'DECRETO', subtipo: 'DECRETO ÚNICO', numero: '1101', anio: '2015', id: 30036079, visualizacion: 30036080 }])()
    },
  }
  const a = await ficha('Decreto', '1101', '2015', d)
  assert.equal(a.ok, true)
  if (a.ok) {
    assert.equal(a.ficha.estado, 'Vigente')
    // El id del índice nuevo difiere del clásico: el enlace lleva el clásico.
    assert.equal(a.ficha.url, 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=30036080')
  }
  const b = await ficha('Decreto', '1101', '2015', d)
  assert.equal(b.ok, true)
  assert.equal(consultas, 1, 'la caché debería evitar la segunda consulta')
})

test('identidad: número y año ajenos no casan aunque el índice los devuelva', async () => {
  // Lo que devolvía el buscador viejo para "Decreto 1235 de 2023".
  const trampas = indice([
    { tipo: 'DECRETO', numero: '1235', anio: '1952' },
    { tipo: 'DECRETO', numero: '1235', anio: '1982' },
    { tipo: 'DECRETO', numero: '2023', anio: '1952' },
  ])
  const r = await ficha('Decreto', '1235', '2023', { pedirJson: trampas })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.razon, 'no-consta')
})

test('identidad: el tipo pedido casa con el tipo o el subtipo, y la ley no casa con un decreto ley', async () => {
  const decretoLey = indice([{ tipo: 'DECRETO', subtipo: 'DECRETO LEY', numero: '1238', anio: '2015' }])
  assert.equal((await ficha('decreto ley', '1238', '2015', { pedirJson: decretoLey })).ok, true)
  // Los decretos de un año comparten numeración: "Decreto 1239" es ese documento.
  const otro = indice([{ tipo: 'DECRETO', subtipo: 'DECRETO LEY', numero: '1239', anio: '2015' }])
  assert.equal((await ficha('Decreto', '01239', '2015', { pedirJson: otro })).ok, true)
  const ley = indice([{ tipo: 'DECRETO', subtipo: 'DECRETO LEY', numero: '1240', anio: '2015' }])
  assert.equal((await ficha('Ley', '1240', '2015', { pedirJson: ley })).ok, false)
})

test('sin resultados es no-consta, y después de 2020 dice que el índice no llega', async () => {
  const vacio = indice([])
  const viejo = await ficha('Decreto', '1102', '2015', { pedirJson: vacio })
  assert.deepEqual(viejo, { ok: false, razon: 'no-consta' })
  const reciente = await ficha('Decreto', '1103', '2023', { pedirJson: vacio })
  assert.equal(reciente.ok, false)
  if (!reciente.ok) {
    assert.equal(reciente.razon, 'no-consta')
    assert.match(reciente.detalle ?? '', /llega hasta 2020/)
  }
})

test('red caída o respuesta con otra forma es ficha-caida con el motivo, nunca no-consta', async () => {
  const caida = await ficha('Decreto', '1104', '2015', {
    pedirJson: async () => {
      throw new Error('ETIMEDOUT')
    },
  })
  assert.deepEqual(caida, { ok: false, razon: 'ficha-caida', detalle: 'ETIMEDOUT' })
  // Un portal cambiado no puede leerse como "SUIN no tiene esa norma".
  const cambiada = await ficha('Decreto', '1105', '2015', { pedirJson: async () => ({}) })
  assert.equal(cambiada.ok, false)
  if (!cambiada.ok) assert.equal(cambiada.razon, 'ficha-caida')
})
