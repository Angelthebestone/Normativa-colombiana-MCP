/**
 * Pruebas contra las fuentes reales. Cubren los escenarios que rompen una
 * implementación ingenua: normas gigantes, basura de Word, ids inexistentes,
 * stopwords que inundan el resultado y el canario anti-rotura.
 *
 *   npm test
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { parsearCita, idTipo, rutaDeSentencia } from '../src/citas.ts'
import { claveSuin, fichaSuin } from '../src/fuentes/suin.ts'
import { mereceAviso } from '../src/actualizacion.ts'
import * as dian from '../src/fuentes/normograma.ts'
import * as suprema from '../src/fuentes/cortesuprema.ts'
import * as consejo from '../src/fuentes/consejoestado.ts'
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

test('SUIN publica el estado, y el campo manda sobre la prosa', RED, async () => {
  // La Ley 1541 de 2012 es el caso que obligó a cambiar de fuente de verdad: su
  // texto visible dice "Vigente" y su campo dice "Vigencia en Estudio".
  const r = await pedirHttp('https://www.suin-juriscol.gov.co/viewDocument.asp?id=1683108', 40_000)
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

test('el Consejo de Estado devuelve providencias citables, no texto suelto', RED, async () => {
  const r = await consejo.buscar('liquidación del contrato', 2)
  assert.ok(r.paginas > 100, `páginas: ${r.paginas}`)
  assert.equal(r.items.length, 2)
  for (const p of r.items) {
    // Sin radicado y fecha no se puede citar, que es para lo que existe.
    assert.match(p.radicado, /^\d{15,25}$/, `radicado raro: ${p.radicado}`)
    assert.ok(p.fecha && p.sala, `falta fecha o sala en ${p.radicado}`)
    // La respuesta al problema no puede colarse como si fuera otro problema.
    assert.ok(
      p.titulaciones.every((t) => !/^Respuesta al problema/i.test(t.problema)),
      'una respuesta se leyó como problema jurídico',
    )
  }
})
