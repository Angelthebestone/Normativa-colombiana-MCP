/**
 * Advertencia de «portal roto»: discordancia entre el número del epígrafe y el
 * del archivo enlazado. Regla conservadora: solo marca cuando hay discordancia
 * clara; un archivo genérico o una variante del mismo número no marca.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { buscar as buscarMintrabajo } from '../src/fuentes/sectorial/mintrabajo.ts'
import type { pedir, Respuesta } from '../src/nucleo/http.ts'
import {
  advertenciaPortalRoto,
  diagnosticarRespuesta,
  fechaCorta,
  numeroDelArchivo,
  numeroDelEpigrafe,
  rotuloCopia,
} from '../src/nucleo/portal-roto.ts'

test('discordancia clara devuelve advertencia', () => {
  const aviso = advertenciaPortalRoto('Ley 2021 de 2021', 'https://www.mintrabajo.gov.co/documents/d/guest/ley-2101-2021.pdf')
  assert.ok(aviso)
  assert.match(aviso!, /2021/)
  assert.match(aviso!, /2101/)
  assert.match(aviso!, /Verifica antes de citar/)
})

test('concordancia no marca', () => {
  assert.equal(advertenciaPortalRoto('Resolución 1234 de 2020', 'https://x.gov.co/resolucion-1234-2020.pdf'), null)
})

test('archivo genérico sin número no marca', () => {
  assert.equal(advertenciaPortalRoto('Ley 100 de 1993', 'https://x.gov.co/documents/documento.pdf'), null)
  assert.equal(advertenciaPortalRoto('Decreto 1072 de 2015', 'https://x.gov.co/acta'), null)
})

test('variante del mismo número (subcadena) no marca', () => {
  assert.equal(advertenciaPortalRoto('Ley 1333 de 2009', 'https://x.gov.co/ley-1333-2009.pdf'), null)
})

test('epígrafe sin número no marca', () => {
  assert.equal(advertenciaPortalRoto('Lineamientos generales', 'https://x.gov.co/resolucion-1234.pdf'), null)
})

test('numeroDelEpigrafe y numeroDelArchivo extraen lo esperado', () => {
  assert.deepEqual(numeroDelEpigrafe('Ley 2021 de 2021'), ['2021'])
  assert.deepEqual(numeroDelEpigrafe('Resolución No. 056 del 28 de abril'), ['056'])
  // El año del archivo no cuenta como número de norma: "ley-2101-2021.pdf" → solo "2101".
  assert.deepEqual(numeroDelArchivo('https://x.gov.co/documents/d/guest/ley-2101-2021.pdf'), ['2101'])
  assert.deepEqual(numeroDelArchivo('https://x.gov.co/documento.pdf'), [])
})

test('el nombre del archivo se compara decodificado: «%201227» ya no se lee 201227', () => {
  assert.deepEqual(
    numeroDelArchivo('https://x.gov.co/documents/d/guest/DECRETO%201227%20DEL%2018%20DE%20JULIO%20DE%202022.pdf'),
    ['1227'],
  )
  // Un «%» que no es un escape válido no rompe la comparación: se usa el nombre tal cual.
  assert.deepEqual(numeroDelArchivo('https://x.gov.co/documents/d/guest/ley-1333-100%-2009.pdf'), ['1333', '100'])
  assert.deepEqual(numeroDelArchivo('https://x.gov.co/documents/d/guest/ley-2101-2021.pdf'), ['2101'])
})

// --- Mintrabajo: el número propio del acto es el de su celda «Norma», no el del epígrafe ---

const fila = (tipo: string, norma: string, epigrafe: string, fecha: string, href: string) =>
  `<tr><td data-label="Tipo de norma">${tipo}</td><td data-label="Norma">${norma}</td>` +
  `<td data-label="Epígrafe">${epigrafe}</td><td data-label="Fecha">${fecha}</td>` +
  `<td data-label="Acceso"><a href="${href}">Descargar</a></td></tr>`

const conFilas = (...filas: string[]) => ({
  pedir: (async () => ({ status: 200, cuerpo: `<table><tbody>${filas.join('')}</tbody></table>`, cookies: '', cabeceras: {} }) as Respuesta) as typeof pedir,
})

test('Mintrabajo: un decreto que modifica a otro no se marca por citar al modificado en su epígrafe', async () => {
  const r = await buscarMintrabajo(
    { limite: 100 },
    conFilas(
      fila(
        'Decreto',
        '1227 de 2022',
        'Por el cual se modifica el Decreto 1072 de 2015, Único Reglamentario del Sector Trabajo',
        '18/07/2022',
        '/documents/d/guest/DECRETO%201227%20DEL%2018%20DE%20JULIO%20DE%202022.pdf',
      ),
    ),
  )
  assert.equal(r.items.length, 1)
  assert.doesNotMatch(r.items[0]!.epigrafe, /⚠|Advertencia/)
})

test('Mintrabajo: la fila «Ley 2021 de 2021» que enlaza la Ley 2101 sigue advirtiendo', async () => {
  const r = await buscarMintrabajo(
    { limite: 100 },
    conFilas(fila('Ley', '2021 de 2021', 'Por medio de la cual se reduce la jornada laboral', '15/07/2021', '/documents/d/guest/ley-2101-2021.pdf')),
  )
  assert.match(r.items[0]!.epigrafe, /⚠ Advertencia: el número del epígrafe \(2021\) no coincide con el del archivo enlazado \(2101\)/)
})

test('portal roto: el 301 que se apunta a sí mismo marca el host (el síntoma de SUIN)', () => {
  const url = 'https://www.suin-juriscol.gov.co/viewDocument.asp?id=1683108'
  const d = diagnosticarRespuesta(url, 301, { location: url }, '')
  assert.equal(d.roto, true)
  assert.match(d.motivo!, /bucle/)

  // Con barra final el destino es el mismo recurso: sigue siendo bucle.
  assert.equal(diagnosticarRespuesta('https://x.gov.co/a', 301, { location: 'https://x.gov.co/a/' }, '').roto, true)
})

test('portal roto: un redirect legítimo no marca, y un 404 no es un portal roto', () => {
  assert.equal(
    diagnosticarRespuesta('http://x.gov.co/norma', 301, { location: 'https://x.gov.co/norma' }, '').roto,
    false,
  )
  assert.equal(diagnosticarRespuesta('https://x.gov.co/nada.htm', 404, {}, 'No encontrado').roto, false)
})

test('portal roto: la página de mantenimiento y el 503 sí marcan', () => {
  assert.equal(diagnosticarRespuesta('https://x.gov.co/', 200, {}, '<h1>Sitio en mantenimiento</h1>').roto, true)
  assert.equal(diagnosticarRespuesta('https://x.gov.co/', 503, {}, '').roto, true)
  assert.equal(diagnosticarRespuesta('https://x.gov.co/', 200, {}, '<h1>Norma</h1>').roto, false)
})

test('rótulo de copia: dice la fuente y la fecha, que es lo que el modelo necesita para no confundirla con la fuente viva', () => {
  const ms = Date.UTC(2026, 8, 16, 5, 6, 52)
  assert.equal(fechaCorta(ms), '2026-09-16')
  const rotulo = rotuloCopia('normograma.dian.gov.co', ms)
  assert.match(rotulo, /normograma\.dian\.gov\.co/)
  assert.match(rotulo, /2026-09-16/)
  assert.match(rotulo, /no respondió/)
  assert.match(rotulo, /copia/)
})
