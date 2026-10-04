/**
 * Lote de citas de validar_cita y de resolver_cita, sin red: `buscar` del
 * Gestor (y, en resolver_cita, la norma y la ficha de SUIN) inyectados.
 *
 *   node --test test/lote-citas.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import type * as gestor from '../src/fuentes/gestor.ts'
import type * as suin from '../src/fuentes/suin.ts'
import * as resolverCita from '../src/herramientas/resolver_cita.ts'
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

// --- resolver_cita: forma de la respuesta, con el Gestor y SUIN inyectados ---

const URL_488 = 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=1001'
const URL_788 = 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=1002'
const URL_624 = 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=6533'

/** Un Gestor de tres normas. El Estatuto Tributario solo aparece sin filtrar por tipo, como en el portal. */
const gestorFalso = (async (f: Parameters<typeof gestor.buscar>[0]) => {
  const items =
    f.numero === '488'
      ? [item('1001', 'Ley 488 de 1998', URL_488)]
      : f.numero === '788'
        ? [item('1002', 'Ley 788 de 2002', URL_788)]
        : f.numero === '624' && !f.tipo
          ? [item('6533', 'Decreto Ley 624 de 1989', URL_624)]
          : []
  return { total: items.length, aplicados: [], items }
}) as typeof gestor.buscar

const TEXTOS: Record<string, string> = {
  '1001': 'Artículo 140. Texto del ciento cuarenta.\n\nArtículo 143. Texto del ciento cuarenta y tres.\n\nArtículo 144. Otro.',
  '1002': 'Artículo 59. Texto del cincuenta y nueve.\n\nArtículo 60. Otro.',
  '6533': 'Artículo 817. Término de prescripción.\n\nArtículo 818. Interrupción.\n\nArtículo 819. Otro.',
}
const deps = {
  buscar: gestorFalso,
  obtenerNorma: (async (id: string | number) => ({ texto: TEXTOS[String(id)] ?? '' })) as unknown as typeof gestor.obtenerNorma,
  fichaSuin: (async () => ({ ok: false, razon: 'no-consta', detalle: '' })) as unknown as typeof suin.ficha,
}

test('resolver_cita en lote: una ficha por norma, en el orden de su primera cita, y un solo alcance', async () => {
  const salida = await resolverCita.escribir(
    { citas: ['art. 140 de la Ley 488 de 1998', 'art. 59 de la Ley 788 de 2002', 'art. 143 de la Ley 488 de 1998'] },
    deps,
  )
  assert.equal(salida.match(/^Alcance:/gm)?.length, 1)
  assert.equal(salida.match(/^id: /gm)?.length, 2)
  // La Ley 488 se citó primero: su bloque, con el 140 y el 143, va antes que el de la Ley 788.
  const ley488 = salida.indexOf('id: 1001')
  const ley788 = salida.indexOf('id: 1002')
  assert.ok(ley488 < salida.indexOf('--- Artículo 140 ---'))
  assert.ok(salida.indexOf('--- Artículo 140 ---') < salida.indexOf('--- Artículo 143 ---'))
  assert.ok(salida.indexOf('--- Artículo 143 ---') < ley788)
  assert.ok(ley788 < salida.indexOf('--- Artículo 59 ---'))
  // Quien citó cada artículo reconoce su cita bajo el título de la norma.
  assert.match(salida, /### Ley 488 de 1998\nCitas: art\. 140 de la Ley 488 de 1998; art\. 143 de la Ley 488 de 1998/)
  assert.match(salida, /### art\. 59 de la Ley 788 de 2002\n/)
  // La URL de la norma va en la ficha, una vez, y no se repite por artículo.
  for (const url of [URL_488, URL_788]) assert.equal(salida.split(url).length - 1, 1, url)
})

test('resolver_cita en lote: una cita que no resuelve tiene su bloque y no rompe la agrupación', async () => {
  const salida = await resolverCita.escribir(
    { citas: ['art. 140 de la Ley 488 de 1998', 'esto no es una cita', 'art. 143 de la Ley 488 de 1998'] },
    deps,
  )
  assert.match(salida, /### esto no es una cita\nNo encontré una cita normativa/)
  assert.equal(salida.match(/^id: 1001$/gm)?.length, 1)
  assert.equal(salida.match(/^Alcance:/gm)?.length, 1)
})

test('Estatuto Tributario: se rotula con su tipo oficial y no se corrige un tipo que el usuario no escribió', async () => {
  const porNombre = await resolverCita.escribir(
    { citas: ['art. 817 del Estatuto Tributario', 'art. 818 del Estatuto Tributario'] },
    deps,
  )
  assert.doesNotMatch(porNombre, /No existe un/)
  assert.equal(porNombre.match(/se cita aquí como Decreto Ley 624 de 1989,/g)?.length, 1)
  assert.match(porNombre, /--- Artículo 817 ---/)
  assert.match(porNombre, /--- Artículo 818 ---/)

  const escrito = await resolverCita.escribir({ cita: 'Decreto 624 de 1989' }, deps)
  assert.match(escrito, /No existe un «decreto 624 de 1989»; el tipo oficial es «Decreto Ley»/)
})
