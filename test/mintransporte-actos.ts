/**
 * Adaptador Mintransporte sin red: `pedir` se inyecta.
 * - Tabla de actos (/normatividad/actos/): filas con su forma real (epígrafe con enlace,
 *   tema, número, tipo, fecha ISO).
 * - Catálogo antiguo (/documentos/…): páginas por año con bloques `strong.nombre` y campos
 *   `strong.title` (Nombre, Descripción, Fechas), paginadas con `genPagDocs`.
 *
 *   node --test test/mintransporte-actos.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { CanarioError } from '../src/nucleo/parse.ts'
import type { Respuesta, pedir } from '../src/nucleo/http.ts'
import adaptador, { buscar } from '../src/fuentes/sectorial/mintransporte.ts'

const ORIGEN = 'https://mintransporte.gov.co'

const fila = (epigrafe: string, tema: string, numero: string, tipo: string, fecha: string, href: string): string =>
  `<tr>
<td><div class="view_file"><a href="${href}">${epigrafe}</a></div></td>
<td>${tema}</td><td>${numero}</td><td>${tipo}</td><td>${fecha}</td><td></td><td></td><td></td>
</tr>`

const HTML = `<html><body><table id="tableActos"><thead><tr><th>Epígrafe</th></tr></thead><tbody>
${fila('Por la cual se prórroga la modalidad de teletrabajo a unos servidores públicos', 'Prórroga Teletrabajo', '20263040001465', 'Resolucion', '2026-01-16', '/info/mintransporte/media/anexos/owFSxzGX.pdf')}
${fila('Por medio de la cual se declaran días hábiles los sábados de enero de 2025', 'Días hábiles de enero de 2025', '20253040053005', 'Resolucion', '2025-12-23', '/info/mintransporte/media/anexos/LABkaQRY.pdf')}
${fila('Circular sobre tarifas de peajes', 'Tarifas', '20263040000011', 'Circular', '2026-03-02', '/info/mintransporte/media/anexos/circ1.pdf')}
</tbody></table></body></html>`

const conHtml = (cuerpo: string): typeof pedir =>
  (async (): Promise<Respuesta> => ({ status: 200, cuerpo }) as Respuesta) as typeof pedir

/** Mapa ruta → páginas HTML. Sirve `genPagDocs` (1-based) y 404 si la ruta no está. */
type Mapa = Record<string, string[]>
function catalogo(mapa: Mapa): { pedir: typeof pedir; llamadas: string[] } {
  const llamadas: string[] = []
  const fn = (async (url: string): Promise<Respuesta> => {
    llamadas.push(url)
    const u = new URL(url)
    const paginas = mapa[u.pathname]
    if (!paginas) return { status: 404, cuerpo: '' } as Respuesta
    const p = Number(u.searchParams.get('genPagDocs') ?? '1')
    return { status: 200, cuerpo: paginas[p - 1] ?? '' } as Respuesta
  }) as typeof pedir
  return { pedir: fn, llamadas }
}

/** Bloque de documento con la estructura de la página de año (labels en strong.title). */
const item = (archivo: string, descripcion: string, fecha: string): string =>
  `<div class="item">
<div class="row"><div><strong class="title">Nombre</strong></div><div><strong class="nombre">${archivo}</strong></div></div>
<div class="row"><div><strong class="title">Descripción</strong></div><div>${descripcion}</div></div>
<div class="row"><div><strong class="title">Fechas</strong></div><div>Expedición: ${fecha} 00:00:00</div></div>
</div>`

/** Página con sus enlaces de paginación (`genPagDocs`) cuando hay más de una. */
const pagina = (items: string[], paginas = 1): string =>
  `<html><body>${items.join('\n')}${
    paginas > 1
      ? Array.from({ length: paginas }, (_, i) => `<a href="?genPagDocs=${i + 1}&amp;paginateDocs=100">${i + 1}</a>`).join('')
      : ''
  }</body></html>`

test('lee todas las filas con enlace absoluto y año de la fecha ISO', async () => {
  const r = await buscar({}, { pedir: conHtml(HTML) })
  assert.equal(r.total, 3)
  assert.equal(r.items.length, 3)
  assert.deepEqual(r.items[0], {
    tipo: 'Resolucion',
    numero: '20263040001465',
    anio: '2026',
    fecha: '2026-01-16',
    epigrafe: 'Por la cual se prórroga la modalidad de teletrabajo a unos servidores públicos',
    url: 'https://mintransporte.gov.co/info/mintransporte/media/anexos/owFSxzGX.pdf',
  })
  assert.match(r.nota ?? '', /Sin anio solo se consulta la tabla/)
})

test('anio filtra por el año de la fecha de expedición', async () => {
  const r = await buscar({ anio: '2025' }, { pedir: conHtml(HTML) })
  assert.equal(r.total, 1)
  assert.equal(r.items[0]?.numero, '20253040053005')
})

test('texto ignora tildes y mayúsculas, y exige todas las palabras', async () => {
  const r = await buscar({ texto: 'PRORROGA teletrabajo' }, { pedir: conHtml(HTML) })
  assert.equal(r.total, 1)
  assert.equal(r.items[0]?.numero, '20263040001465')
  const ninguno = await buscar({ texto: 'prorroga peajes' }, { pedir: conHtml(HTML) })
  assert.equal(ninguno.total, 0)
})

test('categoria filtra por tipo sin tildes', async () => {
  const r = await buscar({ categoria: 'circular' }, { pedir: conHtml(HTML) })
  assert.equal(r.total, 1)
  assert.equal(r.items[0]?.tipo, 'Circular')
})

test('limite y pagina recortan y declaran el total en nota', async () => {
  const r = await buscar({ limite: 1, pagina: 2 }, { pedir: conHtml(HTML) })
  assert.equal(r.total, 3)
  assert.equal(r.items[0]?.numero, '20253040053005')
  assert.match(r.nota ?? '', /Coinciden 3; se muestran 1 \(página 2\)/)
})

test('si la tabla cambia de forma lanza CanarioError, nunca un vacío', async () => {
  await assert.rejects(buscar({}, { pedir: conHtml('<html><body><p>Nada</p></body></html>') }), CanarioError)
})

test('anio 2023 lee resoluciones del catálogo antiguo, omite avisos y ordena por fecha desc', async () => {
  const { pedir: pedirFn, llamadas } = catalogo({
    '/documentos/811/2023/': [
      pagina([
        item('R.20233040051625-29-11-2023.pdf', '"Por la cual se fija la tarifa de peajes"', '15/03/2023'),
        item('RESOLUCIÓN NÚMERO 1234 DE 2023.pdf', 'Por la cual se regula el transporte', '02/05/2023'),
        item('Aviso Resolucion 2023.pdf', 'Notificación', '20/04/2023'),
      ]),
    ],
    '/documentos/839/resoluciones-direcciones-territoriales-2023/': [pagina([])],
  })
  const r = await buscar({ anio: '2023', categoria: 'Resolucion' }, { pedir: pedirFn })
  assert.equal(r.total, 2)
  assert.deepEqual(r.items.map((a) => a.numero), ['1234', '20233040051625'])
  assert.equal(r.items[0]?.fecha, '2023-05-02')
  assert.equal(r.items[0]?.tipo, 'Resolucion')
  assert.equal(r.items[0]?.url, `${ORIGEN}/documentos/811/2023/`)
  assert.match(r.nota ?? '', /1 entrada\(s\) del catálogo son avisos/)
  assert.equal(llamadas.length, 2)
})

test('anio 2020 con categoria Decreto deduplica la raíz de decretos y filtra por año', async () => {
  const { pedir: pedirFn } = catalogo({
    '/documentos/481/2020/': [pagina([item('DECRETO 0123.pdf', 'Por el cual se fija la tarifa', '10/02/2020')])],
    '/documentos/13/decretos/': [
      pagina([
        item('DECRETO 0123.pdf', 'Por el cual se fija la tarifa', '10/02/2020'),
        item('DECRETO 0456.pdf', 'Por el cual se regula', '20/06/2019'),
      ]),
    ],
  })
  const r = await buscar({ anio: '2020', categoria: 'Decreto' }, { pedir: pedirFn })
  assert.equal(r.total, 1)
  assert.equal(r.items[0]?.tipo, 'Decreto')
  assert.equal(r.items[0]?.numero, '0123')
})

test('anio 2015 solo consulta la raíz de decretos y texto filtra epígrafes', async () => {
  const { pedir: pedirFn, llamadas } = catalogo({
    '/documentos/13/decretos/': [
      pagina([
        item('DECRETO 1 DE 2015.pdf', 'Por el cual se fija la tarifa de peajes', '05/03/2015'),
        item('DECRETO 2 DE 2015.pdf', 'Por el cual se regula otra cosa', '06/03/2015'),
      ]),
    ],
  })
  const r = await buscar({ anio: '2015', texto: 'tarifa' }, { pedir: pedirFn })
  assert.equal(r.total, 1)
  assert.equal(r.items[0]?.numero, '1')
  assert.equal(llamadas.length, 1)
})

test('el tope de 8 peticiones corta la lectura y lo declara en nota', async () => {
  const pagsRes = [1, 2, 3, 4].map((p) => pagina([item(`R.2023000${p}.pdf`, 'Por la cual X', `0${p}/01/2023`)], 4))
  const pagsDt = [1, 2, 3, 4].map((p) => pagina([item(`RES DT 2023-${p}.pdf`, 'Por la cual Y', `0${p}/02/2023`)], 4))
  const { pedir: pedirFn, llamadas } = catalogo({
    '/documentos/811/2023/': pagsRes,
    '/documentos/902/2023/': [pagina([item('DECRETO 0001.pdf', 'Por el cual Z', '10/10/2023')])],
    '/documentos/839/resoluciones-direcciones-territoriales-2023/': pagsDt,
  })
  const r = await buscar({ anio: '2023' }, { pedir: pedirFn })
  assert.equal(llamadas.length, 8)
  assert.equal(r.total, 8)
  assert.match(r.nota ?? '', /Consulta parcial/)
  assert.match(r.nota ?? '', /Resoluciones Direcciones Territoriales 2023/)
})

test('categoria sin secciones en el catálogo antiguo no hace peticiones', async () => {
  const { pedir: pedirFn, llamadas } = catalogo({})
  const r = await buscar({ anio: '2023', categoria: 'Circular' }, { pedir: pedirFn })
  assert.equal(r.total, 0)
  assert.equal(llamadas.length, 0)
  assert.match(r.nota ?? '', /no tiene secciones para 2023/)
})

test('anio con formato inválido lanza error claro', async () => {
  await assert.rejects(buscar({ anio: '15' }, { pedir: conHtml(HTML) }), /AAAA/)
})

test('el adaptador declara id, dominio https y advertencia', () => {
  assert.equal(adaptador.id, 'mintransporte')
  assert.equal(adaptador.nombre, 'Ministerio de Transporte')
  assert.equal(adaptador.dominioPermitido, 'https://mintransporte.gov.co')
  assert.equal(adaptador.soportaTexto, false)
  assert.equal(adaptador.soportaVigencia, false)
  assert.ok(adaptador.advertencia.includes('NO cubre'))
})
