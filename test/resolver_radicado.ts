/**
 * `resolver_radicado`: los tres desenlaces del Consejo de Estado (con
 * providencia, vacío y fallo), la Corte Suprema, la corporación desconocida
 * (con y sin hallazgo en SAMAI, y con un código no medido) y la fuente apagada.
 * Sin red: se inyecta `deps.porRadicado`. Las pruebas de red se saltan con
 * SIN_RED=1.
 *
 *   node --test test/resolver_radicado.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { resolverRadicado } from '../src/herramientas/resolver_radicado.ts'
import { parsearRadicado } from '../src/nucleo/citas.ts'
import { porRadicado, type Providencia } from '../src/fuentes/jurisprudencia/consejoestado.ts'

/** Sin red: los casos que consultan portales se saltan con SIN_RED=1. */
const SIN_RED = process.env['SIN_RED'] === '1'

const CITA = '11001-03-28-000-2022-00132-00'
const radicadoConsejo = parsearRadicado(CITA)!
const radicadoSuprema = parsearRadicado('11001-02-03-000-2022-03272-00')!
/** 31-03: juzgado de circuito, no una alta corte. */
const CITA_INSTANCIA = '11001-31-03-038-2019-00163-01'
const radicadoInstancia = parsearRadicado(CITA_INSTANCIA)!
/** 11-02: un código que la tabla no interpreta. */
const radicadoSinCodigo = parsearRadicado('66001-11-02-066-2017-00419-00')!

/** Providencia FICTICIA: aquí solo se prueba el formateo, no se afirma nada real. */
const PROVIDENCIA: Providencia = {
  radicado: CITA,
  fecha: '2023-05-11',
  ponente: 'Ponente (fixture)',
  sala: 'Sección Quinta',
  clase: 'Acción de nulidad electoral',
  actor: 'Actor (fixture)',
  demandado: 'Demandado (fixture)',
  titulaciones: [
    { problema: '¿Se vulneró el debido proceso electoral?', respuesta: 'No.', nota: 'NOTA DE RELATORÍA (fixture).' },
  ],
  url: 'https://samai.consejodeestado.gov.co/ficha(fixture)',
  token: 'TOKEN-FIXTURE',
}
const providenciaDe = (radicado: string): Providencia => ({ ...PROVIDENCIA, radicado })

/** Un `porRadicado` inyectado que nunca debe llamarse. */
const noConsultar = async (): Promise<{ items: Providencia[]; url: string }> => {
  throw new Error('porRadicado no debería consultarse')
}
/** Un `porRadicado` que devuelve lo que se le pida. */
const devolver =
  (items: Providencia[]) =>
  async (): Promise<{ items: Providencia[]; url: string }> => ({ items, url: 'https://samai/x' })

test('Consejo con providencia: la ficha, el problema jurídico y el asa con token', async () => {
  const r = await resolverRadicado(CITA, radicadoConsejo, { porRadicado: devolver([PROVIDENCIA]) })
  assert.match(r, /^### 11001-03-28-000-2022-00132-00/)
  assert.match(r, /Alcance: consulté Consejo de Estado \(1 providencia\(s\)\)/)
  assert.match(r, /Corporación según los dígitos \(medido\): Consejo de Estado — Sección Quinta/)
  assert.match(r, /DANE 11001 \(Bogotá D\.C\.\)/)
  assert.match(r, /Problema jurídico: ¿Se vulneró el debido proceso electoral\?/)
  assert.match(r, /Respuesta: No\./)
  assert.match(r, /Para leer: obtener_documento con fuente="consejo", token="TOKEN-FIXTURE"/)
  assert.match(r, /LOS TOKENS CADUCAN EN UNA HORA/)
})

test('Consejo sin resultado: las tres verdades y el alcance con 0 tituladas', async () => {
  const r = await resolverRadicado(CITA, radicadoConsejo, { porRadicado: devolver([]) })
  assert.match(r, /0 tituladas/)
  assert.match(r, /SAMAI no tiene ninguna providencia TITULADA de este radicado/)
  assert.match(r, /que este radicado no aparezca NO significa que el proceso no exista/)
  assert.match(r, /Consulta de Procesos de la Rama Judicial/)
})

test('Consejo que falla: lo dice con el motivo y no concluye nada', async () => {
  const r = await resolverRadicado(CITA, radicadoConsejo, {
    porRadicado: async () => {
      throw new Error('SAMAI respondió 500')
    },
  })
  assert.match(r, /Alcance: consulté Consejo de Estado \(no respondió\)/)
  assert.match(r, /La consulta a SAMAI FALLÓ: SAMAI respondió 500/)
  assert.match(r, /No se puede concluir nada/)
})

test('Corte Suprema: remite a la búsqueda por materia y no consulta ninguna fuente', async () => {
  const r = await resolverRadicado('11001-02-03-000-2022-03272-00', radicadoSuprema, { porRadicado: noConsultar })
  assert.match(r, /Alcance: sin consultar ninguna fuente/)
  assert.match(r, /Corte Suprema de Justicia — Sala de Casación Civil/)
  assert.match(r, /La Corte Suprema NO permite buscar por radicado/)
  assert.match(r, /buscar_jurisprudencia_suprema por MATERIA/)
})

test('desconocida (31-03, juzgado) con hallazgo: dice dónde lo encontró, no que sea Corte Suprema', async () => {
  const r = await resolverRadicado(CITA_INSTANCIA, radicadoInstancia, {
    porRadicado: devolver([providenciaDe(CITA_INSTANCIA)]),
  })
  assert.match(r, /Los dígitos 6-9 \(31-03\) no corresponden a una alta corte: son de un juzgado o tribunal de instancia/)
  assert.match(r, /Alcance: consulté Consejo de Estado \(1 providencia\(s\)\)/)
  assert.match(r, /Encontrado en el buscador de providencias tituladas de SAMAI \(Consejo de Estado\)/)
  assert.doesNotMatch(r, /Corte Suprema de Justicia/)
  assert.doesNotMatch(r, /Corporación según los dígitos \(medido\)/)
})

test('desconocida sin hallazgo: no encontrado allí, sin atribuirle corporación', async () => {
  const r = await resolverRadicado(CITA_INSTANCIA, radicadoInstancia, { porRadicado: devolver([]) })
  assert.match(r, /No encontrado ahí: SAMAI solo titula una parte de sus providencias/)
  assert.match(r, /buscar_jurisprudencia_consejo_estado/)
  assert.doesNotMatch(r, /Corte Suprema de Justicia/)
})

test('un código que la tabla no interpreta: no se le inventa un despacho', async () => {
  const r = await resolverRadicado('66001-11-02-066-2017-00419-00', radicadoSinCodigo, { porRadicado: devolver([]) })
  assert.match(r, /Los dígitos no bastan para saber ante qué despacho va el proceso/)
  assert.match(r, /No encontrado ahí/)
})

test('fuente del Consejo apagada: avisa y no consulta', async () => {
  const antes = process.env['FUENTES']
  process.env['FUENTES'] = '-consejo'
  try {
    const r = await resolverRadicado(CITA, radicadoConsejo, { porRadicado: noConsultar })
    assert.match(r, /Consejo de Estado está DESACTIVADA/)
    assert.match(r, /no se puede afirmar ni negar nada sobre el proceso/)
  } finally {
    if (antes === undefined) delete process.env['FUENTES']
    else process.env['FUENTES'] = antes
  }
})

// --- red (saltables con SIN_RED=1) ----------------------------------------

test(
  'red: 11001-03-28-000-2022-00132-00 devuelve providencias, todas con ese radicado',
  { skip: SIN_RED ? 'requiere red (SIN_RED=1)' : false, timeout: 240_000 },
  async () => {
    const { items } = await porRadicado(CITA)
    // El encargo original esperaba 1; medido hoy el proceso tiene 3 tituladas
    // (tres autos con token propio), todas del mismo radicado. Se exige lo que
    // importa: que haya al menos una y que el filtro no cuele otro radicado.
    assert.ok(items.length >= 1, 'debe devolver al menos una providencia')
    for (const p of items) assert.equal(p.radicado.replace(/\D/g, ''), radicadoConsejo.radicado)
  },
)

test(
  'red: un radicado sin providencias tituladas da vacío legítimo, sin CanarioError',
  { skip: SIN_RED ? 'requiere red (SIN_RED=1)' : false, timeout: 240_000 },
  async () => {
    const { items } = await porRadicado('11001-03-28-000-2022-99999-00')
    assert.equal(items.length, 0)
  },
)

test(
  'red: un radicado 31-03 se busca en SAMAI y NUNCA se llama Corte Suprema',
  { skip: SIN_RED ? 'requiere red (SIN_RED=1)' : false, timeout: 240_000 },
  async () => {
    const r = await resolverRadicado(CITA_INSTANCIA, radicadoInstancia)
    assert.match(r, /son de un juzgado o tribunal de instancia/)
    assert.doesNotMatch(r, /Corte Suprema de Justicia/)
    assert.match(r, /Encontrado en el buscador de providencias tituladas de SAMAI \(Consejo de Estado\)|No encontrado ahí/)
  },
)

test(
  'red: un radicado 0203 se identifica como Corte Suprema, Sala Civil, sin buscar',
  { skip: SIN_RED ? 'requiere red (SIN_RED=1)' : false, timeout: 240_000 },
  async () => {
    const r = await resolverRadicado('11001-02-03-000-2022-03272-00', radicadoSuprema)
    assert.match(r, /Corporación según los dígitos \(medido\): Corte Suprema de Justicia — Sala de Casación Civil/)
    assert.match(r, /Alcance: sin consultar ninguna fuente/)
    assert.match(r, /La Corte Suprema NO permite buscar por radicado/)
  },
)
