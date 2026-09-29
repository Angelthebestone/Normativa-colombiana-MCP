/**
 * Pruebas de `scripts/salud.ts`: solo la lógica de clasificación y la
 * coherencia de la tabla de portales. NO usa red (inyecta sondas sintéticas).
 *
 *   node --test test/salud.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { clasificar, PORTALES, type Forma, type Sonda } from '../scripts/salud.ts'

/** Forma que da por bueno cualquier cuerpo: aísla la frontera de tiempo. */
const bien: Forma = () => null
/** Forma que rechaza siempre, con un motivo reconocible. */
const mal: Forma = () => 'no trae los datos esperados'

const PORTAL_URL = 'https://portal.example.gov.co/buscar?q=x'

const ver = (s: Sonda, forma: Forma = bien): string => clasificar(s, forma, PORTAL_URL).veredicto

test('un error de red es CAÍDO y conserva el motivo literal', () => {
  const r = clasificar({ ms: 30, error: 'getaddrinfo ENOTFOUND no-existe.gov.co.invalid' }, bien, PORTAL_URL)
  assert.equal(r.veredicto, 'CAÍDO')
  assert.match(r.motivo!, /ENOTFOUND/)
})

test('el timeout es CAÍDO con el tiempo agotado en el motivo', () => {
  const r = clasificar({ ms: 2000, error: 'tiempo de espera agotado tras 2000 ms' }, bien, PORTAL_URL)
  assert.equal(r.veredicto, 'CAÍDO')
  assert.match(r.motivo!, /tiempo de espera agotado/)
})

test('un 5xx que `pedir` relanza es CAÍDO', () => {
  // `pedir` lanza para 5xx, así que el estado no llega como `status` sino como error.
  assert.equal(ver({ ms: 120, error: 'El portal respondió 502.' }), 'CAÍDO')
})

test('200 con la forma esperada dentro de 5 s es OK; por encima es LENTO', () => {
  assert.equal(ver({ ms: 800, status: 200, cuerpo: 'datos' }), 'OK')
  assert.equal(ver({ ms: 5000, status: 200, cuerpo: 'datos' }), 'OK')
  assert.equal(ver({ ms: 5001, status: 200, cuerpo: 'datos' }), 'LENTO')
})

test('200 con la forma equivocada es MANTENIMIENTO/PÁGINA DE ERROR y dice qué faltó', () => {
  const r = clasificar({ ms: 90, status: 200, cuerpo: 'armazón vacío' }, mal, PORTAL_URL)
  assert.equal(r.veredicto, 'MANTENIMIENTO/PÁGINA DE ERROR')
  assert.match(r.motivo!, /no trae los datos esperados/)
})

test('200 con página de mantenimiento la reconoce `diagnosticarRespuesta`', () => {
  const s: Sonda = { ms: 50, status: 200, cuerpo: '<h1>Sitio en mantenimiento</h1>' }
  const r = clasificar(s, bien, PORTAL_URL)
  assert.equal(r.veredicto, 'MANTENIMIENTO/PÁGINA DE ERROR')
  assert.match(r.motivo!, /mantenimiento/i)
})

test('un 404 no es una caída de red: es una página de error', () => {
  assert.equal(ver({ ms: 40, status: 404, cuerpo: 'not found' }), 'MANTENIMIENTO/PÁGINA DE ERROR')
})

test('una redirección a la misma URL (bucle, el síntoma de SUIN) es página de error', () => {
  const s: Sonda = { ms: 40, status: 301, cuerpo: '', cabeceras: { location: PORTAL_URL } }
  const r = clasificar(s, bien, PORTAL_URL)
  assert.equal(r.veredicto, 'MANTENIMIENTO/PÁGINA DE ERROR')
  assert.match(r.motivo!, /bucle/i)
})

test('cada portal declara nombre, URL absoluta, nota y una forma que rechaza el cuerpo vacío', () => {
  assert.ok(PORTALES.length >= 20, `esperaba al menos 20 portales, hay ${PORTALES.length}`)
  const nombres = new Set<string>()
  for (const p of PORTALES) {
    assert.ok(p.nombre.trim(), 'portal sin nombre')
    // http: solo el Senado, cuyo puerto 443 no abre (documentado en su nota).
    const protocolo = new URL(p.url).protocol
    assert.ok(protocolo === 'https:' || protocolo === 'http:', `${p.nombre}: URL no absoluta (${p.url})`)
    assert.ok(p.nota.trim(), `${p.nombre}: falta la justificación de la URL`)
    assert.ok(!nombres.has(p.nombre), `portal duplicado: ${p.nombre}`)
    nombres.add(p.nombre)
    // Un cuerpo vacío nunca es la forma esperada: si `forma('')` devuelve null,
    // la sonda daría OK ante un portal que responde 200 sin nada dentro.
    assert.notEqual(p.forma('', 200), null, `${p.nombre}: la forma acepta el cuerpo vacío`)
  }
})
