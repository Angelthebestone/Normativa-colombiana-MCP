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

test('fuentesDe: perfil salud añade INVIMA y Supersalud; mineria añade ANM', () => {
  assert.deepEqual(fuentesDe('salud', undefined), ['gestor', 'corte', 'suin', 'invima', 'supersalud'])
  assert.deepEqual(fuentesDe('mineria', undefined), ['gestor', 'corte', 'suin', 'anm'])
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

/** Mapa de fuentes completo para los tests (7 claves), todas inyectadas. */
function porFuenteBase(): Record<string, (texto: string, limite: number) => Promise<Item[]>> {
  return {
    gestor: async () => [],
    corte: async () => [],
    suin: async () => [],
    dian: async () => [],
    invima: async () => [],
    supersalud: async () => [],
    anm: async () => [],
  }
}

test('escribir: una fuente que falla (503) se declara como fallo, no como vacío', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => {
    throw new Error('503')
  }
  porFuente['corte'] = async () => [item('corte-constitucional', 'T-1/24')]
  const r = await escribir({ texto: 'x', limite: 5 }, { porFuente })
  assert.match(r, /T-1\/24/)
  // La fuente caída se declara aparte con su mensaje: ya no se mezcla con los vacíos.
  assert.match(r, /No se pudo consultar: gestor \(503\)/)
  assert.match(r, /es un FALLO de la fuente, no un vacío/)
  // Sin perfil no se consulta DIAN, así que el vacío solo lista las consultadas que respondieron.
  assert.match(r, /Sin resultados en: suin/)
  assert.doesNotMatch(r, /Sin resultados en: gestor/)
})

test('formatear: distingue "respondió sin nada" de "no se pudo consultar"', () => {
  const r = { gestor: [], corte: [item('corte', 'T-1/24')], suin: [] }
  const txt = formatear(r, 'tutela', undefined, { gestor: 'unable to verify the first certificate' })
  assert.match(txt, /Sin resultados en: suin \(respondieron sin nada\)/)
  assert.doesNotMatch(txt, /Sin resultados en: gestor/)
  assert.match(txt, /No se pudo consultar: gestor \(unable to verify the first certificate\)/)
  assert.match(txt, /no concluyas que no hay resultados ahí/)
})

test('escribir: una fuente que rinde 0 se reporta como hueco, no como fallo', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => [item('gestor', 'Ley 1')]
  const r = await escribir({ texto: 'teletrabajo', limite: 5 }, { porFuente })
  assert.match(r, /\[gestor\] Ley 1/)
  assert.match(r, /Sin resultados en: corte, suin/)
})

test('escribir: un filtro de fuentes solo consulta esas', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => {
    throw new Error('gestor no debería consultarse')
  }
  porFuente['corte'] = async () => [item('corte-constitucional', 'T-1/24')]
  porFuente['suin'] = async () => {
    throw new Error('suin no debería consultarse')
  }
  porFuente['dian'] = async () => {
    throw new Error('dian no debería consultarse')
  }
  const r = await escribir({ texto: 'x', fuentes: ['corte'], limite: 5 }, { porFuente })
  assert.match(r, /T-1\/24/)
  // Con filtro explícito no se reportan vacíos de fuentes no consultadas.
  assert.doesNotMatch(r, /Sin resultados en: gestor/)
})

test('escribir: perfil salud consulta INVIMA y Supersalud y declara sus vacíos', async () => {
  const porFuente = porFuenteBase()
  porFuente['invima'] = async () => [item('invima', 'Resolución 1')]
  const r = await escribir({ texto: 'medicamentos', perfil: 'salud', limite: 5 }, { porFuente })
  assert.match(r, /\[invima\] Resolución 1/)
  // Las fuentes del perfil salud que rindieron 0 se declaran (gestor, corte, suin, supersalud).
  assert.match(r, /Sin resultados en: gestor, corte, suin, supersalud/)
})

test('escribir: perfil desconocido devuelve la lista de admitidos sin consultar nada', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => {
    throw new Error('no debería consultarse')
  }
  const r = await escribir({ texto: 'x', perfil: 'no-existe' as never, limite: 5 }, { porFuente })
  assert.match(r, /No existe el perfil "no-existe"/)
  assert.match(r, /salud, mineria/)
})
