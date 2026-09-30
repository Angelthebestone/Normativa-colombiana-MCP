/**
 * Búsqueda federada `buscar_unificado`: fan-out con atribución, perfil
 * tributario que prioriza DIAN, fuente explícita, y degradación cuando una
 * fuente rinde 0 o se cae. Se prueba con el mapa de fuentes inyectado, sin red.
 *
 *   node --test test/buscar_unificado.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { escribir, formatear, fuentesDe, mismoOrigen, paraLeerDe } from '../src/herramientas/buscar_unificado.ts'
import type { Item } from '../src/herramientas/buscar_unificado.ts'
import * as obtenerDocumento from '../src/herramientas/obtener_documento.ts'

/** Sin red: los casos que consultan portales se saltan con SIN_RED=1. */
const SIN_RED = process.env['SIN_RED'] === '1'

/** Extrae los pares clave="valor" de una línea "Para leer": fuente="x", id="7". */
const paramsDe = (paraLeer: string): Record<string, string> => {
  const p: Record<string, string> = {}
  for (const m of paraLeer.matchAll(/(\w+)="([^"]*)"/g)) p[m[1]!] = m[2]!
  return p
}

const item = (fuente: string, titulo: string): Item => ({ fuente, titulo, url: `https://${fuente}.gov.co/${titulo}` })

test('fuentesDe: sin perfil ni fuentes consulta Gestor, Corte y SUIN (sin DIAN)', () => {
  assert.deepEqual(fuentesDe(undefined, undefined), ['gestor', 'corte', 'suin'])
})

test('fuentesDe: perfil tributario añade DIAN', () => {
  assert.deepEqual(fuentesDe('tributario', undefined), ['gestor', 'corte', 'suin', 'dian'])
})

test('fuentesDe: perfil salud añade INVIMA y Supersalud; mineria añade ANM', () => {
  assert.deepEqual(fuentesDe('salud', undefined), ['gestor', 'corte', 'suin', 'invima', 'supersalud'])
  assert.deepEqual(fuentesDe('mineria', undefined), ['gestor', 'corte', 'suin', 'anm'])
})

test('fuentesDe: un filtro explícito gana a todo', () => {
  assert.deepEqual(fuentesDe(undefined, ['corte']), ['corte'])
})

test('formatear: sin perfil ordena Gestor → Corte → SUIN y atribuye cada item', () => {
  const r = {
    gestor: [item('gestor', 'Ley 1')],
    corte: [item('corte-constitucional', 'T-1/24')],
    suin: [item('suin', 'Dec 2')],
    dian: [],
  }
  const txt = formatear(r, 'teletrabajo')
  assert.match(txt, /Resultados para "teletrabajo"/)
  // El orden de presentación pone Gestor primero, luego Corte, luego SUIN.
  const iGestor = txt.indexOf('[gestor]')
  const iCorte = txt.indexOf('[corte-constitucional]')
  const iSuin = txt.indexOf('[suin]')
  assert.ok(iGestor < iCorte && iCorte < iSuin, 'el orden de presentación no se respeta')
  assert.match(txt, /\[gestor\] Ley 1/)
  assert.match(txt, /\[suin\] Dec 2/)
})

test('formatear: perfil tributario prioriza DIAN', () => {
  const r = {
    gestor: [item('gestor', 'Ley')],
    corte: [],
    suin: [],
    dian: [item('dian', 'Concepto')],
  }
  const txt = formatear(r, 'retención', 'tributario')
  assert.ok(txt.indexOf('dian') < txt.indexOf('gestor'), 'con perfil tributario la DIAN va primero')
})

test('formatear: un vacío se explica por fuente y no concluye inexistencia', () => {
  const r = { gestor: [], corte: [item('corte', 'T-1/24')], suin: [], dian: [] }
  const txt = formatear(r, 'teletrabajo')
  assert.match(txt, /Sin resultados en: gestor, suin, dian/)
  assert.match(txt, /NO significa que la norma no exista/)
})

/** Mapa de fuentes completo para los tests (7 claves), todas inyectadas. */
function porFuenteBase(): Record<string, (texto: string, limite: number) => Promise<Item[]>> {
  return {
    gestor: async () => [],
    corte: async () => [],
    suin: async () => [],
    dian: async () => [],
    invima: async () => [],
    supersalud: async () => [],
    anm: async () => [],
  }
}

test('escribir: una fuente que falla (503) se declara como fallo, no como vacío', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => {
    throw new Error('503')
  }
  porFuente['corte'] = async () => [item('corte-constitucional', 'T-1/24')]
  const r = await escribir({ texto: 'x', limite: 5 }, { porFuente })
  assert.match(r, /T-1\/24/)
  // La fuente caída se declara aparte con su mensaje: ya no se mezcla con los vacíos.
  assert.match(r, /No se pudo consultar: gestor \(503\)/)
  assert.match(r, /es un FALLO de la fuente, no un vacío/)
  // Sin perfil no se consulta DIAN, así que el vacío solo lista las consultadas que respondieron.
  assert.match(r, /Sin resultados en: suin/)
  assert.doesNotMatch(r, /Sin resultados en: gestor/)
})

test('formatear: distingue "respondió sin nada" de "no se pudo consultar"', () => {
  const r = { gestor: [], corte: [item('corte', 'T-1/24')], suin: [] }
  const txt = formatear(r, 'tutela', undefined, { gestor: 'unable to verify the first certificate' })
  assert.match(txt, /Sin resultados en: suin \(respondieron sin nada\)/)
  assert.doesNotMatch(txt, /Sin resultados en: gestor/)
  assert.match(txt, /No se pudo consultar: gestor \(unable to verify the first certificate\)/)
  assert.match(txt, /no concluyas que no hay resultados ahí/)
})

test('escribir: una fuente que rinde 0 se reporta como hueco, no como fallo', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => [item('gestor', 'Ley 1')]
  const r = await escribir({ texto: 'teletrabajo', limite: 5 }, { porFuente })
  assert.match(r, /\[gestor\] Ley 1/)
  assert.match(r, /Sin resultados en: corte, suin/)
})

test('escribir: un filtro de fuentes solo consulta esas', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => {
    throw new Error('gestor no debería consultarse')
  }
  porFuente['corte'] = async () => [item('corte-constitucional', 'T-1/24')]
  porFuente['suin'] = async () => {
    throw new Error('suin no debería consultarse')
  }
  porFuente['dian'] = async () => {
    throw new Error('dian no debería consultarse')
  }
  const r = await escribir({ texto: 'x', fuentes: ['corte'], limite: 5 }, { porFuente })
  assert.match(r, /T-1\/24/)
  // Con filtro explícito no se reportan vacíos de fuentes no consultadas.
  assert.doesNotMatch(r, /Sin resultados en: gestor/)
})

test('escribir: perfil salud consulta INVIMA y Supersalud y declara sus vacíos', async () => {
  const porFuente = porFuenteBase()
  porFuente['invima'] = async () => [item('invima', 'Resolución 1')]
  const r = await escribir({ texto: 'medicamentos', perfil: 'salud', limite: 5 }, { porFuente })
  assert.match(r, /\[invima\] Resolución 1/)
  // Las fuentes del perfil salud que rindieron 0 se declaran (gestor, corte, suin, supersalud).
  assert.match(r, /Sin resultados en: gestor, corte, suin, supersalud/)
})

/** Un acto del normograma compartido: la URL acaba en el nombre del archivo. */
const acto = (fuente: string, archivo: string): Item => ({ fuente, titulo: archivo, url: `https://normograma.info/docs/${archivo}` })

test('escribir: el acto que INVIMA y Supersalud publican en el mismo archivo sale una vez, atribuido a INVIMA', async () => {
  const porFuente = porFuenteBase()
  porFuente['invima'] = async () => [acto('invima', 'circular_0002_2000.htm'), acto('invima', 'resolucion_100_2020.htm')]
  // Supersalud pide el doble para poder completar el límite tras descartar lo repetido.
  const pedidos: number[] = []
  porFuente['supersalud'] = async (_texto, limite) => {
    pedidos.push(limite)
    return [acto('supersalud', 'circular_0002_2000.htm'), acto('supersalud', 'decreto_50_2018.htm'), acto('supersalud', 'ley_9_1979.htm')]
  }
  const r = await escribir({ texto: 'medicamentos', perfil: 'salud', limite: 2 }, { porFuente })
  assert.equal(r.split('circular_0002_2000.htm').length - 1, 2, 'el título y la URL de UNA sola entrada')
  assert.match(r, /\[invima\] circular_0002_2000\.htm\n\s+https:\/\/normograma\.info\/docs\/circular_0002_2000\.htm\n\s+también en Supersalud/)
  assert.doesNotMatch(r, /\[supersalud\] circular_0002_2000/)
  // El límite (2) se completa con los actos distintos que siguen.
  assert.match(r, /\[supersalud\] decreto_50_2018\.htm/)
  assert.match(r, /\[supersalud\] ley_9_1979\.htm/)
  assert.deepEqual(pedidos, [4])
})

test('escribir: dos actos distintos de INVIMA y Supersalud se conservan', async () => {
  const porFuente = porFuenteBase()
  porFuente['invima'] = async () => [acto('invima', 'resolucion_100_2020.htm')]
  porFuente['supersalud'] = async () => [acto('supersalud', 'resolucion_200_2021.htm')]
  const r = await escribir({ texto: 'medicamentos', perfil: 'salud', limite: 5 }, { porFuente })
  assert.match(r, /\[invima\] resolucion_100_2020\.htm/)
  assert.match(r, /\[supersalud\] resolucion_200_2021\.htm/)
  assert.doesNotMatch(r, /también en Supersalud/)
})

test('escribir: perfil desconocido devuelve la lista de admitidos sin consultar nada', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => {
    throw new Error('no debería consultarse')
  }
  const r = await escribir({ texto: 'x', perfil: 'no-existe' as never, limite: 5 }, { porFuente })
  assert.match(r, /No existe el perfil "no-existe"/)
  assert.match(r, /salud, mineria/)
})

// --- «Para leer» y formato json ---------------------------------------------

test('paraLeerDe: arma la llamada exacta a obtener_documento con los nombres de esa herramienta', () => {
  assert.equal(paraLeerDe('gestor', { id: '74163' }), 'obtener_documento con fuente="gestor", id="74163"')
  assert.equal(
    paraLeerDe('corte', { ruta: '2021/SU-371-21.htm' }),
    'obtener_documento con fuente="corte", ruta="2021/SU-371-21.htm"',
  )
  assert.equal(
    paraLeerDe('sectorial', { entidad: 'invima', url: 'https://x/y.pdf' }),
    'obtener_documento con fuente="sectorial", entidad="invima", url="https://x/y.pdf"',
  )
})

test('mismoOrigen: solo el enlace que obtener_documento aceptará habilita «Para leer»', () => {
  // El caso medido de la ANM: su enlace vive en un blob de Azure, no en su dominio.
  assert.equal(mismoOrigen('https://www.anm.gov.co', 'https://saportalanm.blob.core.windows.net/x.pdf'), false)
  assert.equal(mismoOrigen('https://normograma.invima.gov.co', 'https://normograma.invima.gov.co/compilacion/docs/x.htm'), true)
  assert.equal(mismoOrigen('https://normograma.invima.gov.co', 'no-es-url'), false)
})

test('formatear: el item con paraLeer lo muestra; SUIN no lo lleva y se explica una vez al final', () => {
  const g: Item = { ...item('gestor', 'Decreto 1'), paraLeer: paraLeerDe('gestor', { id: '1' }) }
  const s = item('suin', 'Dec 2') // sin paraLeer: SUIN no sirve texto
  const txt = formatear({ gestor: [g], suin: [s] }, 'x')
  assert.match(txt, /  Para leer: obtener_documento con fuente="gestor", id="1"/)
  // El ítem de SUIN no lleva la línea; la razón va una sola vez, al final.
  assert.doesNotMatch(txt, /\[suin\] Dec 2[\s\S]*Para leer: obtener_documento con fuente="suin"/)
  assert.match(txt, /Los resultados de SUIN no traen "Para leer"/)
  assert.equal(txt.split('Los resultados de SUIN no traen').length - 1, 1)
})

test('formatear: sin ítems de SUIN no aparece la nota', () => {
  const txt = formatear({ gestor: [item('gestor', 'Ley 1')], suin: [] }, 'x')
  assert.doesNotMatch(txt, /no traen "Para leer"/)
})

test('escribir json: trae las claves documentadas y «Para leer» por fuente, sin cabecera ni pie', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => [{ ...item('gestor', 'Ley 1'), paraLeer: paraLeerDe('gestor', { id: '7' }) }]
  porFuente['corte'] = async () => [
    { ...item('corte-constitucional', 'T-1/24'), paraLeer: paraLeerDe('corte', { ruta: '2024/T-099-24.htm' }) },
  ]
  porFuente['suin'] = async () => [item('suin', 'Dec 2')]
  const r = await escribir({ texto: 'x', limite: 5, formato: 'json' }, { porFuente })
  const d = JSON.parse(r)
  assert.deepEqual(Object.keys(d).sort(), [
    'alcance',
    'avisos',
    'fallidas',
    'fecha_consulta',
    'resultados',
    'sin_resultados',
    'texto',
  ])
  assert.match(d.fecha_consulta, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(d.alcance, /^Alcance: /)
  const gestor = d.resultados.find((i: Item) => i.fuente === 'gestor')
  assert.equal(gestor.paraLeer, 'obtener_documento con fuente="gestor", id="7"')
  const corte = d.resultados.find((i: Item) => i.fuente === 'corte-constitucional')
  assert.equal(corte.paraLeer, 'obtener_documento con fuente="corte", ruta="2024/T-099-24.htm"')
  const suin = d.resultados.find((i: Item) => i.fuente === 'suin')
  assert.equal(suin.paraLeer, undefined)
  assert.ok(d.avisos.some((a: string) => /SUIN/.test(a)), 'el json debe declarar por qué SUIN no trae «Para leer»')
})

test('escribir json: un perfil desconocido no sale a la red y trae alcance y aviso', async () => {
  const porFuente = porFuenteBase()
  porFuente['gestor'] = async () => {
    throw new Error('no debería consultarse')
  }
  const r = await escribir({ texto: 'x', perfil: 'no-existe' as never, limite: 5, formato: 'json' }, { porFuente })
  const d = JSON.parse(r)
  assert.match(d.alcance, /sin consultar ninguna fuente/)
  assert.deepEqual(d.resultados, [])
  assert.match(d.avisos[0], /No existe el perfil "no-existe"/)
})

test('red: cada «Para leer» de gestor/corte resuelve con obtener_documento', { skip: SIN_RED ? 'requiere red (SIN_RED=1)' : false, timeout: 240_000 }, async () => {
  const r = await escribir({ texto: 'teletrabajo', fuentes: ['gestor', 'corte'], limite: 3, formato: 'json' })
  const d = JSON.parse(r) as { resultados: Item[] }
  const conLeer = d.resultados.filter((i) => i.paraLeer)
  assert.ok(conLeer.some((i) => i.fuente === 'gestor'), 'ningún resultado de gestor trajo «Para leer»')
  assert.ok(conLeer.some((i) => i.fuente === 'corte-constitucional'), 'ningún resultado de corte trajo «Para leer»')
  // Una llamada REAL por fuente presente: la línea «Para leer» debe traer texto.
  for (const fuente of new Set(conLeer.map((i) => i.fuente))) {
    const it = conLeer.find((i) => i.fuente === fuente)!
    const texto = await obtenerDocumento.escribir(paramsDe(it.paraLeer!) as never)
    assert.ok(texto.length > 100, `obtener_documento no devolvió texto para ${fuente}`)
  }
})
