/**
 * Pruebas del TTL y la rotulación de la caché del normograma de la DIAN:
 * segunda consulta dentro del TTL no vuelve a la red, la vencida se refresca, y
 * una caída de red con caché vencida se sirve obsoleta y declarada. Sin red.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { buscar } from '../src/fuentes/normograma.ts'

const DOS_DOCS = JSON.stringify([
  { nombre: 'Decreto 1625 de 2016', link: 'decreto_1625_2016.htm', epigrafe: 'Único Reglamentario', year: '2016', tipo: 'Decreto' },
  { nombre: 'Resolución 55 de 2020', link: 'resolucion_55_2020.htm', epigrafe: 'Renta', year: '2020', tipo: 'Resolución' },
])

function pedirFalso(cuerpo: string, contador: { n: number }, falla = false) {
  return async (): Promise<{ status: number; cuerpo: string }> => {
    contador.n++
    if (falla) throw new Error('red caída')
    return { status: 200, cuerpo }
  }
}

test('segunda consulta dentro del TTL se sirve de caché sin volver a la red', async () => {
  const contador = { n: 0 }
  const r1 = await buscar('retención', 15, 0, { pedir: pedirFalso(DOS_DOCS, contador) })
  assert.equal(contador.n, 1)
  assert.ok(!r1.deCache, 'la primera no viene de caché')

  const r2 = await buscar('retención', 15, 0, { pedir: pedirFalso(DOS_DOCS, contador) })
  assert.equal(contador.n, 1, 'no debe volver a pedir dentro del TTL')
  assert.equal(r2.deCache, true)
  assert.equal(r2.total, 2)
})

test('la caché vencida se refresca y se rotula caducada', async () => {
  const contador = { n: 0 }
  let t = 1_000_000
  const ahora = () => t
  const deps = { pedir: pedirFalso(DOS_DOCS, contador), ahora }

  await buscar('renta', 15, 0, deps)
  assert.equal(contador.n, 1)
  t += 31 * 60 * 1000 // 31 min después: vence
  const r = await buscar('renta', 15, 0, deps)
  assert.equal(contador.n, 2, 'vencida debe refrescarse')
  assert.equal(r.caducada, true)
  assert.ok(!r.deCache, 'la refrescada no es de caché')
})

test('red caída con caché vencida sirve la obsoleta rotulada, sin fallar', async () => {
  const contador = { n: 0 }
  let t = 1_000_000
  const ahora = () => t
  const sano = pedirFalso(DOS_DOCS, contador)
  await buscar('iva', 15, 0, { pedir: sano, ahora })
  t += 31 * 60 * 1000
  const r = await buscar('iva', 15, 0, { pedir: pedirFalso(DOS_DOCS, contador, true), ahora })
  assert.equal(r.obsoleta, true)
  assert.equal(r.deCache, true)
  assert.equal(r.total, 2)
})

test('red caída SIN caché relanza el error', async () => {
  const contador = { n: 0 }
  await assert.rejects(
    () => buscar('nada-guardado', 15, 0, { pedir: pedirFalso(DOS_DOCS, contador, true) }),
    /red caída/,
  )
})

test('"No se encontraron resultados." cachea el vacío y no es un error', async () => {
  const contador = { n: 0 }
  const r1 = await buscar('zzz', 15, 0, { pedir: pedirFalso('No se encontraron resultados.', contador) })
  assert.equal(r1.total, 0)
  const r2 = await buscar('zzz', 15, 0, { pedir: pedirFalso('No se encontraron resultados.', contador) })
  assert.equal(r2.total, 0)
  assert.equal(contador.n, 1, 'el vacío también se cachea')
})
