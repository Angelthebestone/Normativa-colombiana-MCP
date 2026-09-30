/**
 * Pruebas del registro de perfiles. No tocan la red: `consultar` sí la necesita
 * y se prueba aparte, contra las fuentes reales.
 *
 *   node --test test/perfiles.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import type * as anla from '../src/fuentes/anla.ts'
import type * as consejo from '../src/fuentes/jurisprudencia/consejoestado.ts'
import { consultarAmbiental, consultarContratacion, perfil, perfiles } from '../src/nucleo/perfiles.ts'

test('el registro trae los cinco perfiles', () => {
  assert.deepEqual(
    perfiles().map((p) => p.id),
    ['laboral', 'tributario', 'ambiental', 'contratacion_estatal', 'energia'],
  )
})

test('cada perfil declara su sector y su advertencia', () => {
  for (const p of perfiles()) {
    assert.ok(p.nombre, `${p.id} sin nombre`)
    assert.ok(p.sector, `${p.id} sin sector`)
    assert.ok(p.advertencia.length > 0, `${p.id} sin advertencia: un vacío se leería como inexistencia`)
  }
})

test('cada perfil rotula su sector solo con las fuentes que consulta', () => {
  assert.match(perfil('energia')!.sector, /CREG/)
  assert.doesNotMatch(perfil('energia')!.sector, /UPME|ANH/)
  assert.match(perfil('contratacion_estatal')!.sector, /Consejo de Estado/)
  assert.doesNotMatch(perfil('contratacion_estatal')!.sector, /Gestor/)
})

// --- D7: el perfil ambiental revisa las siete secciones de Eureka --------------

const entrada = (titulo: string, url: string): anla.EntradaAnla => ({ titulo, cita: '', desmentida: '', resumen: '', url })

/** Eureka de mentira: cada sección devuelve lo suyo y se anota qué se pidió. */
const eureka = (porSeccion: Partial<Record<anla.SeccionAnla, anla.EntradaAnla[] | Error>>) => {
  const pedidas: [string, number | undefined][] = []
  const listar = (async (seccion: anla.SeccionAnla, desde?: number) => {
    pedidas.push([seccion, desde])
    const r = porSeccion[seccion] ?? []
    if (r instanceof Error) throw r
    return { items: r, desde: desde ?? 0, siguiente: null, url: `https://eureka.test/${seccion}` }
  }) as typeof anla.listar
  return { listar, pedidas }
}

test('el perfil ambiental baja la primera página de cada una de las 7 secciones', async () => {
  const { listar, pedidas } = eureka({})
  await consultarAmbiental('licencia', 10, { listar })
  assert.deepEqual(
    pedidas.map(([s]) => s).sort(),
    ['biodiversidad', 'cambio-climatico', 'consulta-previa', 'impacto-ambiental', 'leyes', 'licencia-ambiental', 'participacion-ciudadana'],
  )
  assert.ok(pedidas.every(([, desde]) => desde === 0), 'solo la primera página de cada sección')
})

test('un término que vive en otra sección devuelve resultados, y uno de leyes sigue devolviéndolos', async () => {
  const { listar } = eureka({
    leyes: [entrada('Ley 1333 de 2009 Procuraduría ambiental', 'https://e.test/1333')],
    'licencia-ambiental': [entrada('Decreto 1076 de 2015 licencia ambiental', 'https://e.test/1076')],
  })
  const licencia = await consultarAmbiental('licencia', 10, { listar })
  assert.match(licencia, /Decreto 1076 de 2015 licencia ambiental/)
  const procuraduria = await consultarAmbiental('Procuraduría', 10, { listar })
  assert.match(procuraduria, /Ley 1333 de 2009/)
})

test('una entrada que figura en dos secciones sale una vez', async () => {
  const doble = entrada('Ley 99 de 1993 licencia', 'https://e.test/99')
  const { listar } = eureka({ leyes: [doble], 'licencia-ambiental': [doble], biodiversidad: [doble] })
  const r = await consultarAmbiental('licencia', 10, { listar })
  assert.equal(r.split('Ley 99 de 1993 licencia').length - 1, 1)
})

test('el vacío declara el alcance en la advertencia del perfil', () => {
  const a = perfil('ambiental')!.advertencia
  assert.match(a, /primera página de cada una de sus 7 secciones/)
  assert.match(a, /NO prueba que no haya normativa/)
  assert.match(a, /listar_normativa_ambiental_anla/)
})

test('una sección que no responde se dice; si no responde ninguna, es un error', async () => {
  const { listar } = eureka({
    leyes: [entrada('Ley 99 de 1993 licencia', 'https://e.test/99')],
    biodiversidad: new Error('Eureka (ANLA) respondió 503.'),
  })
  const r = await consultarAmbiental('licencia', 10, { listar })
  assert.match(r, /Ley 99 de 1993/)
  assert.match(r, /No respondieron y no se revisaron: biodiversidad \(Eureka \(ANLA\) respondió 503\.\)/)
  const caida = eureka({
    leyes: new Error('caída'),
    'licencia-ambiental': new Error('caída'),
    biodiversidad: new Error('caída'),
    'cambio-climatico': new Error('caída'),
    'consulta-previa': new Error('caída'),
    'impacto-ambiental': new Error('caída'),
    'participacion-ciudadana': new Error('caída'),
  })
  await assert.rejects(consultarAmbiental('licencia', 10, { listar: caida.listar }), /caída/)
})

// --- D15: contratación identifica cada providencia; energía declara el año ------

const prov = (extra: Partial<consejo.Providencia>): consejo.Providencia => ({
  radicado: '11001-03-26-000-2019-00001-00',
  fecha: '2 de octubre de 2013',
  ponente: 'Fulano',
  sala: 'Sección Tercera',
  clase: 'Controversias contractuales',
  actor: 'EMPRESA S.A.',
  demandado: 'NACIÓN',
  titulaciones: [],
  url: 'https://samai.test/ficha/1',
  token: '',
  ...extra,
})

const fuenteConsejo = (...items: consejo.Providencia[]) =>
  ({ buscar: (async () => ({ paginas: 1, pagina: 1, items, url: '', omitidos: 0 })) as typeof consejo.buscar })

test('contratación: cada resultado trae radicado, clase, fecha del proceso, sala, partes y ficha', async () => {
  const r = await consultarContratacion('licitación', 10, fuenteConsejo(prov({})))
  assert.match(r, /^- 11001-03-26-000-2019-00001-00 \(Controversias contractuales\)/)
  assert.match(r, /Fecha del proceso: 2 de octubre de 2013 · Sala: Sección Tercera/)
  assert.match(r, /EMPRESA S\.A\. contra NACIÓN/)
  assert.match(r, /https:\/\/samai\.test\/ficha\/1/)
})

test('contratación: sin partes se omite la línea en vez de imprimir un hueco', async () => {
  const r = await consultarContratacion('licitación', 10, fuenteConsejo(prov({ actor: '', demandado: '' })))
  assert.doesNotMatch(r, / contra /)
  assert.doesNotMatch(r, /\n\s*\n/)
  assert.match(r, /Sala: Sección Tercera/)
})

test('energía: la advertencia dice que solo se revisó el año en curso y remite a buscar_resoluciones_creg con anio', () => {
  const a = perfil('energia')!.advertencia
  assert.match(a, /año en curso/)
  assert.match(a, /buscar_resoluciones_creg con anio/)
})
