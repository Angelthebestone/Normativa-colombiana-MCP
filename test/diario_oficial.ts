/**
 * Diario Oficial (Imprenta Nacional). Sin red: los fixtures son capturas
 * reales del 2026-09-28 recortadas, y `pedir` va inyectado. El caso de red se
 * salta con SIN_RED=1.
 *
 *   node --test test/diario_oficial.ts
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buscar, leerFormulario, leerPagina, leerParcial, fechaPortal, TIPOS } from '../src/fuentes/diario_oficial.ts'
import { formatear, escribir } from '../src/herramientas/buscar_diario_oficial.ts'
import { pedir, type Respuesta } from '../src/nucleo/http.ts'
import { CanarioError } from '../src/nucleo/parse.ts'

const FIX = new URL('./fixtures/diario-oficial/', import.meta.url)
const fixture = (nombre: string): string => readFileSync(new URL(nombre, FIX), 'utf8')

const BASE_HTML = fixture('listado-100.html')
const FECHAS_HTML = fixture('listado-fechas-29.html')
const LEY_HTML = fixture('ley-2466-1.html')
const PAGINA_2 = fixture('pagina-2.xml')
const PAGINA_3 = fixture('pagina-3.xml')

/** `pedir` de mentira: devuelve los cuerpos en orden y anota lo que se envió. */
function enSecuencia(respuestas: { status?: number; cuerpo: string }[]) {
  const vistas: { url: string; cuerpo: string; extra: Record<string, string> }[] = []
  let i = 0
  const falso = (async (url: string, _timeout?: number, _accept?: string, extra: Record<string, string> = {}, cuerpo?: string) => {
    vistas.push({ url, cuerpo: cuerpo ?? '', extra })
    const r = respuestas[i++]
    if (!r) throw new Error(`petición de más (${i}): ${url}`)
    return {
      status: r.status ?? 200,
      cuerpo: r.cuerpo,
      cookies: 'JSESSIONID=falsa',
      cabeceras: { 'content-type': 'text/html;charset=UTF-8' },
    } as Respuesta
  }) as typeof pedir
  return { falso, vistas }
}

test('el formulario del portal se lee entero y sin los botones de fila', () => {
  const { action, campos } = leerFormulario(BASE_HTML)
  assert.match(action, /^\/diario\/index\.xhtml;jsessionid=/)
  assert.equal(campos['numeroDiarioOf'], '')
  assert.equal(campos['tipoNorma_input'], '')
  assert.match(campos['javax.faces.ViewState'] ?? '', /^-?\d+:-?\d+$/)
  // Los botones «Ver Diario» de cada fila NO viajan: enviados, el portal abre el
  // detalle de la última fila en vez de buscar (medido).
  assert.equal(Object.keys(campos).filter((c) => /j_idt34|btnBuscar|Cancelar/.test(c)).length, 0)
})

test('los códigos del tipo de norma son los del propio portal', () => {
  assert.equal(TIPOS.LEY, '01')
  assert.equal(TIPOS.DECRETO, '02')
  assert.equal(TIPOS.RESOLUCIÓN, '03')
  assert.equal(TIPOS.OTROS, '9999')
})

test('una página sin filtro trae 10 filas de los últimos 100', () => {
  const { items, total } = leerPagina(BASE_HTML)
  assert.equal(total, 100)
  assert.equal(items.length, 10)
  assert.deepEqual(items[0], { numero: '53.640', tipoEdicion: 'Ordinaria', fecha: '27/09/2026' })
  assert.deepEqual(items.at(-1), { numero: '53.631', tipoEdicion: 'Ordinaria', fecha: '18/09/2026' })
})

test('la respuesta filtrada por fechas declara 29 diarios', () => {
  const { items, total } = leerPagina(FECHAS_HTML)
  assert.equal(total, 29)
  assert.equal(items.length, 10)
  assert.equal(items[0]!.numero, '53.640')
})

test('el filtro por tipo y número de norma devuelve el diario que la publicó', () => {
  const { items, total } = leerPagina(LEY_HTML)
  assert.equal(total, 1)
  assert.deepEqual(items[0], { numero: '53.160', tipoEdicion: 'Ordinaria', fecha: '25/06/2025' })
})

test('las páginas siguientes llegan en el partial del paginador', () => {
  const p2 = leerParcial(PAGINA_2)
  assert.equal(p2.length, 10)
  // El 53.630 es una edición EXTRAORDINARIA (17/09/2026): el tipo de edición de
  // cada fila es un dato del portal y se transcribe tal cual.
  assert.deepEqual(p2[0], { numero: '53.630', tipoEdicion: 'Extraordinaria', fecha: '17/09/2026' })
  const p3 = leerParcial(PAGINA_3)
  assert.equal(p3.length, 9)
  assert.equal(p3.at(-1)!.numero, '53.612')
})

test('el canario nombra lo que falta y no culpa a los datos', () => {
  assert.throws(() => leerFormulario('<html><body>otra cosa</body></html>'), CanarioError)
  assert.throws(() => leerFormulario(BASE_HTML.replace(/id="frmConDiario"/g, 'id="otro"')), CanarioError)
  assert.throws(() => leerFormulario(BASE_HTML.replace(/id="dtbDiariosOficiales"/g, 'id="otra"')), CanarioError)
  assert.throws(() => leerPagina(BASE_HTML.replace(/dtbDiariosOficiales_paginator_top/g, 'pag')), CanarioError)
  // Con filas declaradas y ninguna legible, el fallo es del parseo: parece un
  // vacío y no lo es.
  const sinFilas = BASE_HTML.replace(/<label id="dtbDiariosOficiales:\d+:numeroDiario"[^>]*>[^<]*<\/label>/g, '')
  assert.throws(() => leerPagina(sinFilas), CanarioError)
  assert.throws(() => leerParcial('<partial-response><changes></changes></partial-response>'), CanarioError)
})

test('buscar envía solo el botón pulsado y con los filtros pedidos', async () => {
  const { falso, vistas } = enSecuencia([{ cuerpo: BASE_HTML }, { cuerpo: LEY_HTML }])
  const r = await buscar({ tipo: 'LEY', numeroNorma: '2466' }, { pedir: falso })
  assert.equal(r.total, 1)
  assert.equal(r.items[0]!.numero, '53.160')

  const envio = new URLSearchParams(vistas[1]!.cuerpo)
  assert.equal(envio.get('tipoNorma_input'), '01')
  assert.equal(envio.get('numeroNorma'), '2466')
  assert.equal([...envio.keys()].filter((k) => k.endsWith(':j_idt34')).length, 0)
  assert.ok(envio.has('btnBuscar'))
  assert.match(vistas[1]!.extra['Cookie'] ?? '', /JSESSIONID=/)
  assert.equal(vistas[1]!.extra['Content-Type'], 'application/x-www-form-urlencoded')
})

test('buscar pagina por ajax hasta el límite pedido', async () => {
  const { falso, vistas } = enSecuencia([
    { cuerpo: BASE_HTML },
    { cuerpo: FECHAS_HTML },
    { cuerpo: PAGINA_2 },
    { cuerpo: PAGINA_3 },
  ])
  const r = await buscar({ desde: '01/09/2026', hasta: '30/09/2026', limite: 25 }, { pedir: falso })
  assert.equal(r.total, 29)
  assert.equal(r.items.length, 25, 'tres páginas de 10 traen 29 filas, pero el límite es 25')
  assert.equal(r.items[10]!.numero, '53.630')
  assert.equal(r.items.at(-1)!.numero, leerParcial(PAGINA_3)[4]!.numero)

  const filtro = new URLSearchParams(vistas[1]!.cuerpo)
  assert.equal(filtro.get('fechaInicial_input'), '01/09/2026')
  assert.equal(filtro.get('fechaFinal_input'), '30/09/2026')
  for (const [n, first] of [[2, '10'], [3, '20']] as const) {
    const envio = new URLSearchParams(vistas[n]!.cuerpo)
    assert.equal(envio.get('javax.faces.partial.ajax'), 'true')
    assert.equal(envio.get('dtbDiariosOficiales_first'), first)
    assert.equal(envio.get('dtbDiariosOficiales_rows'), '10')
    assert.equal(envio.get('fechaInicial_input'), '01/09/2026', 'la página siguiente conserva el filtro')
    assert.equal(vistas[n]!.extra['Faces-Request'], 'partial/ajax')
  }
})

test('un límite menor que la página del portal recorta: limite=5 devuelve 5 y dice cuántos faltan', async () => {
  const { falso, vistas } = enSecuencia([{ cuerpo: BASE_HTML }, { cuerpo: FECHAS_HTML }])
  const filtros = { desde: '01/09/2026', hasta: '30/09/2026' }
  const r = await buscar({ ...filtros, limite: 5 }, { pedir: falso })
  assert.equal(vistas.length, 2, 'no se pide ninguna página de más')
  assert.equal(r.items.length, 5)
  assert.equal(r.total, 29)
  assert.equal(r.items[0]!.numero, '53.640', 'los más recientes')
  assert.match(formatear(r, { ...filtros, limite: 5 }, filtros), /se muestran 5 .*\n[\s\S]*Faltan 24\./)
})

test('con menos filas que el límite no se pide ninguna página de más', async () => {
  const { falso, vistas } = enSecuencia([{ cuerpo: BASE_HTML }, { cuerpo: LEY_HTML }])
  const r = await buscar({ limite: 50 }, { pedir: falso })
  assert.equal(vistas.length, 2)
  assert.equal(r.items.length, 1)
})

test('un HTTP de error dice el código antes de culpar a la plantilla', async () => {
  const { falso } = enSecuencia([{ status: 503, cuerpo: '<html>GlassFish</html>' }])
  await assert.rejects(
    () => buscar({}, { pedir: falso }),
    (e: Error) => !(e instanceof CanarioError) && /503/.test(e.message),
  )
})

test('una fecha mal formada no viaja al portal', async () => {
  assert.equal(fechaPortal('2026-09-27'), '27/09/2026')
  assert.equal(fechaPortal('27/09/2026'), '27/09/2026')
  assert.equal(fechaPortal('1/9/2026'), '01/09/2026')
  assert.equal(fechaPortal('2026-13-01'), null)
  assert.equal(fechaPortal('ayer'), null)
})

test('las llamadas que no pueden responder no llegan a salir', async () => {
  const sinTipo = await escribir({ numero_norma: '2466', limite: 20 })
  assert.match(sinTipo, /sin consultar ninguna fuente/)
  assert.match(sinTipo, /Falta "tipo"/)

  const tipoSuelto = await escribir({ tipo: 'LEY', limite: 20 })
  assert.match(tipoSuelto, /sin consultar ninguna fuente/)
  assert.match(tipoSuelto, /2\.167/)

  const malaFecha = await escribir({ desde: 'ayer', limite: 20 })
  assert.match(malaFecha, /sin consultar ninguna fuente/)
  assert.match(malaFecha, /27\/09\/2026/)

  const invertida = await escribir({ desde: '2026-09-30', hasta: '2026-09-01', limite: 20 })
  assert.match(invertida, /El rango está invertido/)
})

test('la respuesta declara el alcance, el vacío y lo que NO cubre', () => {
  const conFilas = formatear({ items: leerPagina(FECHAS_HTML).items, total: 29 }, { desde: '01/09/2026', hasta: '30/09/2026', limite: 20 }, { desde: '01/09/2026', hasta: '30/09/2026' })
  assert.match(conFilas, /Alcance: consulté la consulta pública de diarios publicados de la Imprenta Nacional/)
  assert.match(conFilas, /Ninguna otra fuente/)
  assert.match(conFilas, /29 diario\(s\)/)
  assert.match(conFilas, /1\. Diario 53\.640 — Ordinaria — 27\/09\/2026/)
  assert.match(conFilas, /NO dice esto/)
  assert.match(conFilas, /404/)
  assert.match(conFilas, /un vacío aquí NO prueba que la norma no exista/i)

  const vacio = formatear({ items: [], total: 0 }, { desde: '28/09/2026', hasta: '28/09/2026', limite: 20 }, { desde: '28/09/2026', hasta: '28/09/2026' })
  assert.match(vacio, /no lista ningún diario con esos filtros/)
  assert.match(vacio, /Eso NO significa que la norma no se haya publicado/)
})

// --- red ----------------------------------------------------------------

const RED = { timeout: 240_000, skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }

test('red: el catálogo responde y cada fila trae número, edición y fecha', RED, async () => {
  const r = await buscar({ limite: 10 }, { pedir })
  assert.ok(r.total > 0, 'el portal debe listar diarios')
  assert.equal(r.items.length, Math.min(10, r.total))
  for (const d of r.items) {
    assert.match(d.numero, /^\d{1,3}(\.\d{3})*$/)
    assert.match(d.fecha, /^\d{2}\/\d{2}\/\d{4}$/)
    assert.ok(d.tipoEdicion.length > 3)
  }

  // Buscar por el número que acaba de devolver el portal tiene que devolver ese
  // mismo diario: así la prueba no envejece con los números de hoy.
  const uno = await buscar({ numero: r.items[0]!.numero }, { pedir })
  assert.equal(uno.total, 1)
  assert.deepEqual(uno.items[0], r.items[0])
})

test('red: el número de una norma encuentra el diario que la publicó', RED, async () => {
  const r = await buscar({ tipo: 'LEY', numeroNorma: '2466' }, { pedir })
  assert.equal(r.total, 1)
  assert.equal(r.items[0]!.numero, '53.160')
  assert.equal(r.items[0]!.fecha, '25/06/2025')
})
