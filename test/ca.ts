/**
 * Los intermedios que se añaden a la lista de CA completan la cadena hasta una
 * raíz que Node ya trae. Si uno no encadena, el portal que lo necesita vuelve a
 * fallar con «unable to verify the first certificate».
 */
import { strict as assert } from 'node:assert'
import { X509Certificate } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import test from 'node:test'

import * as ca from '../src/nucleo/ca.ts'
import * as letsencrypt from '../src/nucleo/ca_letsencrypt.ts'

const intermedios = Object.entries({ ...ca, ...letsencrypt }).map(([nombre, pem]) => ({ nombre, cert: new X509Certificate(pem) }))
const conocidos = [...rootCertificates.map((pem) => new X509Certificate(pem)), ...intermedios.map((i) => i.cert)]

test('cada intermedio incluido lo firma una CA de la lista, hasta una raíz de Node', () => {
  const sinEmisor = intermedios.filter(({ cert }) =>
    !conocidos.some((c) => c !== cert && cert.checkIssued(c) && cert.verify(c.publicKey)),
  )
  assert.deepEqual(sinEmisor.map((i) => i.nombre), [])
})
