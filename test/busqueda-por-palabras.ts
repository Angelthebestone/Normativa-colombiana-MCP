/**
 * Búsqueda por palabras: combinación de términos (OR del portal frente a
 * filtro local AND), stopwords compartidas, fallback de SUIN al buscador vivo
 * y expansión de abreviaturas jurídicas. Sin red: todas las fuentes son falsas.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { contienenTodos, quitarStopwords } from '../src/fuentes/gestor.ts'
import type { Resultado } from '../src/nucleo/parse.ts'
import { contienenTodas, type Providencia } from '../src/fuentes/jurisprudencia/consejoestado.ts'
import { buscarEnIndice, buscarEnSuin, type ResultadoSuin } from '../src/fuentes/suin.ts'
import { conAlternativas, desarrollarAbreviaturas } from '../src/nucleo/alternativas.ts'

function resultado(titulo: string, resumen = ''): Resultado {
  return { id: String(Math.random()), titulo, resumen, url: `https://x/${Math.random()}` }
}

function providencia(problema: string, respuesta = ''): Providencia {
  return {
    radicado: String(Math.random()).slice(2, 12),
    fecha: '2024-01-01',
    ponente: 'P',
    sala: 'S',
    clase: 'Nulidad',
    actor: 'A',
    demandado: 'D',
    titulaciones: [{ problema, respuesta, nota: '' }],
    url: 'https://samai/fichero',
    token: 'token',
  }
}

test('el filtro AND local del Gestor mantiene solo los que tienen TODOS los términos', () => {
  const items = [
    resultado('Ley 1221 de 2008', 'Por la cual se establecen normas para promover el teletrabajo'),
    resultado('Resolución 2341', 'Sobre el teletrabajo en el sector público'),
    resultado('Decreto 884 de 2012', 'Se reglamenta la Ley 1221'),
    resultado('Ley 909 de 2004', 'Empleo público, carrera administrativa'),
  ]
  const r = contienenTodos(items, 'teletrabajo ley 1221')
  assert.equal(r.exigidos.length, 3) // las vacías no se exigen
  assert.deepEqual(r.items.map((i) => i.id), [items[0]!.id])
  assert.equal(r.omitidos, 3)
})

test('el filtro AND no descarta cuando hay una sola palabra significativa', () => {
  const items = [resultado('Ley 1221 de 2008', 'teletrabajo'), resultado('Ley 909', 'empleo')]
  const r = contienenTodos(items, 'el de la') // solo vacías: sin filtro
  assert.equal(r.exigidos.length, 0)
  assert.equal(r.items.length, 2)
  assert.equal(r.omitidos, 0)
})

test('el filtro AND del Gestor compara sin tildes', () => {
  const items = [resultado('Decreto 1083 de 2015', 'administración pública')]
  const r = contienenTodos(items, 'administración publica')
  assert.equal(r.items.length, 1)
  assert.equal(r.omitidos, 0)
})

test('quitarStopwords descarta "de" en "auxilio de conectividad"', () => {
  const r = quitarStopwords('auxilio de conectividad')
  assert.equal(r.usadas, 'auxilio conectividad')
  assert.deepEqual(r.descartadas, ['de'])
})

test('SUIN: el índice no cubre el término y el buscador vivo encuentra la Ley 1221', async () => {
  const encontrada = buscarEnIndice('teletrabajo')
  assert.equal(encontrada.total, 0, 'el índice empaquetado no cubre teletrabajo (hueco conocido)')

  let llamadasVivo = 0
  const r = await buscarEnSuin(
    {
      buscar: (async (_opts) => {
        llamadasVivo++
        return {
          total: 1,
          items: [
            {
              id: '1675702',
              titulo: 'LEY 1221 DE 2008',
              subtipo: 'Ley',
              epigrafe: 'por la cual se establecen normas para promover y regular el teletrabajo',
              vigencia: '',
              entidad: '',
              url: 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1675702',
            } satisfies ResultadoSuin,
          ],
        }
      }) as typeof import('../src/fuentes/suin.ts')['buscar'],
    },
    { texto: 'teletrabajo' },
  )
  assert.equal(llamadasVivo, 1)
  assert.equal(r.total, 1)
  assert.equal(r.items[0]?.titulo, 'LEY 1221 DE 2008')
  assert.ok(r.nota?.includes('no cubría el término'), 'el fallback se declara en la nota')
  assert.deepEqual(r.aplicados, ['buscador del portal (Azure)'])
})

test('SUIN: índice y buscador vivo vacíos declaran el hueco sin concluir que no existe', async () => {
  const r = await buscarEnSuin(
    { buscar: (async () => ({ total: 0, items: [] })) as typeof import('../src/fuentes/suin.ts')['buscar'] },
    { texto: 'zopilote interconectado' },
  )
  assert.ok(r.nota?.includes('NO significa que la norma no exista'), 'el hueco se declara y no se concluye la inexistencia')
  assert.ok(r.nota?.includes('buscar_por_tema'), 'sugiere la vía temática')
})

test('el índice de leyes empaquetado encuentra una ley por su título', () => {
  const r = buscarEnIndice('ley 1221 de 2008', 5)
  assert.equal(r.total, 1)
  assert.equal(r.items[0]?.id, '1675702')
  assert.equal(r.items[0]?.titulo, 'LEY 1221 de 2008')
})

test('el filtro AND local del Consejo de Estado usa el texto de las titulaciones', () => {
  const items = [
    providencia('Nulidad del acto de liquidación del contrato estatal', 'Se anula'),
    providencia('Liquidación del contrato estatal', ''),
    providencia('Nulidad electoral por trashumancia', ''),
  ]
  const r = contienenTodas(items, 'nulidad liquidación contrato')
  assert.equal(r.exigidos.length, 3)
  assert.deepEqual(r.items.map((p) => p.radicado), [items[0]!.radicado])
  assert.equal(r.omitidos, 2)
})

test('conAlternativas expande una abreviatura y la declara en variantesUsadas', async () => {
  const r = await conAlternativas(
    async (t) => (t === 'salario mínimo legal mensual vigente' ? [{ n: 1 }] : []),
    'SMLMV',
    1,
  )
  assert.equal(r.items.length, 1)
  assert.deepEqual(r.variantesUsadas, ['salario mínimo legal mensual vigente = SMLMV'])
})

test('desarrollarAbreviaturas también actúa cuando la abreviatura va en una frase', () => {
  const d = desarrollarAbreviaturas('incremento del SMLMV para 2025')
  assert.equal(d?.abreviatura, 'SMLMV')
  assert.equal(d?.desarrollo, 'salario mínimo legal mensual vigente')
})

test('una abreviatura desconocida se busca literal, sin inventar expansiones', () => {
  const d = desarrollarAbreviaturas('ABC desconocido')
  assert.equal(d, undefined)
})

test('conAlternativas con abreviatura desconocida usa solo el término literal', async () => {
  const vistos: string[] = []
  const r = await conAlternativas(
    async (t) => {
      vistos.push(t)
      return [{ n: 1 }]
    },
    'ABC',
    1,
  )
  assert.deepEqual(vistos, ['ABC'])
  assert.deepEqual(r.variantesUsadas, [])
})
