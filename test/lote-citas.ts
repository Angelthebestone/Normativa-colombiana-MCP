/**
 * Lote de citas de validar_cita, sin red: `buscar` del Gestor inyectado.
 *
 *   node --test test/lote-citas.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import * as validar from '../src/herramientas/validar_cita.ts'
import type { Resultado } from '../src/nucleo/parse.ts'

const item = (id: string, titulo: string, url: string): Resultado => ({ id, titulo, resumen: '', url })

/** `buscar` del Gestor que reconoce dos leyes conocidas y nada más. */
const buscar = (async (f: Parameters<typeof import('../src/fuentes/gestor.ts')['buscar']>[0]) => {
  if (f.numero === '909') {
    return {
      total: 1,
      aplicados: [],
      items: [item('31431', 'Ley 909 de 2004', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=31431')],
    }
  }
  if (f.numero === '1221') {
    return {
      total: 1,
      aplicados: [],
      items: [item('62866', 'Ley 1221 de 2008', 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=62866')],
    }
  }
  return { total: 0, aplicados: [], items: [] }
}) as typeof import('../src/fuentes/gestor.ts')['buscar']

test('la cita singular sigue funcionando', async () => {
  const salida = await validar.escribir({ cita: 'Ley 909 de 2004' }, { buscar })
  assert.ok(salida.includes('Resultado: cita validada'))
  assert.ok(salida.includes('número y año: ✓'))
  assert.ok(salida.includes('https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=31431'))
})

test('lote: las válidas se resuelven y la inválida se marca con el aviso de forma, sin tumbar el lote', async () => {
  const salida = await validar.escribir(
    { citas: ['Ley 909 de 2004', 'esto no es una cita', 'Ley 1221 de 2008'] },
    { buscar },
  )
  assert.ok(salida.includes('### Ley 909 de 2004'))
  assert.ok(salida.includes('### Ley 1221 de 2008'))
  const invalida = salida.slice(salida.indexOf('### esto no es una cita'), salida.indexOf('### Ley 1221 de 2008'))
  assert.ok(invalida.includes('no tiene forma de cita colombiana'))
})

test('lote: cada bloque trae su veredicto y su enlace', async () => {
  const salida = await validar.escribir({ citas: ['Ley 909 de 2004', 'Ley 1221 de 2008'] }, { buscar })
  const bloques = salida.split('\n\n')
  assert.equal(bloques.length, 2)
  for (const bloque of bloques) {
    assert.ok(bloque.includes('Resultado:'))
    assert.ok(bloque.includes('Enlace: https://www.funcionpublica.gov.co'))
  }
})

test('lote: una cita cuya fuente falla se anota en su bloque y el lote no revienta', async () => {
  const caido = (async () => {
    throw new Error('connection reset')
  }) as typeof import('../src/fuentes/gestor.ts')['buscar']
  const salida = await validar.escribir(
    { citas: ['Ley 909 de 2004', 'esto no es una cita', 'Ley 1221 de 2008'] },
    { buscar: caido },
  )
  assert.ok(salida.includes('no tiene forma de cita colombiana'))
  assert.ok(salida.includes('la fuente no respondió en esta consulta'))
  assert.ok(salida.includes('### Ley 909 de 2004'))
})
