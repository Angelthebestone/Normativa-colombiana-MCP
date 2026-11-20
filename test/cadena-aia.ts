/**
 * Completar la cadena de un portal que envía su hoja sin el intermedio: lo que se
 * acepta de lo bajado por la URL AIA y lo que se rechaza. Sin red: la descarga va
 * inyectada. Las fixtures son una PKI de prueba, raíz -> intermedio 1 ->
 * intermedio 2 -> hoja, con validez de 100 años y solo los certificados públicos
 * (generada con `openssl req -x509` / `openssl x509 -req -extfile`). `i2-falso` se hace
 * pasar por `i2` y por emitido por `i1`, pero lo firma otra clave; `noca` es un certificado de hoja
 * firmado por la raíz.
 */
import { strict as assert } from 'node:assert'
import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { completarCadena, type DescargarIntermedio } from '../src/nucleo/http/cadena_aia.ts'

const FIX = new URL('./fixtures/cadena-aia/', import.meta.url)
const leer = (nombre: string): X509Certificate => new X509Certificate(readFileSync(new URL(`${nombre}.pem`, FIX)))

const [raiz, i1, i2, i2Falso] = ['raiz', 'i1', 'i2', 'i2-falso'].map(leer) as [X509Certificate, X509Certificate, X509Certificate, X509Certificate]
const AHORA = new Date('2030-01-01T00:00:00Z')

function servidor(porUrl: Record<string, X509Certificate>): { descargar: DescargarIntermedio; pedidas: string[] } {
  const pedidas: string[] = []
  const descargar: DescargarIntermedio = async (url) => {
    pedidas.push(url.href)
    const cert = porUrl[url.href]
    if (!cert) throw new Error(`404: ${url.href}`)
    return cert.raw
  }
  return { descargar, pedidas }
}

const COMPLETO = { 'http://aia.ejemplo.test/i2.cer': i2, 'http://aia.ejemplo.test/i1.cer': i1 }

test('sigue la AIA de eslabón en eslabón hasta una raíz de confianza y devuelve los que faltaban', async () => {
  const { descargar, pedidas } = servidor(COMPLETO)
  const eslabones = await completarCadena(leer('hoja'), { raices: [raiz], descargar, ahora: AHORA })
  assert.deepEqual(eslabones?.map((e) => e.subject), [i2.subject, i1.subject])
  assert.deepEqual(pedidas, ['http://aia.ejemplo.test/i2.cer', 'http://aia.ejemplo.test/i1.cer'])
})

test('no acepta un intermedio que se dice emitido por el eslabón correcto pero lo firmó otra clave', async () => {
  const { descargar } = servidor({ 'http://aia.ejemplo.test/i2.cer': i2Falso })
  assert.equal(await completarCadena(leer('hoja'), { raices: [raiz], descargar, ahora: AHORA }), null)
})

test('no acepta como emisor un certificado que no es de una CA, aunque la raíz lo firme', async () => {
  const { descargar } = servidor({ 'http://aia.ejemplo.test/noca.cer': leer('noca') })
  assert.equal(await completarCadena(leer('hoja-noca'), { raices: [raiz], descargar, ahora: AHORA }), null)
})

test('no acepta una cadena que no llega a ninguna de las raíces de confianza', async () => {
  const { descargar } = servidor(COMPLETO)
  assert.equal(await completarCadena(leer('hoja'), { raices: [i2Falso], descargar, ahora: AHORA }), null)
})

test('no acepta un intermedio vencido', async () => {
  const { descargar } = servidor(COMPLETO)
  const dentroDeDosSiglos = new Date('2230-01-01T00:00:00Z')
  assert.equal(await completarCadena(leer('hoja'), { raices: [raiz], descargar, ahora: dentroDeDosSiglos }), null)
})

test('una hoja sin AIA no tiene de dónde completarse', async () => {
  const { descargar, pedidas } = servidor(COMPLETO)
  assert.equal(await completarCadena(leer('hoja-sin-aia'), { raices: [raiz], descargar, ahora: AHORA }), null)
  assert.deepEqual(pedidas, [])
})

test('no sale a una IP ni a un esquema que no sea http aunque la hoja lo pida', async () => {
  const { descargar, pedidas } = servidor(COMPLETO)
  for (const hoja of ['hoja-local', 'hoja-archivo']) {
    assert.equal(await completarCadena(leer(hoja), { raices: [raiz], descargar, ahora: AHORA }), null)
  }
  assert.deepEqual(pedidas, [])
})

test('si el emisor declarado no responde, la cadena queda sin completar y el error se propaga', async () => {
  const { descargar } = servidor({})
  await assert.rejects(completarCadena(leer('hoja'), { raices: [raiz], descargar, ahora: AHORA }), /404/)
})
