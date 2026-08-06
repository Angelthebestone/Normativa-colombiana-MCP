/**
 * Pruebas de formatear() de consultar_perfil, sin red: `escribir()` consulta
 * portales reales a través de perfil().consultar y no se llama aquí.
 *
 *   node --test test/consultar_perfil.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { formatear } from '../src/herramientas/consultar_perfil.ts'

test('perfil desconocido: dice que no existe y lista los disponibles', () => {
  const r = formatear('no-existe', ['laboral', 'energia'], null, '', '', '')
  assert.match(r, /No existe un perfil llamado "no-existe"/)
  assert.match(r, /laboral/)
  assert.match(r, /energia/)
})

test('perfil conocido: el texto del resultado y la advertencia, con el descargo', () => {
  const r = formatear(
    'laboral',
    ['laboral', 'energia'],
    '- Ley 1221 de 2008\n  https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=36885',
    'Normativa laboral',
    'Derecho laboral y seguridad social',
    'El Gestor no publica vigencia; para el estado de una norma usa resolver_cita.',
  )
  assert.match(r, /Ley 1221 de 2008/)
  assert.match(r, /Advertencia: El Gestor no publica vigencia/)
  assert.match(r, /no es asesoría jurídica/)
})

test('perfil conocido sin resultados: la advertencia y el descargo siguen presentes', () => {
  const r = formatear('energia', ['laboral', 'energia'], '', 'Energía y gas', 'Energía y gas (CREG, UPME, ANH)', 'la CREG compila')
  assert.match(r, /Perfil: Energía y gas — Energía y gas \(CREG, UPME, ANH\)/)
  assert.match(r, /Advertencia: la CREG compila/)
  assert.match(r, /no es asesoría jurídica/)
})
