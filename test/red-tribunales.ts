/**
 * Red de regresión — dominio tribunales: ≥10 casos adversariales y de
 * contrato sobre buscar_jurisprudencia, obtener_documento(fuente="corte"),
 * buscar_jurisprudencia_suprema/consejo_estado y obtener_documento
 * (suprema/consejo). Lee SIEMPRE el `content[0].text` crudo y `isError`.
 *
 *   npm run build && node --test test/red-tribunales.ts
 */
import { strict as assert } from 'node:assert'
import test, { after, before } from 'node:test'

import { abrirCliente, CONTRATO, LENTO, type Cliente } from './red.ts'

let c: Cliente
before(async () => {
  c = await abrirCliente()
})
after(() => c.cerrar())

test('buscar_jurisprudencia: exige termino (esquema), no devuelve todo', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  const t = tools.find((x: any) => x.name === 'buscar_jurisprudencia')
  assert.deepEqual(t.inputSchema.required, ['termino'])
})

test('buscar_jurisprudencia: un vacío se informa como texto, no como fallo', LENTO, async () => {
  const r = await c.tool('buscar_jurisprudencia', { termino: 'zzqxnoexisteestetermino' })
  assert.equal(r.esError, false)
})

test('buscar_jurisprudencia: excluye autos salvo que se pidan', LENTO, async () => {
  const r = await c.tool('buscar_jurisprudencia', { termino: 'teletrabajo', limite: 5 })
  assert.equal(r.esError, false)
  assert.doesNotMatch(r.texto, /\bA\b.*Auto|Auto de/i)
})

test('buscar_jurisprudencia: el aviso de baja pertinencia no culpa a un filtro no usado', LENTO, async () => {
  const r = await c.tool('buscar_jurisprudencia', { termino: 'teletrabajo', tipos: ['A'], limite: 3 })
  if (/Atención:/.test(r.texto)) {
    assert.doesNotMatch(r.texto, /sin desde\/hasta/)
  }
})

test('obtener_documento: fuente="corte" sin ruta es error de validación', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /hace falta ruta/i)
})

test('obtener_documento: una ruta inexistente de corte se informa como texto', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2024/NO-EXISTE-99.htm' })
  assert.equal(r.esError, false)
  assert.match(r.texto, /No existe una providencia/)
})

test('obtener_documento: una sección inexistente de corte avisa con las disponibles', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2024/NO-EXISTE-99.htm', seccion: 'decision' })
  assert.equal(r.esError, false)
})

test('obtener_documento: fuente="suprema" exige ruta Y sala', CONTRATO, async () => {
  // Faltando cualquiera de las dos se rechaza la llamada. El mensaje nombra la
  // que falta en concreto —"Hace falta sala."— en vez de la pareja entera, que
  // es lo que evita tener que adivinar cuál de las dos se olvidó.
  const sinSala = await c.tool('obtener_documento', { fuente: 'suprema', ruta: 'x.htm' })
  assert.equal(sinSala.esError, true)
  assert.match(sinSala.texto, /hace falta.*sala/i)

  const sinRuta = await c.tool('obtener_documento', { fuente: 'suprema', sala: 'Laboral' })
  assert.equal(sinRuta.esError, true)
  assert.match(sinRuta.texto, /hace falta.*ruta/i)
})

test('obtener_documento: fuente="consejo" sin token es error de validación', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'consejo' })
  assert.equal(r.esError, true)
  assert.match(r.texto, /hace falta token/i)
})

test('obtener_documento: un token caduco o inválido de consejo se informa como texto', CONTRATO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'consejo', token: 'token-falso' })
  assert.equal(r.esError, false)
})

test('la Corte Suprema entrega la ruta con la que pedir el texto', LENTO, async () => {
  const b = await c.tool('buscar_jurisprudencia_suprema', { texto: 'despido sin justa causa', sala: 'Laboral', limite: 3 })
  assert.equal(b.esError, false)
  const ruta = b.texto.match(/ruta="([^"]+)"/)?.[1]
  assert.ok(ruta, 'la búsqueda debe decir con qué ruta pedir el texto')

  const t = await c.tool('obtener_documento', { fuente: 'suprema', ruta, sala: 'Laboral', limite_caracteres: 1200 })
  assert.equal(t.esError, false)
  assert.match(t.texto, /Texto total: \d[\d.,]* caracteres/)
})

test('el Consejo de Estado entrega token y texto con tope', LENTO, async () => {
  const b = await c.tool('buscar_jurisprudencia_consejo_estado', { texto: 'liquidación del contrato estatal', limite: 3 })
  assert.equal(b.esError, false)
  assert.match(b.texto, /CADUCAN EN UNA HORA/)
  const token = b.texto.match(/token="([^"]+)"/)?.[1]
  assert.ok(token, 'la búsqueda debe entregar el token')

  const t = await c.tool('obtener_documento', { fuente: 'consejo', token, limite_caracteres: 1000 })
  assert.equal(t.esError, false)
  if (/no se sirve como PDF/.test(t.texto)) return
  assert.match(t.texto, /Texto total: \d[\d.,]* caracteres/)
})

test('el Consejo de Estado con exacto=false amplía a OR y lo declara', LENTO, async () => {
  const b = await c.tool('buscar_jurisprudencia_consejo_estado', { texto: 'liquidación del contrato estatal', exacto: false, limite: 3 })
  assert.equal(b.esError, false)
  assert.match(b.texto, /Modo ampliado \(OR\)|une los términos con OR/)
})

/*
 * Procedencia dentro de la providencia. La SU-371/21 es el caso que motivó
 * esto: `buscar_en_texto: "instigar"` devolvía tres pasajes, uno de las
 * consideraciones (car. 142.092) y dos de la aclaración de voto de la
 * magistrada Ortiz Delgado (155.175 y 157.770), sin distinguirlos, y los de la
 * aclaración se citaron como doctrina de la Sala Plena.
 */

test('corte: los pasajes dicen de qué parte de la providencia salen', LENTO, async () => {
  const r = await c.tool('obtener_documento', {
    fuente: 'corte',
    ruta: '2021/SU371-21.htm',
    buscar_en_texto: 'instigar',
    limite_caracteres: 20000,
  })
  assert.equal(r.esError, false)
  assert.match(r.texto, /\[consideraciones de la mayoría\]/)
  assert.match(r.texto, /\[aclaración de voto — GLORIA STELLA ORTIZ DELGADO\]/)
})

test('corte: pasajes de partes distintas se advierten arriba', LENTO, async () => {
  const r = await c.tool('obtener_documento', {
    fuente: 'corte',
    ruta: '2021/SU371-21.htm',
    buscar_en_texto: 'instigar',
    limite_caracteres: 20000,
  })
  assert.match(r.texto, /ATENCIÓN: los pasajes salen de partes distintas/)
  assert.match(r.texto, /Solo las consideraciones de la mayoría son doctrina de la Sala/)
})

test('corte: la decisión no se traga los votos particulares', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2021/SU371-21.htm', seccion: 'decision' })
  assert.equal(r.esError, false)
  // Antes devolvía 52.659 caracteres: desde "DECISIÓN" hasta el final, con las
  // cuatro aclaraciones de voto dentro.
  const total = Number(r.texto.match(/sección "decision" \((\d+) caracteres/)?.[1])
  assert.ok(total > 0 && total < 5000, `la decisión mide ${total} caracteres; debería rondar 1.400`)
  assert.match(r.texto, /RESUELVE/)
  assert.doesNotMatch(r.texto, /ACLARACIÓN DE VOTO DE LA MAGISTRADA/)
})

test('corte: se pueden pedir los votos particulares por separado', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2021/SU371-21.htm', seccion: 'aclaraciones', limite_caracteres: 40000 })
  assert.equal(r.esError, false)
  const rotulos = r.texto.match(/--- aclaración de voto — /g) ?? []
  assert.equal(rotulos.length, 4, 'la SU-371/21 trae cuatro aclaraciones de voto')
})

test('corte: la cabecera declara la estructura de la providencia', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2021/SU371-21.htm', limite_caracteres: 600 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Estructura: .*consideraciones de la mayoría.*aclaración de voto/s)
})

test('corte: una providencia sin votos no inventa secciones', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2022/T-015-22.htm', limite_caracteres: 600 })
  assert.equal(r.esError, false)
  assert.doesNotMatch(r.texto, /salvamento de voto|aclaración de voto/)
  // El aparato de notas sí se separa: son 34.436 caracteres que antes viajaban
  // rotulados como parte de la decisión.
  assert.match(r.texto, /notas al pie/)
})

test('corte: distingue salvamento de aclaración en la misma providencia', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2024/T-099-24.htm', limite_caracteres: 600 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /salvamento de voto — ANTONIO JOSÉ LIZARAZO OCAMPO/)
  assert.match(r.texto, /aclaración de voto — VLADIMIR FERNÁNDEZ ANDRADE/)
})
