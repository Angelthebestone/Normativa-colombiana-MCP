/**
 * Vigencia de decretos por ficha directa (sin índice): distingue índice
 * ausente / ficha caída / no consta y cachea. Se prueba con dependencias
 * inyectadas (buscar/pedir falsos) para no depender de la red ni del estado
 * del índice real: cada caso controla qué devuelve el buscador y la ficha.
 *
 * Cada test usa un número de decreto DISTINTO para no colisionar con la cache
 * de 30 min que comparte el módulo.
 *
 *   node --test test/suin-vigencia-decretos.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { fichaDirectaDecreto } from '../src/fuentes/suin.ts'
import type { ResultadoSuin } from '../src/fuentes/suin.ts'
import type { pedir as pedirHttp, Respuesta } from '../src/nucleo/http.ts'

function fichaHtml(estado = 'Vigente'): string {
  return (
    '<span field="tipo">DECRETO</span><span field="numero">1072</span><span field="anio">2015</span>' +
    `<span field="epigrafe">Único Reglamentario del Sector Trabajo</span><span field="estado_documento">${estado}</span>`
  )
}

const URL_FICHA = 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=999'

type Deps = {
  buscar: (typeof import('../src/fuentes/suin.ts'))['buscar']
  pedir: typeof pedirHttp
}

function itemSuin(titulo: string, url: string): ResultadoSuin {
  return { id: '999', titulo, subtipo: 'Decreto', epigrafe: '', vigencia: '', entidad: '', url }
}

function respuesta(status: number, cuerpo: string): Respuesta {
  return { status, cuerpo, cookies: '', cabeceras: {} }
}

/** Dependencias falsas: el buscador devuelve el decreto y la ficha responde. */
function deps(sobre: {
  buscar?: Deps['buscar']
  pedir?: Deps['pedir']
}): Deps {
  return {
    buscar: sobre.buscar ??
      (async (_opts: Parameters<Deps['buscar']>[0]) => ({
        total: 1,
        items: [itemSuin('Decreto 1072 de 2015', URL_FICHA)],
      })) as Deps['buscar'],
    pedir: sobre.pedir ??
      (async (_url: string, _timeout?: number) => respuesta(200, fichaHtml())) as Deps['pedir'],
  }
}

test('fichaDirectaDecreto: con ficha disponible devuelve el estado y cachea', async () => {
  let busquedas = 0
  let fichas = 0
  const d = deps({
    buscar: (async (_opts) => {
      busquedas++
      return { total: 1, items: [itemSuin('Decreto 1101 de 2015', URL_FICHA)] }
    }) as Deps['buscar'],
    pedir: (async (_url, _timeout) => {
      fichas++
      return respuesta(200, fichaHtml('Vigente'))
    }) as Deps['pedir'],
  })

  const a = await fichaDirectaDecreto('Decreto', '1101', '2015', d)
  assert.equal(a.ok, true)
  if (a.ok) {
    assert.equal(a.vigencia.estado, 'Vigente')
    assert.equal(a.vigencia.url, URL_FICHA)
  }

  // Segunda llamada en <30 min: cache, sin fetch nuevo.
  const b = await fichaDirectaDecreto('Decreto', '1101', '2015', d)
  assert.equal(b.ok, true)
  assert.equal(busquedas, 1, 'la cache debería evitar la segunda búsqueda')
  assert.equal(fichas, 1, 'la cache debería evitar la segunda ficha')
})

test('fichaDirectaDecreto: si el buscador no halla el decreto, es no-consta', async () => {
  const d = deps({
    buscar: (async (_opts) => ({ total: 0, items: [] })) as Deps['buscar'],
  })
  const r = await fichaDirectaDecreto('Decreto', '99999998', '1999', d)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.razon, 'no-consta')
})

test('fichaDirectaDecreto: ficha 404 se distingue de ficha caída (red)', async () => {
  const d = deps({
    pedir: (async (_url, _timeout) => respuesta(404, '')) as Deps['pedir'],
  })
  const r = await fichaDirectaDecreto('Decreto', '1102', '2015', d)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.razon, 'ficha-caida')
})

test('fichaDirectaDecreto: una ficha sin el bloque de campos es no-consta', async () => {
  const d = deps({
    pedir: (async (_url, _timeout) => respuesta(200, '<html>página sin campos</html>')) as Deps['pedir'],
  })
  const r = await fichaDirectaDecreto('Decreto', '1103', '2015', d)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.razon, 'no-consta')
})

test('fichaDirectaDecreto: un enlace que no es la ficha esperada es no-consta', async () => {
  const d = deps({
    buscar: (async (_opts) => ({
      total: 1,
      items: [itemSuin('Decreto 1104 de 2015', 'https://otro.sitio.gov.co/x')],
    })) as Deps['buscar'],
  })
  const r = await fichaDirectaDecreto('Decreto', '1104', '2015', d)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.razon, 'no-consta')
})

test('fichaDirectaDecreto: un decreto que el índice no cubre y sin buscador es no-consta', async () => {
  const d = deps({
    buscar: (async (_opts) => ({ total: 0, items: [] })) as Deps['buscar'],
  })
  const r = await fichaDirectaDecreto('Decreto', '1105', '2015', d)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.razon, 'no-consta')
})
