/**
 * Pruebas de consultar_jerarquia: formateo de resultados y aviso de vacío.
 * Sin red: el buscador es inyectado con datos falsos.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { formatear, type BuscadorNormas } from '../src/herramientas/consultar_jerarquia.ts'
import { caracterDelNivel } from '../src/jerarquia.ts'

test('formatear con 2 items incluye el carácter del nivel y sus URLs', () => {
  const items = [
    { titulo: 'Ley 909 de 2004', url: 'https://www.funcionpublica.gov.co/norma.php?i=31431' },
    { titulo: 'Decreto 1083 de 2015', url: 'https://www.funcionpublica.gov.co/norma.php?i=62866' },
  ]
  const salida = formatear(items, 'ley', 'servicio público')
  assert.ok(salida.includes('- Ley 909 de 2004\n  https://www.funcionpublica.gov.co/norma.php?i=31431'))
  assert.ok(salida.includes('- Decreto 1083 de 2015'))
  assert.ok(salida.includes(`Carácter: ${caracterDelNivel('ley')}`))
  assert.ok(salida.includes('Esto no es asesoría jurídica; verifica en el enlace antes de actuar.'))
})

test('formatear con 0 items devuelve el aviso de vacío sin inventar resultados', () => {
  const salida = formatear([], 'concepto', 'zopilote')
  assert.ok(salida.includes('No encontré nada de nivel concepto para "zopilote" en las fuentes consultadas.'))
  assert.ok(salida.includes('buscar_por_tema'))
  assert.ok(!salida.includes('- '))
})

test('buscar con buscador inyectado devuelve los items del nivel pedido', async () => {
  const falso: BuscadorNormas = async (nivel, texto, limite) => [
    { titulo: `${nivel}: ${texto}`, url: `https://ejemplo.test/${nivel}/${limite}` },
  ]
  const salida = formatear(await falso('decreto', 'teletrabajo', 5), 'decreto', 'teletrabajo')
  assert.ok(salida.includes('- decreto: teletrabajo\n  https://ejemplo.test/decreto/5'))
  assert.ok(salida.includes(`Carácter: ${caracterDelNivel('decreto')}`))
})
