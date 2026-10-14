/**
 * El documento de SUIN (`documentoDe`) y los resultados de su buscador
 * (`resultadosDe`), sin red: con la forma real que sirven `suin-search` y
 * `documents_pdn` (medida el 2026-10-14), recortada a lo que se lee.
 *
 *   node --test test/suin-documento.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { documento, documentoDe, resultadosDe } from '../src/fuentes/suin.ts'
import { articulo, CanarioError, indiceArticulos } from '../src/nucleo/parse.ts'
import type { pedir as Pedir } from '../src/nucleo/http.ts'

const relleno = 'La presente ley regula el empleo público y la carrera administrativa en todo el territorio. '.repeat(3)

const HTML = `<html><head><style>.x{}</style></head><body class="documento_cms">
<button id="toolFab">?</button><div id="toolPanel">Herramientas</div><header>SUIN Juriscol</header>
<div class="slider"><div class="item">Curso SUIN-Juriscol Inscripciones abiertas</div></div>
<table id="toc" class="toc"><tr><td><b>RESUMEN DE MODIFICACIONES</b>
<div style="display: none;" id="1670817ResumenNotasVigencia"><ul class="resumenvigencias">
<li class="resumenvigencias"><b>Art&#xed;culo&#xa0;2:</b><ul class="resumenvigencias"><li class="referencia">
<span>Modificado&#xa0;</span>(el numeral 1 )&#xa0;<a href="/viewDocument.asp?id=30052920">Art&#xed;culo 3&#xa0;LEY 2418 de 2024</a></li></ul></li>
<li class="resumenvigencias"><b>Art&#xed;culo&#xa0;8:</b><ul class="resumenvigencias"><li class="referencia">
<span>Reglamentado&#xa0;</span><a href="/viewDocument.asp?id=1877569">DECRETO 3232 de 2004</a></li></ul></li>
</ul></div></td></tr></table>
<table id="toc" class="toc"><tr><td><b>RESUMEN DE JURISPRUDENCIA</b>
<div style="display: none;" id="1670817ResumenAfectacionesJurisp"><ul class="resumenvigencias">
<li class="resumenvigencias"><b>Art&#xed;culo&#xa0;3:</b><ul class="resumenvigencias"><li class="referencia">
<span>Declarada exequible la expresi&#xf3;n ...&#xa0;</span>(par&#xe1;grafo 2 )&#xa0;<a href="/viewDocument.asp?id=20003737">Sentencia de la Corte Constitucional &#xa0;C-73 de 2006</a></li></ul></li>
</ul></div></td></tr></table>
<div id="titulotipo"> LEY 909 DE 2004</div>
<table id="toc" class="toc"><tr><td><p><b>ESTADO DE VIGENCIA: </b>Vigente [<a>Mostrar</a>]</p>
<div style="display: none;" id="tablita"><ul class="resumenvigencias">
<li class="referencia"><span>Reglamentado&#xa0;</span><a href="/viewDocument.asp?id=1878859">DECRETO 3905 de 2009</a></li></ul>
<p>Fecha de expedición de la norma</p><p>23/09/2004</p></div></td></tr></table>
<div style="padding: 15px;"><p>Artículo 1°.Objeto de la ley. ${relleno}</p><p>Artículo 2°.Principios de la función pública. ${relleno}</p>
<p>Artículo 10.Régimen aplicable a los miembros de la Comisión. ${relleno}</p></div>
</body></html>`

const respuesta = { success: true, data: { id: 1670817, textoHtml: HTML, vigencia: 'Vigente', epigrafe: ' por la cual  se expiden normas ', entidadEmisora: 'CONGRESO DE COLOMBIA' } }

test('documentoDe: el articulado es el cuerpo de la norma, sin la barra del visor ni las tablas plegadas', () => {
  const d = documentoDe(respuesta, '1670817')
  assert.equal(d.titulo, 'LEY 909 DE 2004')
  assert.equal(d.estado, 'Vigente')
  assert.equal(d.epigrafe, 'por la cual se expiden normas')
  assert.equal(d.url, 'https://lexis.minjusticia.gov.co/minjusticia/viewDocument/1670817')
  assert.doesNotMatch(d.texto, /Curso SUIN|Herramientas|RESUMEN DE|Reglamentado/)
  // El rótulo pegado al texto ("Artículo 10.Régimen") recupera el espacio y el índice lo reconoce.
  assert.deepEqual(indiceArticulos(d.texto), ['1', '2', '10'])
  assert.match(articulo(d.texto, '10') ?? '', /^Artículo 10\. Régimen aplicable/)
})

test('documentoDe: los resúmenes de SUIN salen por artículo, con la acción y la norma que la causa', () => {
  const d = documentoDe(respuesta, '1670817')
  assert.deepEqual(d.modificaciones, [
    { articulo: 'Artículo 2', accion: 'Modificado (el numeral 1 )', por: 'Artículo 3 LEY 2418 de 2024' },
    { articulo: 'Artículo 8', accion: 'Reglamentado', por: 'DECRETO 3232 de 2004' },
  ])
  assert.deepEqual(d.jurisprudencia, [
    {
      articulo: 'Artículo 3',
      accion: 'Declarada exequible la expresión ... (parágrafo 2 )',
      por: 'Sentencia de la Corte Constitucional C-73 de 2006',
    },
  ])
  assert.deepEqual(d.notasVigencia, ['Reglamentado DECRETO 3905 de 2009'])
  assert.deepEqual(d.fechas, { 'Fecha de expedición de la norma': '23/09/2004' })
})

test('documentoDe: sin textoHtml es el portal cambiado, no un documento vacío', () => {
  assert.throws(() => documentoDe({ success: true, data: { id: 1 } }, '1'), CanarioError)
  assert.throws(() => documentoDe({}, '1'), CanarioError)
})

test('documento: el 204 del API es "no existe", y un id no numérico no sale a la red', async () => {
  let idas = 0
  const pedir = (async () => {
    idas++
    return { status: 204, cuerpo: '', headers: {} }
  }) as unknown as typeof Pedir
  assert.equal(await documento('999999999', { pedir }), null)
  await assert.rejects(() => documento('../etc', { pedir }), /Id de SUIN inválido/)
  assert.equal(idas, 1)
})

test('resultadosDe: total del índice, estado de la ficha en normas y ponente en providencias', () => {
  const r = resultadosDe({
    hits: {
      total: { value: 7192 },
      hits: [
        {
          _source: {
            id: 1670817,
            visualizacion: 1670817,
            configid: 30,
            titulo: 'LEY 909 2004',
            subtipo: 'LEY MARCO',
            epigrafe: 'por la cual se expiden normas',
            estado: 'Vigente',
            entidad: 'CONGRESO DE COLOMBIA',
          },
        },
        {
          _source: {
            id: 30038321,
            visualizacion: 30038317,
            configid: 200,
            name: 'CC-SENTENCIA  C 510 null 2019 1572325200000',
            titulo: 'CC-SENTENCIA C',
            normademandada: 'LEY 1943 DE 2018',
            magistradoponente: 'Cristina Pardo Schlesinger',
            estado: null,
          },
        },
      ],
    },
  })
  assert.equal(r.total, 7192)
  assert.deepEqual(
    r.items.map((i) => [i.id, i.titulo, i.vigencia, i.entidad, i.epigrafe]),
    [
      ['1670817', 'LEY 909 2004', 'Vigente', 'CONGRESO DE COLOMBIA', 'por la cual se expiden normas'],
      ['30038317', 'CC-SENTENCIA C 510 2019', '', 'Cristina Pardo Schlesinger', 'LEY 1943 DE 2018'],
    ],
  )
  assert.throws(() => resultadosDe({}), CanarioError)
})

test('«DECRETA:» y el cierre de una enumeración no esconden el artículo siguiente (Ley 2281 de 2023 en SUIN)', () => {
  const texto = [
    'El Congreso de la República de Colombia',
    'DECRETA:',
    `ARTÍCULO 1. OBJETO DE LA LEY. ${relleno}`,
    'ARTÍCULO 10. DIRECCIÓN DEL MINISTERIO. La dirección del Ministerio estará a cargo de la Ministra o Ministro de igualdad y Equidad:',
    `ARTICULO 11. ESTRUCTURA INTERNA. ${relleno}`,
    'ARTÍCULO 12. MODIFICACIÓN. El artículo 17 de la Ley 489 de 1998 quedará así:',
    `Artículo 17. Texto que transcribe la ley reformada. ${relleno}`,
    `ARTÍCULO 13. VIGENCIA. ${relleno}`,
  ].join('\n\n')
  assert.deepEqual(indiceArticulos(texto), ['1', '10', '11', '12', '13'])
  assert.doesNotMatch(articulo(texto, '10') ?? '', /ARTICULO 11/)
  assert.match(articulo(texto, '11') ?? '', /^ARTICULO 11\. ESTRUCTURA INTERNA/)
  // El anuncio de sustitución sigue arrastrando el artículo transcrito.
  assert.match(articulo(texto, '12') ?? '', /Artículo 17\. Texto que transcribe/)
})
