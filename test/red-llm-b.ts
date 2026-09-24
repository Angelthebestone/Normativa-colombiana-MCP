/**
 * Casos del AGENTE B sobre el arnés de fallos de LLM (`test/red-llm.ts`):
 *
 *  1. Una cita de sentencia inexistente produce negativa dura, no un fallo de
 *     fuente (familia 1, clase `inexistente`): "no existe" y "la fuente falló"
 *     son estados distintos.
 *  2. Alcance declarado (regla 5): la respuesta dice DELANTE qué fuente
 *     consultó y cuál no, y la regla del arnés no encuentra nada que reprochar.
 *
 * La identidad de la ficha de SUIN (que "Decreto 1235 de 2023" no se sirva con
 * la de 1952) se prueba sin red en `test/suin-vigencia-decretos.ts`.
 *
 *   node --test test/red-llm-b.ts      (con SIN_RED=1 se saltan los casos de red)
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { escribir } from '../src/herramientas/consultar_vigencia.ts'
import { LENTO } from './red.ts'
import { problemasFamilia1, reglasQueFalla } from './red-llm.ts'

// --- 1. sentencia inexistente: negativa dura (red) ------------------------

test('sentencia inexistente: negativa dura, nunca un fallo de fuente', LENTO, async () => {
  const texto = await escribir({ cita: 'C-377 de 2000' })

  const problemas = problemasFamilia1(
    { texto, esError: false },
    { tool: 'consultar_vigencia', args: { cita: 'C-377 de 2000' }, motivo: 'cita con forma correcta, inexistente', clase: 'inexistente' },
  )
  assert.deepEqual(problemas, [], problemas.join('; '))
  assert.match(texto, /no tiene ninguna providencia con el n[úu]mero C-377\/00/i)
  assert.doesNotMatch(texto, /no consta|ficha ca[ií]da|no respondi[oó]/i)
})

test('sentencia real: existe y no se le inventa un estado de vigencia', LENTO, async () => {
  const texto = await escribir({ cita: 'C-337 de 2011' })
  assert.match(texto, /Estado: Existe/)
  assert.match(texto, /Confianza: alta/)
  assert.match(texto, /^URL: https:\/\//m)
  assert.doesNotMatch(texto, /\bvigente\b/i, 'una providencia no tiene estado de vigencia')
})

// --- 2. alcance declarado: delante y verdadero ----------------------------

test('alcance declarado: cada rama declara sus fuentes y las que no tocó', LENTO, async () => {
  // Rama de sentencia: solo la relatoría, y el Gestor declarado fuera.
  const sentencia = await escribir({ cita: 'C-337 de 2011' })
  assert.match(sentencia, /^Alcance: consulté Corte Constitucional/)
  assert.match(sentencia, /NO consulté Gestor/)
  assert.deepEqual(
    reglasQueFalla(sentencia, { pedido: 'C-337 de 2011', fuente: 'Corte Constitucional' }).filter((f) => f.id === 5),
    [],
  )

  // Rama de norma: Gestor + SUIN, y la Corte declarada fuera.
  const decreto = await escribir({ cita: 'Decreto 1235 de 2023' })
  assert.match(decreto, /^Alcance: consulté Gestor Normativo \(/)
  assert.match(decreto, /, SUIN-Juriscol \(/)
  assert.match(decreto, /NO consulté Corte Constitucional/)
  assert.deepEqual(
    reglasQueFalla(decreto, { pedido: 'Decreto 1235 de 2023', fuente: 'SUIN-Juriscol' }).filter((f) => f.id === 5),
    [],
  )
})

// --- 3. la relatoría caída degrada (va al final: marca el host como caído) ----

test('relatoría caída: degrada diciendo que no respondió, sin negar la existencia', LENTO, async () => {
  process.env['TTL_COPIA_MS'] = '0'
  process.env['FUENTE_CAIDA'] = 'www.corteconstitucional.gov.co'
  try {
    const texto = await escribir({ cita: 'T-7077 de 2024' })
    assert.match(texto, /no respondi[oó]/i)
    assert.match(texto, /Confianza: baja/)
    assert.doesNotMatch(texto, /Estado: No existe/)
  } finally {
    delete process.env['FUENTE_CAIDA']
    delete process.env['TTL_COPIA_MS']
  }
})
