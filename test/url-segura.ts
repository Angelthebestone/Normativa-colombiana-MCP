/**
 * Enlaces que trae quien llama: la lectura sectorial no sale fuera del origen
 * de su regulador (SSRF) y validar_cita no da por bueno un enlace que no es
 * https ni un id que solo está contenido en otro. Sin red: el servidor local
 * cuenta las peticiones que le llegan, que deben ser cero.
 *
 *   node --test test/url-segura.ts
 */
import { strict as assert } from 'node:assert'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'

import '../src/fuentes/sectorial/registro.ts'
import { adaptador } from '../src/fuentes/sectorial.ts'
import { escribir as obtenerDocumento } from '../src/herramientas/obtener_documento.ts'
import { escribir as validarCita } from '../src/herramientas/validar_cita.ts'
import { parametroEs, validarUrl } from '../src/nucleo/evidencia.ts'

const SIC = adaptador('sic')!.dominioPermitido

/** Levanta un servidor en 127.0.0.1, ejecuta `f` con su URL y devuelve cuántas peticiones recibió. */
async function peticionesDurante(f: (base: string) => Promise<void>): Promise<number> {
  let n = 0
  const servidor = createServer((_req, res) => {
    n++
    res.end('<html><body>' + 'interno '.repeat(100) + '</body></html>')
  })
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
  try {
    await f(`http://127.0.0.1:${(servidor.address() as AddressInfo).port}`)
  } finally {
    servidor.close()
  }
  return n
}

test('sectorial: un enlace HTML a 127.0.0.1 se rechaza sin hacer la petición', async () => {
  const n = await peticionesDurante((base) =>
    assert.rejects(() => obtenerDocumento({ fuente: 'sectorial', entidad: 'sic', url: `${base}/acto.html` }), /dominio permitido/),
  )
  assert.equal(n, 0)
})

test('sectorial: con entero tampoco se descarga de un origen ajeno', async () => {
  let descargas = 0
  const pedirBytes = async () => {
    descargas++
    return { status: 200, datos: Buffer.from('x'), contentType: 'application/pdf' }
  }
  const n = await peticionesDurante((base) =>
    assert.rejects(
      () => obtenerDocumento({ fuente: 'sectorial', entidad: 'sic', url: `${base}/acto.pdf`, entero: true }, { pedirBytes }),
      /dominio permitido/,
    ),
  )
  assert.equal(n, 0)
  assert.equal(descargas, 0)
})

test('sectorial: el host del regulador por http, en otro puerto o con credenciales se rechaza', async () => {
  const host = new URL(SIC).host
  let descargas = 0
  const pedirBytes = async () => {
    descargas++
    return { status: 200, datos: Buffer.from('x'), contentType: 'application/pdf' }
  }
  for (const [url, error] of [
    [`http://${host}/acto.pdf`, /dominio permitido/],
    [`https://${host}:8443/acto.pdf`, /dominio permitido/],
    [`https://usuario:clave@${host}/acto.pdf`, /credenciales/],
    ['no es un enlace', /Enlace inválido/],
  ] as const) {
    await assert.rejects(() => obtenerDocumento({ fuente: 'sectorial', entidad: 'sic', url }, { pedirBytes }), error, url)
  }
  assert.equal(descargas, 0)
})

test('sectorial: un enlace del origen exacto sí llega a la descarga', async () => {
  let descargas = 0
  const pedirBytes = async () => {
    descargas++
    return { status: 404, datos: Buffer.alloc(0), contentType: 'application/pdf' }
  }
  await assert.rejects(
    () => obtenerDocumento({ fuente: 'sectorial', entidad: 'sic', url: `${SIC}/acto.pdf` }, { pedirBytes }),
    /respondió 404/,
  )
  assert.equal(descargas, 1)
})

test('validarUrl: solo https con el dominio esperado', () => {
  assert.equal(validarUrl('https://www.funcionpublica.gov.co/x?i=1', 'funcionpublica.gov.co'), true)
  assert.equal(validarUrl('javascript://funcionpublica.gov.co/?i=1', 'funcionpublica.gov.co'), false)
  assert.equal(validarUrl('http://www.funcionpublica.gov.co/x?i=1', 'funcionpublica.gov.co'), false)
  assert.equal(validarUrl('ftp://funcionpublica.gov.co/x', 'funcionpublica.gov.co'), false)
})

test('parametroEs: compara el valor del parámetro, no una subcadena', () => {
  assert.equal(parametroEs('https://x.gov.co/n.php?i=123', 'i', '123'), true)
  assert.equal(parametroEs('https://x.gov.co/n.php?i=1234', 'i', '123'), false)
  assert.equal(parametroEs('https://x.gov.co/n.php?xi=123', 'i', '123'), false)
  assert.equal(parametroEs('https://x.gov.co/n.php#i=123', 'i', '123'), false)
  assert.equal(parametroEs('no es url', 'i', '123'), false)
})

/** `buscar` falso del Gestor con un único item, id 123 (sin red). */
const buscar = async () => ({
  total: 1,
  aplicados: [],
  items: [
    { id: '123', titulo: 'LEY 909 DE 2004', resumen: '', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=123' },
  ],
})

test('validar_cita: un enlace no https o con otro id no sale como cita validada', async () => {
  for (const url of [
    'javascript://funcionpublica.gov.co/?i=123',
    'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=1234',
    'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?xi=123',
  ]) {
    const d = JSON.parse(await validarCita({ cita: 'Ley 909 de 2004', url, formato: 'json' }, { buscar }))
    assert.notEqual(d.resultado, 'cita validada', url)
  }
  const ok = JSON.parse(
    await validarCita(
      { cita: 'Ley 909 de 2004', url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=123', formato: 'json' },
      { buscar },
    ),
  )
  assert.equal(ok.resultado, 'cita validada')
})
