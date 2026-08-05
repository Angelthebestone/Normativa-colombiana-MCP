/**
 * Pruebas contra las fuentes reales. Cubren los escenarios que rompen una
 * implementación ingenua: normas gigantes, basura de Word, ids inexistentes,
 * stopwords que inundan el resultado y el canario anti-rotura.
 *
 *   npm test
 */
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { parsearCita, idTipo, rutaDeSentencia } from '../src/citas.ts'
import { claveSuin, fichaSuin } from '../src/fuentes/suin.ts'
import { mereceAviso } from '../src/actualizacion.ts'
import * as dian from '../src/fuentes/normograma.ts'
import * as suprema from '../src/fuentes/cortesuprema.ts'
import * as consejo from '../src/fuentes/consejoestado.ts'
import * as anh from '../src/fuentes/anh.ts'
import * as upme from '../src/fuentes/upme.ts'
import * as creg from '../src/fuentes/creg.ts'
import * as anla from '../src/fuentes/anla.ts'
import * as sectorial from '../src/fuentes/sectorial.ts'
import { pedir as pedirHttp } from '../src/http.ts'
import {
  CanarioError,
  advertenciasVigencia,
  articulo,
  avisoSinTexto,
  fragmentos,
  indiceArticulos,
  historial,
  seccion,
  seccionesPresentes,
  limpiarTermino,
  pdfEsEscaneo,
  cargar,
  textoDe,
  parseResultados,
  parseTematica,
  sinTildes,
  trocear,
} from '../src/parse.ts'
import { decodificar } from '../src/http.ts'
import * as gestor from '../src/fuentes/gestor.ts'
import * as corte from '../src/fuentes/corte.ts'

// Las pruebas marcadas con RED consultan los portales oficiales. Con SIN_RED=1
// se saltan, para iterar rápido o sin conexión sin golpear un servicio público.
const RED = { timeout: 180_000, skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }

// --- lógica pura ---------------------------------------------------------

test('el parser de citas entiende las formas colombianas', () => {
  assert.deepEqual(parsearCita('Ley 909 de 2004'), { tipo: 'ley', numero: '909', anio: '2004', articulo: undefined })
  assert.equal(parsearCita('Decreto 1083')?.numero, '1083')
  assert.equal(parsearCita('C-337/11')?.sentencia, 'C-337/11')
  assert.equal(parsearCita('T-099/24')?.sentencia, 'T-099/24')
  assert.equal(parsearCita('Sentencia C-351 de 2013')?.anio, '2013')
  assert.equal(parsearCita('artículo 6 de la Ley 1221 de 2008')?.articulo, '6')
  assert.equal(parsearCita('art. 2.2.5.1.5 del Decreto 1083')?.articulo, '2.2.5.1.5')
  assert.equal(parsearCita('¿cuánto cuesta el pan?'), null)
  // Un número absurdamente largo no debe partirse: si se parte, el año queda
  // fuera y el error acaba pidiendo un año que el usuario ya había indicado.
  assert.deepEqual(parsearCita('Ley 99999999 de 1800'), {
    tipo: 'ley',
    numero: '99999999',
    anio: '1800',
    articulo: undefined,
  })
  assert.equal(idTipo('ley'), 18)
  assert.equal(idTipo('Decreto'), 11)
})

test('una cita corta de sentencia se convierte en la ruta de la relatoría', () => {
  assert.equal(rutaDeSentencia('C-337/11'), '2011/C-337-11.htm')
  assert.equal(rutaDeSentencia('T-099 de 2024'), '2024/T-099-24.htm')
  assert.equal(rutaDeSentencia('2024/T-099-24.htm'), '2024/T-099-24.htm') // idempotente
  assert.equal(rutaDeSentencia('Ley 909 de 2004'), null)
})

test('un PDF escaneado se distingue de uno con texto', () => {
  const escaneo = '%PDF-1.4\n/Type /XObject /Subtype /Image /Filter /DCTDecode\n'
  const conTexto = '%PDF-1.4\n/FontFile2 12 0 R\n/Subtype /Image /Filter /DCTDecode\n'
  assert.equal(pdfEsEscaneo(escaneo), true)
  assert.equal(pdfEsEscaneo(conTexto), false, 'con fuentes incrustadas hay texto, aunque haya imágenes')
  assert.equal(pdfEsEscaneo('<html>no soy un pdf</html>'), false)

  // El vacío nunca puede leerse como "el documento no dice nada".
  assert.match(avisoSinTexto(0, 'http://x/y.pdf', true), /ESCANEO[\s\S]*no hace OCR/)
  assert.match(avisoSinTexto(12, 'http://x/y.pdf'), /NO significa que no diga nada/)
})

test('SUIN: la ficha se lee del bloque de campos, no de la prosa', () => {
  const html =
    '<span field="tipo">LEY</span><span field="numero">74</span><span field="anio">1923</span>' +
    '<span field="epigrafe">sobre provisión de agua</span><span field="estado_documento">DEROGADO</span>'
  assert.deepEqual(fichaSuin(html), {
    tipo: 'LEY',
    numero: '74',
    anio: '1923',
    epigrafe: 'sobre provisión de agua',
    estado: 'DEROGADO',
  })
  // Sin estado la ficha sigue valiendo: callar la norma entera diría que no existe.
  assert.equal(fichaSuin('<span field="tipo">LEY</span><span field="numero">9</span><span field="anio">1990</span>')?.estado, '')
  assert.equal(fichaSuin('<html>una página cualquiera</html>'), null)
  assert.equal(claveSuin('LEY', '0909', '2004'), 'ley 909 2004')
})

test('SUIN publica el estado, y el campo manda sobre la prosa', RED, async (t) => {
  // La Ley 1541 de 2012 es el caso que obligó a cambiar de fuente de verdad: su
  // texto visible dice "Vigente" y su campo dice "Vigencia en Estudio".
  // El portal se cae entero y corta la conexión: es la fuente, no el parser. El
  // e2e ya lo saltaba y aquí fallaba duro, así que un SUIN caído bloqueaba el
  // publicar de una versión que no lo tocaba.
  const r = await pedirHttp('https://www.suin-juriscol.gov.co/viewDocument.asp?id=1683108', 40_000).catch((e: Error) => e)
  if (r instanceof Error) {
    t.skip(`SUIN-Juriscol no respondió: ${r.message}`)
    return
  }
  assert.equal(r.status, 200)
  const f = fichaSuin(r.cuerpo)
  assert.deepEqual({ tipo: f?.tipo, numero: f?.numero, anio: f?.anio }, { tipo: 'LEY', numero: '1541', anio: '2012' })
  assert.ok(f?.estado, 'sin este campo, la fuente pierde su única razón de estar')
  assert.notEqual(f?.estado, textoDe(cargar(r.cuerpo), 'body').match(/ESTADO DE VIGENCIA:\s*([^\n[]+)/)?.[1]?.trim())
})

test('las stopwords se descartan: son las que inundan el resultado', () => {
  const r = gestor.quitarStopwords('auxilio de conectividad')
  assert.equal(r.usadas, 'auxilio conectividad')
  assert.deepEqual(r.descartadas, ['de'])
})

test('el saneamiento quita lo que hace fallar al portal con 500', () => {
  assert.equal(limpiarTermino('Ley 80 "de 1993"'), 'Ley 80 de 1993')
  assert.equal(limpiarTermino("<script>'x'"), 'script x')
})

test('sinTildes conserva la longitud, para poder cortar por índice', () => {
  assert.equal(sinTildes('gestión'), 'gestion')
  assert.equal(sinTildes('Ñoño áéíóú').length, 'Ñoño áéíóú'.length)
})

test('las ventanas de coincidencia solapadas se fusionan', () => {
  // Dos apariciones a 10 caracteres una de otra caben en la misma ventana:
  // devolver dos extractos casi idénticos hace leer lo mismo dos veces.
  const texto = `${'x'.repeat(500)}pension y pension${'y'.repeat(500)}pension${'z'.repeat(2000)}pension`
  const f = fragmentos(texto, 'pension', 100)
  assert.equal(f.total, 4)
  // Las dos primeras están a 10 caracteres: un solo pasaje. Las otras dos quedan
  // fuera de la ventana de 100 y son pasajes aparte.
  assert.equal(f.pasajes, 3)
  assert.equal(f.trozos.length, 3)
  assert.match(f.trozos[0]!, /2 coincidencias en este pasaje/)
})

test('una referencia cruzada dentro de una nota no corta el artículo', () => {
  const texto = 'ARTÍCULO 1. Uno.\n\nNOTA: ver Artículo 15 Ley 91 de 1989 y su alcance.\n\nARTÍCULO 2. Dos.'
  const a1 = articulo(texto, '1')
  assert.match(a1!, /NOTA: ver Artículo 15/, 'la nota de vigencia debe conservarse')
  assert.doesNotMatch(a1!, /Dos\./)
})

test('decodifica windows-1252 aunque la cabecera no lo diga', () => {
  const cp1252 = Buffer.from([0x52, 0x65, 0x69, 0x74, 0x65, 0x72, 0x61, 0x63, 0x69, 0xf3, 0x6e]) // "Reiteración"
  assert.equal(decodificar(cp1252, 'text/html'), 'Reiteración')
  assert.equal(decodificar(Buffer.from('gestión', 'utf8'), 'text/html; charset=utf-8'), 'gestión')
})

test('el troceado informa cuánto omite', () => {
  const t = trocear('a'.repeat(1000), 0, 100)
  assert.equal(t.texto.length, 100)
  assert.equal(t.omitido, 900)
  assert.equal(t.total, 1000)
})

test('fragmentos encuentra sin importar tildes y recorta con contexto', () => {
  const texto = 'El auxilio de conectividad reemplaza el auxilio de transporte para teletrabajadores.'
  const f = fragmentos(texto, 'CONECTIVIDAD', 20)
  assert.equal(f.total, 1)
  assert.match(f.trozos[0]!, /conectividad/i)
  assert.equal(fragmentos('la gestión pública', 'gestion').total, 1)
})

test('se extrae un artículo puntual y se detecta la derogatoria', () => {
  // Los artículos llegan como encabezado de renglón, que es lo que produce el
  // extractor de texto sobre el HTML del portal.
  const texto = 'ARTÍCULO 5. Uno.\nARTÍCULO 6. Derogado por la Ley 2 de 2020. Dos.\nARTÍCULO 7. Tres.'
  const a6 = articulo(texto, '6')
  assert.match(a6!, /Derogado/)
  assert.doesNotMatch(a6!, /Tres/)
  assert.equal(advertenciasVigencia(a6!).length, 1)
  assert.equal(advertenciasVigencia('texto sin marcas').length, 0)
})

test('la consulta temática se lee con o sin <tbody> explícito', () => {
  const fila = `<tr><td>Sub</td><td><a onclick="info_restrictor('TEMA X','Sub','Ley 1 de 2000',111,222)">Ley 1 de 2000</a></td></tr>`
  for (const html of [
    `<h3>TEMA X</h3><table>${fila}</table>`,
    `<h3>TEMA X</h3><table><tbody>${fila}</tbody></table>`,
  ]) {
    const r = parseTematica(html)
    assert.equal(r.length, 1, 'ambas formas de tabla deben leerse igual')
    assert.equal(r[0]!.temsubid, '111')
    assert.equal(r[0]!.documentos[0]!.normid, '222')
  }
})

test('el canario grita en vez de devolver una lista vacía', () => {
  assert.throws(() => parseResultados('<div>el portal cambió</div>'), CanarioError)
  // Hay total pero ningún enlace: es rotura, no ausencia de resultados.
  assert.throws(() => parseResultados('encontrados: 5 <div></div>'), CanarioError)
  assert.equal(parseResultados('encontrados: 0').total, 0)
})

// --- Gestor Normativo ----------------------------------------------------

test('buscar_normas encuentra la Ley 1221 de 2008', RED, async () => {
  const r = await gestor.buscar({ palabras: 'teletrabajo', tipo: 'Ley' })
  assert.ok(r.items.some((i) => i.id === '31431'), 'debería aparecer la Ley 1221 de 2008')
})

test('la cita exacta devuelve un solo resultado', RED, async () => {
  const r = await gestor.buscar({ tipo: 18, numero: 909, anio: 2004 })
  assert.equal(r.total, 1)
  assert.match(r.items[0]!.titulo, /Ley 909 de 2004/)
})

test('el Decreto 1083 no se devuelve entero: son 925.000 caracteres', RED, async () => {
  const n = await gestor.obtenerNorma(62866)
  assert.ok(n.texto.length > 500_000, `el texto completo debería ser enorme, fue ${n.texto.length}`)
  assert.ok(trocear(n.texto).texto.length <= 8000)
  const f = fragmentos(n.texto, 'encargo')
  assert.ok(f.total > 0, 'la búsqueda dentro del texto debería encontrar "encargo"')
})

test('los documentos viejos salen sin basura de Word', RED, async () => {
  const n = await gestor.obtenerNorma(293) // Ley 114 de 1913
  assert.doesNotMatch(n.texto, /mso-|Hewlett-Packard|Style Definitions/i)
  assert.ok(n.texto.length > 200)
})

test('un id inexistente se reporta como inexistente', RED, async () => {
  await assert.rejects(() => gestor.obtenerNorma(99999999), /No existe/)
})

test('las comillas no revientan la búsqueda', RED, async () => {
  const r = await gestor.buscar({ palabras: 'Ley 80 "de 1993"' })
  assert.ok(r.total >= 0)
})

test('el restrictor explica por qué la norma aplica al subtema', RED, async () => {
  const r = await gestor.restrictor(24928, 31431)
  assert.ok(r.length > 50, 'el restrictor no debería venir vacío')
})

test('los catálogos traen los tipos de documento', RED, async () => {
  const c = await gestor.catalogos()
  assert.ok(c.tipos.length >= 25, `tipos: ${c.tipos.length}`)
  assert.ok(c.temas.length > 1000, `temas: ${c.temas.length}`)
})

test('el listado de normas de Función Pública se lee sin contador', RED, async () => {
  // normasfp.php no trae "Número de documentos encontrados": es un listado plano.
  const items = await gestor.normasFp()
  assert.ok(items.length > 50, `esperaba ~108 normas, hubo ${items.length}`)
  assert.ok(items.every((i) => i.id && i.url.includes(i.id)))
})

test('listar_subtemas responde para un tema real del catálogo', RED, async () => {
  const c = await gestor.catalogos()
  const tema = c.temas.find((t) => /^EMPLEO$/i.test(t.nombre))!
  assert.ok((await gestor.subtemas(tema.id)).length > 10)
})

test('los conceptos se filtran por año, que es lo único que trae el listado', RED, async () => {
  const r = await gestor.conceptosFp(undefined, 2024, 3)
  assert.ok(r.total > 100, `conceptos de 2024: ${r.total}`)
  assert.ok(r.items.every((c) => c.titulo.includes('2024')))
  // Sin offset, ver la segunda mitad de una lista larga obliga a repedirla entera.
  const dos = await gestor.conceptosFp(undefined, 2024, 3, 3)
  assert.equal(dos.total, r.total)
  assert.deepEqual(
    dos.items.map((c) => c.id).filter((id) => r.items.some((p) => p.id === id)),
    [],
    'el segundo tramo no debe repetir el primero',
  )
})

// --- Corte Constitucional ------------------------------------------------

test('la relatoría encuentra jurisprudencia sobre teletrabajo', RED, async () => {
  const r = await corte.buscar({ termino: 'teletrabajo', limite: 20 })
  const nums = r.items.map((p) => p.sentencia.replace(/[\s.]/g, ''))
  assert.ok(nums.some((s) => s.includes('T-099/24')), `esperaba T-099/24, hubo: ${nums.join(', ')}`)
  assert.ok(nums.some((s) => s.includes('C-337/11')), 'esperaba C-337/11')
})

test('el texto de una providencia se trocea', RED, async () => {
  const doc = await corte.obtenerTexto('2024/T-099-24.htm')
  assert.ok(doc.texto.length > 50_000, `texto: ${doc.texto.length}`)
  assert.ok(trocear(doc.texto).texto.length <= 8000)
})

test('el texto de la Corte llega sin mojibake', RED, async () => {
  const doc = await corte.obtenerTexto('2011/C-337-11.htm')
  assert.doesNotMatch(doc.texto, /�/, 'la relatoría sirve windows-1252; leerlo como UTF-8 rompe las tildes')
  assert.match(doc.texto, /ó|í|á/, 'debe haber tildes bien decodificadas')
})

test('la jurisprudencia se puede filtrar por tipo de providencia', RED, async () => {
  const r = await corte.buscar({ termino: 'teletrabajo', tipos: ['C'], limite: 5 })
  assert.ok(r.items.length > 0)
  assert.ok(r.items.every((p) => /^\s*C/i.test(p.sentencia)), r.items.map((p) => p.sentencia).join(', '))
})

test('una ruta de providencia inexistente se distingue de un documento vacío', RED, async () => {
  await assert.rejects(() => corte.obtenerTexto('2024/NO-EXISTE-99.htm'), /No existe una providencia/)
})

test('la vía temática encuentra los conceptos que las palabras no', RED, async () => {
  // palabras=teletrabajo halla 3 documentos en todo el portal y ningún concepto;
  // el subtema oficial tiene 43. Es el bug que rompía la ruta que documentamos.
  const sub = await gestor.subtemaPorNombre('EMPLEO', 'Teletrabajo')
  assert.ok(sub, 'debería resolverse el subtemaid')
  const r = await gestor.buscar({ subtema: sub!, tipo: 'Concepto' })
  assert.ok(r.total > 20, `conceptos por subtema: ${r.total}`)
})

test('la relatoría está al día: hay providencias recientes', RED, async () => {
  const u = await corte.ultimas(5)
  assert.ok(u.length > 0)
  const masReciente = u.map((p) => p.publicacion).sort().at(-1)!
  const dias = (Date.now() - Date.parse(masReciente)) / 86_400_000
  assert.ok(dias < 120, `la publicación más reciente es de hace ${Math.round(dias)} días`)
})

// --- fuentes añadidas en la 1.3.0 ----------------------------------------

test('la DIAN devuelve normativa tributaria con enlace al texto', RED, async () => {
  const r = await dian.buscar('retención en la fuente', 3)
  assert.ok(r.total > 100, `resultados: ${r.total}`)
  assert.equal(r.items.length, 3)
  const d = r.items[0]!
  assert.ok(d.nombre && d.link, 'sin nombre y link no hay nada que consultar')
  assert.match(d.url, /normograma\.dian\.gov\.co\/dian\/compilacion\/docs\//)
  // El buscador devuelve el resaltado con <b> y entidades; llegan limpios.
  assert.doesNotMatch(d.extracto, /<b>|&#\d+;/)
})

test('la Corte Suprema exige sala y trae las normas que cita', RED, async () => {
  const r = await suprema.buscar({ texto: 'teletrabajo', sala: 'Tutelas' })
  assert.ok(r.total > 0, `total: ${r.total}`)
  const p = r.items[0]!
  assert.ok(p.titulo && p.fecha, 'una providencia sin título ni fecha no es citable')
  // Es su mejor argumento: encadena con resolver_cita.
  assert.ok(r.items.some((x) => x.normasCitadas.length > 0), 'ninguna providencia declaró normas citadas')
})

test('el índice de artículos no confunde una referencia cruzada con un artículo', () => {
  // En el Decreto 1083, que numera 2.2.1.3.1, las notas citan "artículo 21 de
  // la Ley 1955" y aparecían "21", "5" y "19" mezclados con la numeración real.
  const texto = 'ARTÍCULO 2.2.1.3.1 Uno.\n\nNOTA: modificado por el artículo 21 de la Ley 1955 de 2019.\n\nARTÍCULO 2.2.1.3.2 Dos.'
  assert.deepEqual(indiceArticulos(texto), ['2.2.1.3.1', '2.2.1.3.2'])
})

test('la Corte Suprema no repite la misma providencia ni ignora el límite', RED, async () => {
  // Su índice tiene una entrada por ARCHIVO: el mismo auto en .docx y .pdf, y
  // con el ponente escrito de dos formas. Una página traía cinco AP430-2023.
  const r = await suprema.buscar({ texto: 'despido sin justa causa', sala: 'Penal' })
  const numeros = r.items.map((p) => p.titulo)
  assert.deepEqual([...new Set(numeros)], numeros, `providencias repetidas: ${numeros.join(', ')}`)
  assert.ok(numeros.every((t) => !/\.(docx?|pdf|html?)$/i.test(t)), 'el número no debe llevar extensión')

  const corto = await suprema.buscar({ texto: 'despido sin justa causa', sala: 'Penal', limite: 3 })
  assert.ok(corto.items.length <= 3, `limite=3 devolvió ${corto.items.length}`)
})

test('el historial se reconstruye de las notas, sin inventar lo que no dicen', () => {
  const texto =
    'ARTÍCULO 1.1.1.1 Objeto. (Modificado por el art. 1 Decreto 666 de 2017)\n' +
    'ARTÍCULO 2. (Adicionado por el Art. 1 del Decreto 400 de 2021)\n' +
    'ARTÍCULO 3. (Derogado por una norma que la nota no identifica)'
  const h = historial(texto)
  assert.equal(h.length, 3)
  assert.deepEqual({ accion: h[0]!.accion, norma: h[0]!.norma, anio: h[0]!.anio, articulo: h[0]!.articulo }, {
    accion: 'modificado',
    norma: 'Decreto 666',
    anio: '2017',
    articulo: '1',
  })
  // Lo que la nota no dice queda vacío, nunca completado.
  assert.equal(h[2]!.norma, '')
  assert.equal(h[2]!.anio, '')
  // Y la nota literal siempre viaja, que es lo único citable.
  assert.ok(h.every((c) => c.literal.length > 10))
})

test('el historial lee las tres formas en que el portal anota un cambio', () => {
  // Las tres conviven en el artículo 6 de la Ley 1221 de 2008, y con solo la
  // primera el historial lo daba por intacto mientras el texto mostraba dos
  // reformas y una inhibición. Notas copiadas del portal, tal cual.
  const texto =
    'ARTÍCULO 6°. Garantías laborales.\n' +
    'NOTA: Declarada inhibida por ineptitud sustantiva de la demanda (Numeral 1. ) Sentencia de la Corte Constitucional C-351 de 2013\n' +
    'NOTA: Declarado Exequible de manera condicionada, mediante Sentencia de la Corte Constitucional C-337 de fecha mayo 11 de 2011, siempre y cuando se entienda algo\n' +
    '(Adiciona Art 54 numerales 13, 14,15 de la Ley 2466 de 2025)\n'
  const h = historial(texto)
  assert.equal(h.length, 3, `se leyeron ${h.length} cambios: ${h.map((c) => c.accion)}`)
  // Van en el orden del documento aunque cada forma se busque en otra pasada.
  assert.deepEqual(h.map((c) => c.norma), ['Sentencia C-351', 'Sentencia C-337', 'Ley 2466'])
  assert.deepEqual(h.map((c) => c.anio), ['2013', '2011', '2025'])
  assert.equal(h[2]!.accion, 'adicionado', 'la forma activa se anota en participio, como el resto')
  assert.equal(h[2]!.articulo, '54')
  // Y las advertencias tienen que verlas también: el artículo salía sin ninguna.
  assert.equal(advertenciasVigencia(texto).length, 2, 'sin aviso, el artículo parece intacto')
})

test('la prosa del articulado no se confunde con una nota de reforma', () => {
  // El riesgo de ampliar el parser es invertir la dirección: el artículo de
  // vigencias dice qué deroga ESTA norma, no quién la derogó a ella.
  const prosa =
    'de conformidad con lo previsto en la Ley 100 de 1993 y las normas que la modifiquen o adicionen\n' +
    'Por la cual se modifica y adiciona la Ley 100 de 1993 y se dictan otras disposiciones\n' +
    'ARTÍCULO 20. El presente decreto rige desde su publicación y deroga el Decreto 884 de 2012.\n' +
    'El actor fue declarado insubsistente mediante acto administrativo.'
  assert.deepEqual(historial(prosa), [])
})

test('las secciones de una providencia se cortan por encabezado, no por prosa', () => {
  const texto =
    'Preámbulo cualquiera.\nANTECEDENTES\nLos hechos.\nII. CONSIDERACIONES\nEl análisis.\n' +
    'Decisión frente a la cual presentó recurso el actor.\nIII. DECISIÓN\nEn mérito.\nRESUELVE\nPrimero: confirmar.'
  assert.deepEqual(seccionesPresentes(texto), ['antecedentes', 'consideraciones', 'decision'])
  // La prosa "Decisión frente a la cual..." no es un encabezado.
  const d = seccion(texto, 'decision')!
  assert.match(d, /^III\. DECISIÓN/)
  // Y RESUELVE es continuación de la decisión, no otra sección: no debe cortar.
  assert.match(d, /Primero: confirmar/)
  assert.equal(seccion('un texto sin estructura', 'decision'), null)
})

test('el aviso de versión no molesta: solo cambios que importan', () => {
  assert.equal(mereceAviso('1.4.0', '1.5.0'), true)
  assert.equal(mereceAviso('1.4.0', '2.0.0'), true)
  // Un parche no interrumpe a nadie: se recoge cuando actualice por otra razón.
  assert.equal(mereceAviso('1.4.0', '1.4.1'), false)
  assert.equal(mereceAviso('1.4.0', '1.4.0'), false)
  // Y nunca hacia atrás.
  assert.equal(mereceAviso('1.4.0', '1.3.9'), false)
})

test('la ANH devuelve actos citables y marca los de personal', RED, async () => {
  const r = await anh.buscar({ pagina: 1 })
  assert.ok(r.items.length > 5, `solo ${r.items.length} filas`)
  for (const d of r.items) assert.ok(d.tipo && d.numero, `fila sin tipo o número: ${JSON.stringify(d)}`)
  // Dos de cada tres son nombramientos: si dejaran de marcarse, el filtro por
  // defecto se vuelve inútil y la herramienta se llena de ruido en silencio.
  assert.ok(
    r.items.some((d) => anh.ES_ADMINISTRATIVO(d.categoria)),
    'ninguna fila trae categoría "Administrativo": el marcado cambió',
  )
  assert.ok(r.items.some((d) => d.urlPdf.endsWith('.pdf')), 'ninguna fila enlaza su PDF')
})

test('la UPME lee el número del título, no de la fecha del portal', RED, async () => {
  const r = await upme.buscar({ limite: 5 })
  assert.ok(r.total > 0 && r.items.length > 0, `total ${r.total}`)
  const con = r.items.filter((d) => d.numero)
  assert.ok(con.length, 'ningún documento trae número: el título dejó de parsearse')
  // "Resolución" lleva tilde y \w la cortaba: el tipo salía vacío.
  assert.ok(con.some((d) => d.tipo && !/^\d/.test(d.tipo)), `tipo mal leído: ${JSON.stringify(con[0])}`)
})

test('la CREG separa derogadas de no derogadas y su texto se puede leer', RED, async () => {
  // La compilación se publica POR AÑO: sin el año se mira solo el corriente, que
  // trae unas decenas. 2025 trae 118, y ese es el volumen que hace útil la fuente.
  const vig = await creg.buscar('vigentes', undefined, 5, '2025')
  assert.ok(vig.total > 50, `la compilación de vigentes de 2025 trae ${vig.total}`)
  assert.match(vig.pagina, /_2025\.html$/, `no se pidió la página del año: ${vig.pagina}`)
  assert.match(vig.items[0]!.estadoSegunCompilacion, /No derogada/i)
  const der = await creg.buscar('derogadas', undefined, 3)
  assert.match(der.items[0]!.estadoSegunCompilacion, /Derogada/i)

  // Es la única fuente sectorial con articulado legible; si deja de serlo, la
  // herramienta que lo promete se queda sin sentido.
  const t = await creg.obtenerTexto(vig.items[0]!.ruta)
  assert.ok(t.texto.length > 2000, `el texto vino con ${t.texto.length} caracteres`)
  assert.doesNotMatch(t.texto.slice(0, 200), /Video no funciona/, 'el texto trae la cabecera del portal')
})

test('Eureka no confunde un decreto ley con una ley', RED, async () => {
  const r = await anla.listar('leyes', 0)
  assert.ok(r.items.length > 0, 'Eureka no devolvió entradas')
  // "Decreto – Ley 2893 de 2011" con guion largo daba la cita "Ley 2893 de
  // 2011", que es otra norma: la cita habría viajado mal a resolver_cita.
  for (const x of r.items) {
    if (/Decreto\s*[–—-]\s*Ley/i.test(x.titulo)) {
      assert.match(x.cita, /^Decreto Ley/i, `cita mal extraída de "${x.titulo}": ${x.cita}`)
    }
  }
})

test('Eureka lee sus dos plantillas, no solo la del blog', RED, async () => {
  // Seis de las siete secciones son páginas de etiqueta, no de blog, y el parser
  // solo entendía la de blog: las daba por "plantilla cambiada" respondiendo 200
  // con sus documentos dentro. Justo las seis que traen la curaduría, que es lo
  // único que esta fuente aporta.
  const etiqueta = await anla.listar('cambio-climatico', 0)
  assert.ok(etiqueta.items.length >= 20, `una página de etiqueta trajo ${etiqueta.items.length} entradas`)
  assert.ok(etiqueta.items.every((x) => x.titulo && x.url), 'entradas sin título o sin enlace')

  // El salto de página no es el mismo en las dos plantillas (10 en el blog, 20 en
  // las etiquetas): sale de los enlaces del portal, no de una constante.
  assert.equal(etiqueta.siguiente, 20)
  assert.equal((await anla.listar('leyes', 0)).siguiente, 10)

  // Y la última página se declara última: contar entradas decía "hay más" en
  // cualquier cola de 10 o más, y repetía documentos ya devueltos.
  let d: number | null = etiqueta.siguiente
  let ultima = etiqueta
  while (d !== null) {
    ultima = await anla.listar('cambio-climatico', d)
    d = ultima.siguiente
  }
  assert.ok(ultima.items.length > 0, 'la última página vino vacía')
})

test('la Corte Suprema sí entrega el texto, y solo desde su propia sala', RED, async (t) => {
  // Se creyó que hacía falta una librería de OOXML y era falso dos veces: los
  // ficheros son .doc BINARIO en su mayoría, y el backend ya sirve el texto.
  const r = await suprema.buscar({ texto: 'despido sin justa causa', sala: 'Laboral', limite: 3 })
  const p = r.items.find((x) => x.ruta)
  if (!p) {
    t.skip('el buscador de la Corte Suprema no devolvió providencias con ruta')
    return
  }
  const doc = await suprema.obtenerTexto(p.ruta, 'Laboral')
  assert.ok(doc, 'la providencia encontrada debe poder leerse')
  assert.ok(doc!.texto.length > 5_000, `una casación no cabe en ${doc!.texto.length} caracteres`)

  // La cabecera son siete líneas cortas y el quitador de preámbulo de Word se
  // las comía enteras, con el radicado dentro: sin él la providencia no se cita.
  assert.match(doc!.texto.slice(0, 300), /CORTE SUPREMA|SALA DE CASACI[ÓO]N|Radicaci[óo]n/i, 'falta la cabecera del fallo')

  // El backend busca dentro de la sala que se le indique: la sala equivocada no
  // devuelve otro documento, devuelve nada. Conviene que siga siendo así.
  assert.equal(await suprema.obtenerTexto(p.ruta, 'Penal'), null, 'una sala ajena no puede resolver la providencia')
})

test('el Consejo de Estado entrega el texto por la vía que publica su buscador', RED, async (t) => {
  // La ficha del proceso pide una verificación anti-robot; el propio buscador
  // emite otro enlace, sin puerta, que lleva al PDF. Si SAMAI deja de emitir el
  // token, esta prueba lo dice en vez de devolver providencias sin texto.
  const r = await consejo.buscar('liquidación del contrato estatal', 3, 1)
  const p = r.items.find((x) => x.token)
  if (!p) {
    t.skip('SAMAI no emitió tokens de documento en esta consulta')
    return
  }
  assert.ok(
    r.items.every((x) => x.token),
    'todas las providencias deberían traer token; si no, se está leyendo por índice equivocado',
  )
  const d = await consejo.obtenerTexto(p.token)
  assert.ok(d, 'el token recién emitido debe resolver')
  // Un ZIP no trae texto y eso es legítimo; lo que no puede es fallar en silencio.
  if (!d!.texto) {
    assert.ok(d!.urlVisor.includes('VerProvidencia'), 'sin texto debe quedar al menos el visor')
    return
  }
  assert.ok(d!.texto.length > 5_000, `una providencia no cabe en ${d!.texto.length} caracteres`)
  assert.ok(d!.paginas > 0, 'debe contar las páginas del PDF')
  // Las tildes son el canario del extractor: una codificación mal leída las rompe
  // primero y el texto sigue pareciendo correcto.
  assert.match(d!.texto.slice(0, 4_000), /[óéáíúñÓÉÁÍÚÑ]/, 'el texto llegó sin tildes: el extractor las perdió')
})

test('todo regulador sectorial declara qué NO cubre', async () => {
  // El contrato exige `advertencia` porque es lo único que impide que un vacío
  // de un regulador se lea como "esa norma no existe". Una fuente nueva que se
  // registre sin ella pasaría inadvertida: esta prueba lo impide.
  await import('../src/fuentes/sectorial/registro.ts')
  const todos = sectorial.adaptadores()
  assert.ok(todos.length >= 10, `solo ${todos.length} reguladores registrados`)
  const ids = new Set<string>()
  for (const a of todos) {
    assert.match(a.id, /^[a-z][a-z0-9-]+$/, `id no utilizable como valor de enum: "${a.id}"`)
    assert.ok(!ids.has(a.id), `id duplicado: ${a.id}`)
    ids.add(a.id)
    assert.ok(a.nombre && a.sector, `${a.id} sin nombre o sector`)
    assert.match(a.portal, /^https:\/\//, `${a.id} sin portal citable`)
    assert.ok(a.advertencia.length > 40, `${a.id} no declara qué NO cubre`)
    assert.equal(typeof a.buscar, 'function', `${a.id} sin buscar()`)
  }
})

test('los índices empaquetados no se degradan en silencio', () => {
  // Son la diferencia entre que el MCP funcione y que encuentre la mitad sin
  // decirlo: si generar-indice produjera un índice truncado, todo seguiría en
  // verde y buscar_por_tema simplemente hallaría menos. Los umbrales van al 90%
  // de lo medido el 2026-08-01 (12.063 pares, 56.458 asociaciones, 11.599 leyes)
  // para que crezcan sin molestar y avisen si se desploman.
  const leer = (f: string) => JSON.parse(readFileSync(new URL(`../datos/${f}`, import.meta.url), 'utf8'))

  const tematico = leer('indice-tematico.json') as { generado: string; filas: { n: unknown[] }[] }
  assert.ok(tematico.filas.length > 10_800, `el índice temático trae ${tematico.filas.length} pares tema/subtema`)
  const asociaciones = tematico.filas.reduce((n, f) => n + f.n.length, 0)
  assert.ok(asociaciones > 50_000, `el índice temático trae ${asociaciones} asociaciones norma–subtema`)

  const suinIdx = leer('indice-suin.json') as { generado: string; normas: Record<string, string> }
  const leyes = Object.keys(suinIdx.normas).length
  assert.ok(leyes > 10_400, `el índice de SUIN trae ${leyes} leyes`)

  // Sin fecha válida no se puede advertir de que un índice está viejo.
  for (const [nombre, idx] of [['temático', tematico], ['SUIN', suinIdx]] as const) {
    assert.match(idx.generado, /^\d{4}-\d{2}-\d{2}$/, `el índice ${nombre} no trae fecha de generación`)
    assert.ok(!Number.isNaN(Date.parse(idx.generado)), `fecha ilegible en el índice ${nombre}`)
  }
})

test('el Consejo de Estado devuelve providencias citables, no texto suelto', RED, async () => {
  const r = await consejo.buscar('liquidación del contrato', 2)
  assert.ok(r.paginas > 100, `páginas: ${r.paginas}`)
  assert.equal(r.items.length, 2)
  assert.equal(r.pagina, 1)
  for (const p of r.items) {
    // Sin radicado y fecha no se puede citar, que es para lo que existe.
    assert.match(p.radicado, /^\d{15,25}$/, `radicado raro: ${p.radicado}`)
    assert.ok(p.fecha && p.sala, `falta fecha o sala en ${p.radicado}`)
    // El enlace a la ficha del proceso es lo que evita el "búscalo tú".
    assert.match(p.url, /list_procesos\.aspx\?guid=/, `sin ficha de proceso: ${p.url}`)
    // La respuesta al problema no puede colarse como si fuera otro problema.
    assert.ok(
      p.titulaciones.every((t) => !/^Respuesta al problema/i.test(t.problema)),
      'una respuesta se leyó como problema jurídico',
    )
  }
})

test('el Consejo de Estado pasa de la primera página', RED, async (t) => {
  // Antes solo existía la página 1: con 15.000 páginas de resultados y un tope
  // de 5, no había forma de ver la sexta providencia.
  let uno: Awaited<ReturnType<typeof consejo.buscar>>
  let dos: typeof uno
  try {
    ;[uno, dos] = await Promise.all([consejo.buscar('nulidad electoral', 5, 1), consejo.buscar('nulidad electoral', 5, 2)])
  } catch (e) {
    // El buscador de SAMAI agota el tiempo en su base de datos y responde 500.
    // Es la fuente la que se cae, no la paginación la que se rompe.
    if (/no respondió a tiempo/.test((e as Error).message)) {
      t.skip('SAMAI devolvió 500 (timeout de su buscador)')
      return
    }
    throw e
  }
  assert.equal(dos.pagina, 2)
  assert.ok(dos.items.length > 0, 'la página 2 volvió vacía')
  const previos = new Set(uno.items.map((p) => p.radicado))
  assert.ok(
    dos.items.every((p) => !previos.has(p.radicado)),
    'la página 2 repite providencias de la 1: no está paginando',
  )
})
