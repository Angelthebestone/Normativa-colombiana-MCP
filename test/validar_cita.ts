/**
 * Pruebas del formateo y los avisos de validar_cita, sin red.
 *
 *   node --test test/validar_cita.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { calcularDatos, escribir, formatear, resolverUna, sinForma, textoDeDatos } from '../src/herramientas/validar_cita.ts'

const ENCONTRADA = { titulo: 'LEY 909 DE 2004', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=123' }

/** Un item del Gestor con la forma que devuelve gestor.buscar, para inyectar sin red. */
const item = (id: string, titulo: string) => ({
  id,
  titulo,
  resumen: '',
  url: `https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=${id}`,
})

/** `buscar` falso que devuelve siempre esos items (sin red). */
const buscarDe =
  (items: ReturnType<typeof item>[]) =>
  async (): Promise<{ total: number; items: ReturnType<typeof item>[]; aplicados: string[] }> => ({
    total: items.length,
    items,
    aplicados: [],
  })

test('formatear con resultado "cita validada" incluye ese texto y las comprobaciones con ✓', () => {
  const salida = formatear('Ley 909 de 2004', 'cita validada', [
    { nombre: 'número y año', ok: true },
    { nombre: 'dominio del enlace', ok: true },
  ], ENCONTRADA)
  assert.ok(salida.includes('Resultado: cita validada'))
  assert.ok(salida.includes('- número y año: ✓'))
  assert.ok(salida.includes('- dominio del enlace: ✓'))
  assert.ok(salida.includes(ENCONTRADA.titulo))
  assert.ok(salida.includes(ENCONTRADA.url))
})

test('formatear marca ✗ las comprobaciones fallidas', () => {
  const salida = formatear('Ley 909 de 2004', 'cita parcialmente validada', [
    { nombre: 'dominio del enlace', ok: false },
  ], ENCONTRADA)
  assert.ok(salida.includes('Resultado: cita parcialmente validada'))
  assert.ok(salida.includes('- dominio del enlace: ✗'))
})

test('formatear sin norma encontrada avisa que no significa que no exista', () => {
  const salida = formatear('Ley 909 de 2004', 'no fue posible validar', [])
  assert.ok(salida.includes('NO significa que la norma no exista'))
  assert.ok(salida.includes('Resultado: no fue posible validar'))
})

test('sinForma devuelve el aviso de forma para una cita que no parsea y vacío para una válida', () => {
  assert.ok(sinForma('esto no es una cita').includes('no tiene forma de cita colombiana'))
  assert.equal(sinForma('Ley 909 de 2004'), '')
})

// --- datos y formato json ---------------------------------------------------

test('calcularDatos/textoDeDatos: el texto es el de siempre y sale de los mismos datos', async () => {
  const datos = await calcularDatos('esto no es una cita')
  assert.equal(datos.estado, 'sin-forma')
  assert.equal(textoDeDatos(datos), await resolverUna('esto no es una cita'))
  assert.match(textoDeDatos(datos), /no tiene forma de cita colombiana/)
})

test('escribir json: una cita validada sale como un objeto con estado, resultado y encontrada', async () => {
  const r = await escribir({ cita: 'Ley 909 de 2004', formato: 'json' }, { buscar: buscarDe([item('123', 'LEY 909 DE 2004')]) })
  const d = JSON.parse(r)
  assert.equal(d.estado, 'validada')
  assert.equal(d.resultado, 'cita validada')
  assert.match(d.fecha_consulta, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(d.encontrada.url, ENCONTRADA.url)
  assert.equal(d.comprobaciones.length, 2)
})

test('escribir json: sin forma, ambigua y fuente caída salen como objeto con estado, sin lanzar', async () => {
  const sinForma = JSON.parse(await escribir({ cita: 'esto no es una cita', formato: 'json' }))
  assert.equal(sinForma.estado, 'sin-forma')
  assert.match(sinForma.detalle, /no tiene forma de cita/)

  // "Ley 909" sin año y con dos años distintos en el Gestor: ambigua.
  const ambigua = JSON.parse(
    await escribir({ cita: 'Ley 909', formato: 'json' }, { buscar: buscarDe([item('1', 'LEY 909 DE 2004'), item('2', 'LEY 909 DE 1993')]) }),
  )
  assert.equal(ambigua.estado, 'ambigua')
  assert.equal(ambigua.candidatos.length, 2)
  assert.match(ambigua.detalle, /ambigua/)

  const caida = JSON.parse(
    await escribir({ cita: 'Ley 909 de 2004', formato: 'json' }, {
      buscar: async () => {
        throw new Error('503')
      },
    }),
  )
  assert.equal(caida.estado, 'fuente-caida')
  assert.match(caida.detalle, /503/)
})

test('escribir json: un lote devuelve {fecha_consulta, resultados:[…]} con uno por cita', async () => {
  const r = await escribir({ citas: ['esto no es una cita', 'Ley 909 de 2004'], formato: 'json' }, { buscar: buscarDe([item('123', 'LEY 909 DE 2004')]) })
  const d = JSON.parse(r)
  assert.match(d.fecha_consulta, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(Array.isArray(d.resultados))
  assert.equal(d.resultados.length, 2)
  assert.equal(d.resultados[0].estado, 'sin-forma')
  assert.equal(d.resultados[1].estado, 'validada')
})

test('escribir markdown sigue igual: texto, no json', async () => {
  const md = await escribir({ cita: 'Ley 909 de 2004' }, { buscar: buscarDe([item('123', 'LEY 909 DE 2004')]) })
  assert.match(md, /^Resultado: cita validada/)
  assert.doesNotMatch(md, /^\s*\{/)
})
