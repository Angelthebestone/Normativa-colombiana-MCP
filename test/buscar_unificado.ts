/**
 * Búsqueda federada `buscar_unificado`: fan-out con atribución, perfil
 * tributario que prioriza DIAN, fuente explícita, y degradación cuando una
 * fuente rinde 0 o se cae. Se prueba con el mapa de fuentes inyectado, sin red.
 *
 *   node --test test/buscar_unificado.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { escribir, formatear, fuentesDe } from '../src/herramientas/buscar_unificado.ts'
import type { Item } from '../src/herramientas/buscar_unificado.ts'

const item = (fuente: string, titulo: string): Item => ({ fuente, titulo, url: `https://${fuente}.gov.co/${titulo}` })

test('fuentesDe: sin perfil ni fuentes consulta Gestor, Corte y SUIN (sin DIAN)', () => {
  assert.deepEqual(fuentesDe(undefined, undefined), ['gestor', 'corte', 'suin'])
})

test('fuentesDe: perfil tributario añade DIAN', () => {
  assert.deepEqual(fuentesDe('tributario', undefined), ['gestor', 'corte', 'suin', 'dian'])
})

test('fuentesDe: un filtro explícito gana a todo', () => {
  assert.deepEqual(fuentesDe(undefined, ['corte']), ['corte'])
})

test('formatear: sin perfil ordena Gestor → Corte → SUIN y atribuye cada item', () => {
  const r = {
    gestor: [item('gestor', 'Ley 1')],
    corte: [item('corte-constitucional', 'T-1/24')],
    suin: [item('suin', 'Dec 2')],
    dian: [],
  }
  const txt = formatear(r, 'teletrabajo')
  assert.match(txt, /Resultados para "teletrabajo"/)
  // El orden de presentación pone Gestor primero, luego Corte, luego SUIN.
  const iGestor = txt.indexOf('[gestor]')
  const iCorte = txt.indexOf('[corte-constitucional]')
  const iSuin = txt.indexOf('[suin]')
  assert.ok(iGestor < iCorte && iCorte < iSuin, 'el orden de presentación no se respeta')
  assert.match(txt, /\[gestor\] Ley 1/)
  assert.match(txt, /\[suin\] Dec 2/)
})

test('formatear: perfil tributario prioriza DIAN', () => {
  const r = {
    gestor: [item('gestor', 'Ley')],
    corte: [],
    suin: [],
    dian: [item('dian', 'Concepto')],
  }
  const txt = formatear(r, 'retención', 'tributario')
  assert.ok(txt.indexOf('dian') < txt.indexOf('gestor'), 'con perfil tributario la DIAN va primero')
})

test('formatear: un vacío se explica por fuente y no concluye inexistencia', () => {
  const r = { gestor: [], corte: [item('corte', 'T-1/24')], suin: [], dian: [] }
  const txt = formatear(r, 'teletrabajo')
  assert.match(txt, /Sin resultados en: gestor, suin, dian/)
  assert.match(txt, /NO significa que la norma no exista/)
})

test('escribir: una fuente que falla (503) no tumba el resto', async () => {
  const r = await escribir(
    { texto: 'x', limite: 5 },
    {
      porFuente: {
        gestor: async () => {
          throw new Error('503')
        },
        corte: async () => [item('corte-constitucional', 'T-1/24')],
        suin: async () => [],
        dian: async () => [],
      },
    },
  )
  assert.match(r, /T-1\/24/)
  // Sin perfil no se consulta DIAN, así que el vacío solo lista las consultadas.
  assert.match(r, /Sin resultados en: gestor, suin/)
})

test('escribir: una fuente que rinde 0 se reporta como hueco, no como fallo', async () => {
  const r = await escribir(
    { texto: 'teletrabajo', limite: 5 },
    {
      porFuente: {
        gestor: async () => [item('gestor', 'Ley 1')],
        corte: async () => [],
        suin: async () => [],
        dian: async () => [],
      },
    },
  )
  assert.match(r, /\[gestor\] Ley 1/)
  assert.match(r, /Sin resultados en: corte, suin/)
})

test('escribir: un filtro de fuentes solo consulta esas', async () => {
  const r = await escribir(
    { texto: 'x', fuentes: ['corte'], limite: 5 },
    {
      porFuente: {
        gestor: async () => {
          throw new Error('gestor no debería consultarse')
        },
        corte: async () => [item('corte-constitucional', 'T-1/24')],
        suin: async () => {
          throw new Error('suin no debería consultarse')
        },
        dian: async () => {
          throw new Error('dian no debería consultarse')
        },
      },
    },
  )
  assert.match(r, /T-1\/24/)
  // Con filtro explícito no se reportan vacíos de fuentes no consultadas.
  assert.doesNotMatch(r, /Sin resultados en: gestor/)
})
