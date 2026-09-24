/**
 * Casos del AGENTE C sobre el arnés de fallos de LLM (`test/red-llm.ts`):
 * resolver una cita de la Corte por su número contra la relatoría real.
 *
 * El fallo de campo que los motiva: `porSentencia('SU-371/21')` devolvía null
 * aunque la sentencia existe, porque la relatoría la guarda como `SU.371/21` y
 * solo se indexa sin el guion. Estos casos fijan que `verificar` distingue
 * "existe", "no-existe" y "no-medido", y que no gasta la segunda llamada cuando
 * la primera ya da el acierto exacto.
 *
 *   npm run build && node --test --test-force-exit test/red-llm-c.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { LENTO } from './red.ts'
import { porSentencia, verificar } from '../src/fuentes/jurisprudencia/corte.ts'

test('verificar distingue existe y ahorra el segundo sondeo cuando el primero basta', LENTO, async () => {
  // Las SU solo casan sin el guion: la forma literal falla y hay que probar la segunda.
  const su = await verificar('SU-371/21')
  assert.equal(su.estado, 'existe', `SU-371/21 existe en la relatoría: ${JSON.stringify(su)}`)
  assert.equal(su.sondeos.length, 2, `la SU exige las dos formas medidas (2026-09-16): ${su.sondeos.join(', ')}`)
  assert.equal(su.providencia?.ruta, '2021/SU371-21.htm', 'la identidad normaliza el punto y el guion')

  // Las C y las T casan con el guion: un solo sondeo, sin gastar la segunda llamada.
  for (const cita of ['T-099/24', 'C-337/11', 'T-015/22']) {
    const r = await verificar(cita)
    assert.equal(r.estado, 'existe', `${cita} existe: ${JSON.stringify(r)}`)
    assert.deepEqual(r.sondeos, [cita], `${cita} no debe gastar el sondeo sin guion: ${r.sondeos.join(', ')}`)
  }
})

test('un número inventado da no-existe, no error ni motivo', LENTO, async () => {
  for (const cita of ['C-9999/99', 'T-88888/99', 'SU-777/99']) {
    const r = await verificar(cita)
    assert.equal(r.estado, 'no-existe', `${cita} no aparece al buscar por su número: ${JSON.stringify(r)}`)
    assert.equal(r.motivo, undefined, 'no-existe no es un fallo de fuente: no lleva motivo')
  }
})

test('un fallo de red es no-medido con motivo, nunca no-existe', LENTO, async () => {
  // Seam de diagnóstico del propio MCP: marca el host como caído sin tocar la red.
  process.env['FUENTE_CAIDA'] = 'www.corteconstitucional.gov.co'
  try {
    const r = await verificar('T-099/24')
    assert.equal(r.estado, 'no-medido', `una fuente caída no puede leerse como "no existe": ${JSON.stringify(r)}`)
    assert.ok(r.motivo, 'no-medido tiene que declarar el motivo')
  } finally {
    delete process.env['FUENTE_CAIDA']
  }
})

test('porSentencia normaliza el separador y sigue devolviendo null cuando no aparece', LENTO, async () => {
  assert.equal((await porSentencia('SU-371/21'))?.sentencia, 'SU.371/21', 'SU.371/21 debe casar con SU-371/21')
  assert.equal(await porSentencia('C-9999/99'), null, 'un número inventado no es una providencia')
})
