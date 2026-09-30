/**
 * Pruebas de consultar_jerarquia: formateo de resultados y aviso de vacío.
 * Sin red: el buscador es inyectado con datos falsos.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { formatear, porGestor, type BuscadorNormas } from '../src/herramientas/consultar_jerarquia.ts'
import { caracterDelNivel, TIPO_GESTOR } from '../src/nucleo/jerarquia.ts'
import type * as gestor from '../src/fuentes/gestor.ts'

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
  const falso: BuscadorNormas = async (nivel, texto, limite) => ({
    items: [{ titulo: `${nivel}: ${texto}`, url: `https://ejemplo.test/${nivel}/${limite}` }],
  })
  const salida = formatear((await falso('decreto', 'teletrabajo', 5)).items, 'decreto', 'teletrabajo')
  assert.ok(salida.includes('- decreto: teletrabajo\n  https://ejemplo.test/decreto/5'))
  assert.ok(salida.includes(`Carácter: ${caracterDelNivel('decreto')}`))
})

// --- D5: cada nivel busca en su tipo del Gestor y comparte el refuerzo por subtema ---

const doc = (id: string, titulo: string) => ({ id, titulo, resumen: '', url: `https://ejemplo.test/norma.php?i=${id}` })
const resultado = (items: ReturnType<typeof doc>[]) => ({ total: items.length, items, aplicados: [] as string[] })

test('cada nivel consulta el tipo del Gestor que nombra; la constitución no cae en «Resolución»', async () => {
  for (const [nivel, tipo] of Object.entries(TIPO_GESTOR)) {
    const filtros: gestor.Filtros[] = []
    const buscar = async (f: gestor.Filtros) => (filtros.push(f), resultado([]))
    await porGestor(nivel as keyof typeof TIPO_GESTOR, 'trabajo', 10, { buscar })
    assert.equal(filtros[0]!.tipo, tipo, `el nivel ${nivel}`)
  }
  assert.equal(TIPO_GESTOR.constitucion, 'Constitución Política')
})

test('el vacío del nivel constitución no dice que el Gestor no la cataloga y remite a resolver_cita', () => {
  const salida = formatear([], 'constitucion', 'zopilote')
  assert.doesNotMatch(salida, /no cataloga/)
  assert.match(salida, /resolver_cita con "art\. N de la Constitución Política"/)
  assert.match(salida, /buscar_jurisprudencia/)
})

test('el nivel concepto reconsulta por el subtema oficial y lo declara', async () => {
  const llamadas: gestor.Filtros[] = []
  const buscar = async (f: gestor.Filtros) => {
    llamadas.push(f)
    return f.subtema
      ? resultado([doc('602731', 'Concepto 602731 de 2025'), doc('2', 'Concepto 2 de 2024')])
      : resultado([doc('9', 'Concepto 9 de 2020')])
  }
  const r = await porGestor('concepto', 'teletrabajo', 10, { buscar, subtemaPorNombre: async () => '38872' })
  assert.equal(llamadas.length, 2)
  assert.equal(llamadas[1]!.tipo, 'Concepto', 'el refuerzo respeta el filtro de tipo')
  assert.equal(llamadas[1]!.subtema, '38872')
  assert.equal(r.items.length, 3)
  assert.match(r.nota!, /Se reconsultó con el subtema/)
  assert.match(formatear(r.items, 'concepto', 'teletrabajo', r.nota), /Se reconsultó con el subtema/)
})

test('un término sin subtema oficial responde solo con palabras y sin aviso de refuerzo', async () => {
  let n = 0
  const buscar = async () => (n++, resultado([doc('9', 'Ley 9 de 2020')]))
  const r = await porGestor('ley', 'zzqxv qqzxx', 10, {
    buscar,
    subtemaPorNombre: async () => assert.fail('no debe consultarse un subtema que el índice no tiene'),
  })
  assert.equal(n, 1)
  assert.equal(r.nota, undefined)
  assert.doesNotMatch(formatear(r.items, 'ley', 'zzqxv qqzxx', r.nota), /reconsultó/)
})
