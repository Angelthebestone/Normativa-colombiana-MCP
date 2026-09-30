/**
 * Pruebas unitarias del enlace de búsqueda del Consejo de Estado: el modo
 * exacto (frase entre comillas, searchMode phrase) frente al OR del portal.
 * Sin red.
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buscar, enlaceBusqueda } from '../src/fuentes/jurisprudencia/consejoestado.ts'
import { escribir } from '../src/herramientas/buscar_jurisprudencia_consejo_estado.ts'
import type { pedir, Respuesta } from '../src/nucleo/http.ts'
import { CanarioError } from '../src/nucleo/parse.ts'

test('enlaceBusqueda con exacto=true usa comillas (frase exacta) con searchMode any', () => {
  const url = enlaceBusqueda('nulidad electoral', 0, true)
  const dic = decodeURIComponent(url.split('BusquedaDictionary=')[1]!)
  const j = JSON.parse(dic)
  assert.equal(j.searchMode, 'any') // SAMAI no soporta 'phrase': la frase va en comillas
  assert.equal(j.busqueda, '("nulidad electoral")')
})

test('enlaceBusqueda con exacto=false usa OR sin comillas', () => {
  const url = enlaceBusqueda('nulidad electoral', 0, false)
  const dic = decodeURIComponent(url.split('BusquedaDictionary=')[1]!)
  const j = JSON.parse(dic)
  assert.equal(j.searchMode, 'any')
  assert.equal(j.busqueda, '(nulidad electoral)')
})

test('enlaceBusqueda quita los paréntesis del término para no romper la sintaxis', () => {
  const url = enlaceBusqueda('nulidad (electoral)', 0, true)
  const dic = decodeURIComponent(url.split('BusquedaDictionary=')[1]!)
  const j = JSON.parse(dic)
  assert.equal(j.busqueda, '("nulidad electoral")')
})

// --- cero resultados no es un cambio de marcado (D6) y el aviso de OR según el modo (D12) ---

/** Captura real (2026-09-29, `pedir`) de SAMAI para «qwertyzzz» exacto: 200, con armazón, sin rótulo de paginación. */
const CERO = readFileSync(new URL('./fixtures/samai-cero-resultados.html', import.meta.url), 'utf8')

const RAIZ = 'ContentPlaceHolder1_ResultadoBusqueda1'
const FILA = `${RAIZ}_TitulacionesRepeater_`

/** Una página de resultados mínima con el rótulo de paginación y una providencia (o ninguna). */
const pagina = (paginas: number, problema = '') =>
  `<div id="${RAIZ}"><span id="${RAIZ}_PaginaActualLabel">Página 1 de ${paginas}</span>` +
  (problema
    ? `<a id="${FILA}HypRadicado_0" href="/ficha">11001-03-28-000-2020-00001-00</a>` +
      `<span id="${FILA}LblFECHAPROC_0">2 de octubre de 2013</span>` +
      `<span id="${FILA}LblClaseProceso_0">Nulidad electoral</span>` +
      `<span id="${FILA}LbNombreSalaDecision_0">Sección Quinta</span>` +
      `<span id="${FILA}TitulacionProvidenciaTexto1_0_ProblemaJuridicoLabel_0">Problema jurídico: ${problema}</span>`
    : '') +
  `</div>`

/** `pedir` de mentira: contesta las peticiones en orden con 200 y el cuerpo dado. */
const enSecuencia = (...cuerpos: string[]) => {
  let i = 0
  const peticiones: string[] = []
  const falso = (async (url: string) => {
    peticiones.push(url)
    const cuerpo = cuerpos[i++]
    if (cuerpo === undefined) throw new Error(`petición de más: ${url}`)
    return { status: 200, cuerpo, cookies: '', cabeceras: {} } as Respuesta
  }) as typeof pedir
  return { falso, peticiones }
}

/** La fuente del Consejo con `pedir` sustituido, para pasársela a la herramienta. */
const conFuente = (...cuerpos: string[]) => {
  const { falso } = enSecuencia(...cuerpos)
  return { buscar: ((t, l, p, e) => buscar(t, l, p, e, { pedir: falso })) as typeof buscar }
}

test('una palabra sin resultados con exacto=true: cero providencias, sin error de estructura', async () => {
  const { falso, peticiones } = enSecuencia(CERO)
  const r = await buscar('qwertyzzz', 5, 1, true, { pedir: falso })
  assert.equal(r.items.length, 0)
  assert.equal(r.paginas, 0)
  assert.equal(peticiones.length, 1, 'una palabra no se amplía a OR')
  const s = await escribir({ texto: 'qwertyzzz', exacto: true, pagina: 1, limite: 5 }, conFuente(CERO))
  assert.match(s, /término más general/)
  assert.doesNotMatch(s, /estructura|actualiza la extensión|CanarioError/i)
})

test('una frase sin resultados sigue ampliándose a OR y lo declara', async () => {
  const { falso, peticiones } = enSecuencia(CERO, pagina(15902, '¿La nulidad de un acto?'))
  const r = await buscar('nulidad zzqxv', 5, 1, true, { pedir: falso })
  assert.equal(peticiones.length, 2)
  assert.equal(r.ampliada, true)
  assert.equal(r.items.length, 1)
  assert.match(r.nota ?? '', /AMPLIADA, con las palabras unidas por OR/)
})

test('una página sin rótulo ni armazón sigue siendo un cambio de estructura', async () => {
  const { falso } = enSecuencia('<html><body>ENLACE DE CONSULTA INCOMPLETO O CORRUPTO</body></html>')
  await assert.rejects(buscar('qwertyzzz', 5, 1, true, { pedir: falso }), CanarioError)
})

test('con armazón pero con filas que no se leen, o con páginas declaradas sin filas, sigue siendo un canario', async () => {
  const filasSinLeer = `<div id="${RAIZ}"><a id="${FILA}HypRadicado_0" href="/ficha"></a></div>`
  await assert.rejects(buscar('qwertyzzz', 5, 1, true, { pedir: enSecuencia(filasSinLeer).falso }), CanarioError)
  await assert.rejects(buscar('qwertyzzz', 5, 1, true, { pedir: enSecuencia(pagina(5)).falso }), CanarioError)
})

test('frase exacta con resultados: sin «une los términos con OR» y con la fecha del proceso rotulada', async () => {
  const s = await escribir(
    { texto: 'nulidad electoral', exacto: true, pagina: 1, limite: 5 },
    conFuente(pagina(826, '¿Procede la nulidad electoral por inhabilidad?')),
  )
  assert.doesNotMatch(s, /une los términos con OR|NO mide pertinencia|SAMAI los une con OR/)
  assert.match(s, /Página 1 de 826 \(con la frase exacta\)/)
  assert.match(s, /Se exigieron TODOS los términos \(nulidad, electoral\)/, 'la nota lista los términos, no los objetos')
  assert.doesNotMatch(s, /\[object Object\]/)
  assert.match(s, /Fecha del proceso: 2 de octubre de 2013/)
  assert.doesNotMatch(s, /\n {2}Fecha: /)
  assert.match(s, /la del PROCESO, no la de la providencia/)
})

test('exacto=false declara el modo ampliado (OR) y que las páginas no miden pertinencia', async () => {
  const s = await escribir(
    { texto: 'nulidad electoral', exacto: false, pagina: 1, limite: 5 },
    conFuente(pagina(15902, '¿Procede la nulidad?')),
  )
  assert.match(s, /Modo ampliado \(OR\)/)
  assert.match(s, /NO mide pertinencia/)
  assert.doesNotMatch(s, /con la frase exacta/)
})

test('una frase sin resultados que se amplía antepone el aviso y declara el modo OR', async () => {
  const s = await escribir(
    { texto: 'nulidad electoral', exacto: true, pagina: 1, limite: 5 },
    conFuente(CERO, pagina(15902, '¿Procede la nulidad?')),
  )
  assert.match(s, /AVISO: la frase exacta "nulidad electoral" no apareció/)
  assert.match(s, /AMPLIADA, con las palabras unidas por OR/)
  assert.doesNotMatch(s, /con la frase exacta\)/)
})
