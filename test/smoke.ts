/**
 * Pruebas contra las fuentes reales. Cubren los escenarios que rompen una
 * implementación ingenua: normas gigantes, basura de Word, ids inexistentes,
 * stopwords que inundan el resultado y el canario anti-rotura.
 *
 *   npm test
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { parsearCita, idTipo } from '../src/citas.ts'
import {
  CanarioError,
  advertenciasVigencia,
  articulo,
  fragmentos,
  parseResultados,
  sinTildes,
  trocear,
} from '../src/parse.ts'
import * as gestor from '../src/fuentes/gestor.ts'
import * as corte from '../src/fuentes/corte.ts'

const RED = { timeout: 180_000 }

// --- lógica pura ---------------------------------------------------------

test('el parser de citas entiende las formas colombianas', () => {
  assert.deepEqual(parsearCita('Ley 909 de 2004'), { tipo: 'ley', numero: '909', anio: '2004', articulo: undefined })
  assert.equal(parsearCita('Decreto 1083')?.numero, '1083')
  assert.equal(parsearCita('C-337/11')?.sentencia, 'C-337/11')
  assert.equal(parsearCita('T-099/24')?.sentencia, 'T-099/24')
  assert.equal(parsearCita('Sentencia C-351 de 2013')?.anio, '2013')
  assert.equal(parsearCita('artículo 6 de la Ley 1221 de 2008')?.articulo, '6')
  assert.equal(parsearCita('art. 2.2.5.1.5 del Decreto 1083')?.articulo, '2.2.5.1.5')
  assert.equal(parsearCita('¿cuánto cuesta el pan?'), null)
  assert.equal(idTipo('ley'), 18)
  assert.equal(idTipo('Decreto'), 11)
})

test('las stopwords se descartan: son las que inundan el resultado', () => {
  const r = gestor.quitarStopwords('auxilio de conectividad')
  assert.equal(r.usadas, 'auxilio conectividad')
  assert.deepEqual(r.descartadas, ['de'])
})

test('el saneamiento quita lo que hace fallar al portal con 500', () => {
  assert.equal(gestor.limpiarTermino('Ley 80 "de 1993"'), 'Ley 80 de 1993')
  assert.equal(gestor.limpiarTermino("<script>'x'"), 'script x')
})

test('sinTildes conserva la longitud, para poder cortar por índice', () => {
  assert.equal(sinTildes('gestión'), 'gestion')
  assert.equal(sinTildes('Ñoño áéíóú').length, 'Ñoño áéíóú'.length)
})

test('el troceado informa cuánto omite', () => {
  const t = trocear('a'.repeat(1000), 0, 100)
  assert.equal(t.texto.length, 100)
  assert.equal(t.omitido, 900)
  assert.equal(t.total, 1000)
})

test('fragmentos encuentra sin importar tildes y recorta con contexto', () => {
  const texto = 'El auxilio de conectividad reemplaza el auxilio de transporte para teletrabajadores.'
  const f = fragmentos(texto, 'CONECTIVIDAD', 20)
  assert.equal(f.total, 1)
  assert.match(f.trozos[0]!, /conectividad/i)
  assert.equal(fragmentos('la gestión pública', 'gestion').total, 1)
})

test('se extrae un artículo puntual y se detecta la derogatoria', () => {
  const texto = 'ARTÍCULO 5. Uno. ARTÍCULO 6. Derogado por la Ley 2 de 2020. Dos. ARTÍCULO 7. Tres.'
  const a6 = articulo(texto, '6')
  assert.match(a6!, /Derogado/)
  assert.doesNotMatch(a6!, /Tres/)
  assert.equal(advertenciasVigencia(a6!).length, 1)
  assert.equal(advertenciasVigencia('texto sin marcas').length, 0)
})

test('el canario grita en vez de devolver una lista vacía', () => {
  assert.throws(() => parseResultados('<div>el portal cambió</div>'), CanarioError)
  // Hay total pero ningún enlace: es rotura, no ausencia de resultados.
  assert.throws(() => parseResultados('encontrados: 5 <div></div>'), CanarioError)
  assert.equal(parseResultados('encontrados: 0').total, 0)
})

// --- Gestor Normativo ----------------------------------------------------

test('buscar_normas encuentra la Ley 1221 de 2008', RED, async () => {
  const r = await gestor.buscar({ palabras: 'teletrabajo', tipo: 'Ley' })
  assert.ok(r.items.some((i) => i.id === '31431'), 'debería aparecer la Ley 1221 de 2008')
})

test('la cita exacta devuelve un solo resultado', RED, async () => {
  const r = await gestor.buscar({ tipo: 18, numero: 909, anio: 2004 })
  assert.equal(r.total, 1)
  assert.match(r.items[0]!.titulo, /Ley 909 de 2004/)
})

test('el Decreto 1083 no se devuelve entero: son 925.000 caracteres', RED, async () => {
  const n = await gestor.obtenerNorma(62866)
  assert.ok(n.texto.length > 500_000, `el texto completo debería ser enorme, fue ${n.texto.length}`)
  assert.ok(trocear(n.texto).texto.length <= 8000)
  const f = fragmentos(n.texto, 'encargo')
  assert.ok(f.total > 0, 'la búsqueda dentro del texto debería encontrar "encargo"')
})

test('los documentos viejos salen sin basura de Word', RED, async () => {
  const n = await gestor.obtenerNorma(293) // Ley 114 de 1913
  assert.doesNotMatch(n.texto, /mso-|Hewlett-Packard|Style Definitions/i)
  assert.ok(n.texto.length > 200)
})

test('un id inexistente se reporta como inexistente', RED, async () => {
  await assert.rejects(() => gestor.obtenerNorma(99999999), /No existe/)
})

test('las comillas no revientan la búsqueda', RED, async () => {
  const r = await gestor.buscar({ palabras: 'Ley 80 "de 1993"' })
  assert.ok(r.total >= 0)
})

test('el restrictor explica por qué la norma aplica al subtema', RED, async () => {
  const r = await gestor.restrictor(24928, 31431)
  assert.ok(r.length > 50, 'el restrictor no debería venir vacío')
})

test('los catálogos traen los tipos de documento', RED, async () => {
  const c = await gestor.catalogos()
  assert.ok(c.tipos.length >= 25, `tipos: ${c.tipos.length}`)
  assert.ok(c.temas.length > 1000, `temas: ${c.temas.length}`)
})

// --- Corte Constitucional ------------------------------------------------

test('la relatoría encuentra jurisprudencia sobre teletrabajo', RED, async () => {
  const r = await corte.buscar({ termino: 'teletrabajo', limite: 20 })
  const nums = r.items.map((p) => p.sentencia.replace(/[\s.]/g, ''))
  assert.ok(nums.some((s) => s.includes('T-099/24')), `esperaba T-099/24, hubo: ${nums.join(', ')}`)
  assert.ok(nums.some((s) => s.includes('C-337/11')), 'esperaba C-337/11')
})

test('el texto de una providencia se trocea', RED, async () => {
  const doc = await corte.obtenerTexto('2024/T-099-24.htm')
  assert.ok(doc.texto.length > 50_000, `texto: ${doc.texto.length}`)
  assert.ok(trocear(doc.texto).texto.length <= 8000)
})

test('la relatoría está al día: hay providencias recientes', RED, async () => {
  const u = await corte.ultimas(5)
  assert.ok(u.length > 0)
  const masReciente = u.map((p) => p.publicacion).sort().at(-1)!
  const dias = (Date.now() - Date.parse(masReciente)) / 86_400_000
  assert.ok(dias < 120, `la publicación más reciente es de hace ${Math.round(dias)} días`)
})
