/**
 * Pruebas de extremo a extremo: arrancan el servidor compilado y le hablan por
 * stdio con JSON-RPC, exactamente como hace Claude Desktop.
 *
 * Existen porque los dos lotes de fallos reportados desde Desktop nacieron
 * todos en esta capa —rótulos engañosos, esquemas sin tipar, una herramienta
 * que fallaba siempre— y las pruebas de biblioteca no la tocan.
 *
 *   npm run build && node --test test/e2e.ts
 */
import { strict as assert } from 'node:assert'
import test, { after, before } from 'node:test'

import { Cliente, CONTRATO, LENTO } from './red.ts'

let c: Cliente
let instrucciones = ''

before(async () => {
  c = new Cliente()
  const r = await c.peticion('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pruebas', version: '1' },
  })
  assert.equal(r.serverInfo.name, 'normativa-colombia')
  instrucciones = r.instructions ?? ''
})

test('el servidor entrega instrucciones de uso al conectarse', () => {
  // Es lo único que orienta la ELECCIÓN de herramienta, que ninguna prueba
  // puede verificar: si desaparecen, el servidor sigue verde y responde peor.
  assert.ok(instrucciones.length > 500, `instructions: ${instrucciones.length} caracteres`)
  for (const regla of [
    /resolver_cita/,
    /buscar_por_tema/,
    /buscar_en_texto/,
    /NUNCA afirmes por tu cuenta que una norma/,
    /Estado de vigencia según SUIN-Juriscol/, // la única excepción a la regla anterior
    /no esté en el Gestor NO significa que no exista/,
    /sin texto NO es un documento que no diga nada/,
    /temsubid/,
  ]) {
    assert.match(instrucciones, regla)
  }
})

after(() => c?.cerrar())

// --- contrato que ve el cliente -----------------------------------------

test('las 24 herramientas se declaran con esquemas utilizables', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  assert.equal(tools.length, 24, tools.map((t: any) => t.name).join(', '))

  const sinTipo: string[] = []
  for (const t of tools) {
    assert.ok(t.description?.length > 40, `${t.name} necesita una descripción útil`)
    for (const [campo, esquema] of Object.entries(t.inputSchema.properties ?? {})) {
      // Un `{}` deja al cliente adivinando si mandar 909 o "909".
      if (!Object.keys(esquema as object).length) sinTipo.push(`${t.name}.${campo}`)
    }
  }
  assert.deepEqual(sinTipo, [], `campos sin tipo: ${sinTipo.join(', ')}`)

  const documento = tools.find((t: any) => t.name === 'obtener_documento')
  assert.deepEqual(documento.inputSchema.required, ['fuente'], 'la fuente debe ser obligatoria')
  assert.deepEqual(documento.inputSchema.properties.fuente.enum, [
    'gestor',
    'corte',
    'suprema',
    'consejo',
    'dian',
    'creg',
    'sectorial',
  ], 'obtener_documento debe enumerar las fuentes')

  // Lo que el servidor exige en tiempo de ejecución tiene que verse en el
  // esquema: un agente que solo lea el esquema decide con él.
  const juris = tools.find((t: any) => t.name === 'buscar_jurisprudencia')
  assert.deepEqual(juris.inputSchema.required, ['termino'])

  // Listas largas: sin offset, ver el segundo tramo obliga a repedir la lista entera.
  const catalogos = tools.find((x: any) => x.name === 'listar_catalogos')
  const props = catalogos.inputSchema.properties
  assert.ok(props.desde, 'listar_catalogos necesita desde para paginar')
  assert.deepEqual(props.catalogo.enum, ['tipos', 'anios', 'entidades', 'temas', 'subtemas', 'conceptos_fp', 'normas_fp'])
})

test('los prompts se declaran y se resuelven', CONTRATO, async () => {
  const { prompts } = await c.peticion('prompts/list')
  assert.equal(prompts.length, 5)
  const p = await c.peticion('prompts/get', { name: 'sigue-vigente', arguments: { norma: 'Ley 909 de 2004' } })
  assert.match(p.messages[0].content.text, /Ley 909 de 2004/)
})

test('los identificadores se aceptan como número y como texto', LENTO, async () => {
  // Un modelo manda `id: 31431` con la misma naturalidad que `id: "31431"`.
  // Exigir solo texto convertía eso en un -32602 y la herramienta parecía rota.
  for (const [name, args] of [
    ['obtener_documento', { fuente: 'gestor', id: 31431 }],
    ['listar_catalogos', { catalogo: 'subtemas', tema_id: 'tema-36496' }],
    ['explicar_relacion_tema', { temsubid: 'ts-24928', normid: 31431 }],
    ['buscar_normas', { tipo_documento: 'Ley', numero: 909, anio: 2004 }],
  ] as const) {
    const r = await c.peticion('tools/call', { name, arguments: args }).catch((e: Error) => e)
    assert.ok(!(r instanceof Error), `${name} rechazó argumentos numéricos: ${r}`)
    assert.notEqual((r as any).isError, true, `${name} falló con argumentos numéricos`)
  }
})

// --- cada respuesta debe poder citarse ----------------------------------

test('toda respuesta lleva fecha de consulta y descargo', LENTO, async () => {
  for (const [name, args] of [
    ['resolver_cita', { cita: 'Ley 909 de 2004' }],
    ['listar_catalogos', { catalogo: 'tipos' }],
    ['resolver_cita', { cita: 'no es una cita' }],
  ] as const) {
    const { texto } = await c.tool(name, args)
    assert.match(texto, /Consulta del \d{4}-\d{2}-\d{2}\./, `${name} sin fecha`)
    assert.match(texto, /Verifica siempre en el enlace/, `${name} sin descargo`)
  }
})

// --- los fallos reportados desde Desktop --------------------------------

test('el extracto temático no se presenta como resumen de la norma', LENTO, async () => {
  // El Decreto 1083 salía descrito como una norma sobre elección de personeros.
  const { texto } = await c.tool('resolver_cita', { cita: 'Decreto 1083 de 2015' })
  assert.match(texto, /Decreto 1083 de 2015/)
  assert.doesNotMatch(texto, /\bResumen:/, 'el restrictor no es un resumen de la norma')
  assert.match(texto, /NO resume la norma/)
})

test('explicar_relacion_tema dice a qué tema corresponde', LENTO, async () => {
  const { texto } = await c.tool('explicar_relacion_tema', { temsubid: 'ts-24928', normid: '31431' })
  assert.match(texto, /Tema \/ subtema:/, 'sin el rótulo no se puede verificar la respuesta')
  assert.match(texto, /PROVISIÓN/, 'el rótulo debe salir con la tilde normalizada')
  assert.match(texto, /Teletrabajo/)
})

test('un término que no aparece en ningún resultado se señala', LENTO, async () => {
  const { texto } = await c.tool('buscar_normas', { palabras: 'zopilote interconectado', limite: 2 })
  assert.match(texto, /"zopilote" no aparece/)
})

test('el vacío enumera los filtros que sí se aplicaron', LENTO, async () => {
  const { texto, esError } = await c.tool('buscar_normas', {
    entidad: 'Ministerio de Minas y Energía',
    anio: '2023',
  })
  assert.equal(esError, false, 'cero resultados no es un fallo de la herramienta')
  assert.match(texto, /id 243/, 'debe constar que la entidad sí se resolvió')
  assert.match(texto, /no existe esa combinación/)
})

test('la búsqueda por palabras cae a la vía temática cuando rinde poco', LENTO, async () => {
  const { texto } = await c.tool('buscar_normas', {
    palabras: 'teletrabajo',
    tipo_documento: 'Concepto',
    limite: 3,
  })
  assert.match(texto, /Se reconsultó con el subtema/, 'debe explicar de dónde salieron los documentos')
  // No debe afirmar bajo qué tema están clasificados: son dos taxonomías y no coinciden.
  assert.match(texto, /taxonomías distintas del portal/)
  assert.doesNotMatch(texto, /^0 documento/m)
})

test('la jurisprudencia excluye autos salvo que se pidan', LENTO, async () => {
  const { texto } = await c.tool('buscar_jurisprudencia', { termino: 'prima de servicios', limite: 5 })
  const sentencias = [...texto.matchAll(/^- (\S+)/gm)].map((m) => m[1]!)
  assert.ok(sentencias.length > 0, texto.slice(0, 200))
  assert.ok(
    sentencias.every((s) => !/^A/i.test(s)),
    `no debería haber autos por defecto: ${sentencias.join(', ')}`,
  )
})

// --- documentos grandes y errores ---------------------------------------

test('el Decreto 1083 nunca se devuelve entero', LENTO, async () => {
  const { texto } = await c.tool('obtener_documento', { fuente: 'gestor', id: '62866' })
  assert.ok(texto.length < 40_000, `devolvió ${texto.length} caracteres`)
  assert.match(texto, /quedan \d+ sin mostrar/)
})

test('buscar_en_texto agrupa pasajes y prioriza los temas pertinentes', LENTO, async () => {
  const { texto } = await c.tool('obtener_documento', { fuente: 'gestor', id: '62866', buscar_en_texto: 'encargo' })
  assert.match(texto, /agrupadas en \d+ pasaje/)
  assert.match(texto, /Temas asociados \(\d+ de \d+, primero los que mencionan lo buscado\)/)
})

test('limite_caracteres manda también en modo búsqueda', LENTO, async () => {
  // Era el defecto más caro: en modo buscar_en_texto se ignoraba el tope y un
  // límite de 1.500 devolvía 18.000 caracteres, justo en las normas grandes.
  const corto = await c.tool('obtener_documento', { fuente: 'gestor', id: '14861', buscar_en_texto: 'empleo', limite_caracteres: 1500 })
  const largo = await c.tool('obtener_documento', { fuente: 'gestor', id: '14861', buscar_en_texto: 'empleo', limite_caracteres: 20000 })
  assert.ok(corto.texto.length < 5000, `con tope 1500 devolvió ${corto.texto.length} caracteres`)
  assert.ok(largo.texto.length > corto.texto.length, 'un tope mayor debe devolver más texto')
  assert.match(corto.texto, /no caben en 1500 caracteres/)
})

test('max_pasajes acota el número de extractos', LENTO, async () => {
  const uno = await c.tool('obtener_documento', { fuente: 'gestor', id: '62866', buscar_en_texto: 'encargo', max_pasajes: 1 })
  const tres = await c.tool('obtener_documento', { fuente: 'gestor', id: '62866', buscar_en_texto: 'encargo', max_pasajes: 3 })
  assert.ok(uno.texto.length < tres.texto.length, 'pedir menos pasajes debe devolver menos texto')
})

test('un límite fuera de rango se ajusta en vez de reventar', LENTO, async () => {
  const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', limite_caracteres: 400 })
  assert.equal(r.esError, false, 'un valor pequeño no debería producir un error de validación crudo')
  assert.match(r.texto, /Ley 1221 de 2008/)
})

test('el subtema se acepta por nombre cuando viene con su tema', LENTO, async () => {
  const conTema = await c.tool('buscar_normas', {
    tema: 'TELETRABAJO',
    subtema: 'Telebrajo durante jornada día sin carro',
    limite: 2,
  })
  assert.equal(conTema.esError, false, conTema.texto.slice(0, 120))

  // Sin tema no se puede resolver, y el mensaje debe decir por qué.
  const sinTema = await c.tool('buscar_normas', { subtema: 'Telebrajo durante jornada día sin carro' })
  assert.match(sinTema.texto, /hace falta indicar también el tema/)
})

test('la jurisprudencia poco pertinente se señala', LENTO, async () => {
  // Al acotar por fechas, la relatoría devuelve providencias que no tratan el tema.
  const r = await c.tool('buscar_jurisprudencia', {
    termino: 'teletrabajo',
    desde: '2024-01-01',
    hasta: '2024-12-31',
    limite: 5,
  })
  if (/⚠ no menciona el término/.test(r.texto)) {
    assert.match(r.texto, /pierde precisión al acotar por fechas/)
  }
})

test('lo inexistente se informa como texto, no como fallo de herramienta', LENTO, async () => {
  const norma = await c.tool('obtener_documento', { fuente: 'gestor', id: '99999999' })
  assert.equal(norma.esError, false)
  assert.match(norma.texto, /No encontré una norma con id 99999999/)

  const prov = await c.tool('obtener_documento', { fuente: 'corte', ruta: '2024/NO-EXISTE-99.htm' })
  assert.equal(prov.esError, false)
  assert.match(prov.texto, /No existe una providencia/)

  // Una cita bien formada pero inventada sí tiene que reportarse como no hallada.
  const falsa = await c.tool('resolver_cita', { cita: 'Ley 99999 de 2012' })
  assert.match(falsa.texto, /No encontré la cita/)
})

test('buscar_en_suin busca, pagina y avisa de que su vigencia no es fiable', LENTO, async () => {
  const r = await c.tool('buscar_en_suin', { texto: 'Buenaventura', limite: 3 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /documento\(s\) en SUIN-Juriscol; se muestran 1–3/)
  // El aviso no es decorativo: sin él, el modelo tomaría el campo por bueno.
  assert.match(r.texto, /contradice la ficha del documento/)
  assert.match(r.texto, /Vigencia SEGÚN EL BUSCADOR/)

  const dos = await c.tool('buscar_en_suin', { texto: 'Buenaventura', limite: 3, desde: 3 })
  assert.match(dos.texto, /se muestran 4–6/)

  // Lo que el buscador NO puede hacer, y por eso resolver_cita sigue existiendo.
  const cita = await c.tool('buscar_en_suin', { texto: 'LEY 909 DE 2004' })
  assert.match(cita.texto, /No encontré|resolver_cita/)
})

test('una ley que el Gestor no tiene se resuelve contra SUIN', LENTO, async (t) => {
  // El Gestor no cubre todo el país: la Ley 1541 de 2012 no está ahí y sí en
  // SUIN. Antes se respondía "no encontré", que se lee como "no existe".
  const r = await c.tool('resolver_cita', { cita: 'art. 3 de la Ley 1541 de 2012' })
  assert.equal(r.esError, false)
  if (/No encontré/.test(r.texto)) {
    // Dos causas distintas que esta prueba confundía en una: que el índice no
    // viaje con la instalación —capacidad ausente, culpa nuestra— o que SUIN no
    // responda —fuente caída, nada que arreglar aquí—. Acusar al índice cuando
    // está intacto manda a regenerar 11.599 leyes para nada.
    const fuentes = await c.tool('describir_fuentes')
    if (/Índice de SUIN: NO viaja/.test(fuentes.texto)) {
      assert.fail('falta datos/indice-suin.json: genera el índice con npm run generar-indice-suin')
    }
    t.skip('SUIN-Juriscol no respondió: el índice está, la fuente está caída')
    return
  }
  assert.match(r.texto, /SUIN-Juriscol sí la publica/)
  assert.match(r.texto, /Estado de vigencia según SUIN/)
  assert.match(r.texto, /--- Artículo 3 ---/)
})

// --- las herramientas que nadie había ejercitado ------------------------

test('listar_catalogos con normas_fp responde sin duplicados y con resumen separado', LENTO, async () => {
  const { texto } = await c.tool('listar_catalogos', { catalogo: 'normas_fp', limite: 100 })
  const ids = [...texto.matchAll(/\(id (\d+)\)/g)].map((m) => m[1]!)
  assert.ok(ids.length > 50, `solo ${ids.length} normas`)
  assert.equal(new Set(ids).size, ids.length, 'el listado del portal repite entradas')
  assert.doesNotMatch(texto, /de \d{4}[A-ZÁÉÍÓÚ]/, 'título y resumen quedaron pegados')
})

test('listar_catalogos exige filtro en temas y resuelve entidades', LENTO, async () => {
  const temas = await c.tool('listar_catalogos', { catalogo: 'temas' })
  assert.match(temas.texto, /indica un filtro/i)
  const ent = await c.tool('listar_catalogos', { catalogo: 'entidades', filtro: 'minas' })
  assert.match(ent.texto, /id 243/)
})

test('listar_catalogos con subtemas y conceptos_fp responden', LENTO, async () => {
  const sub = await c.tool('listar_catalogos', { catalogo: 'subtemas', tema_id: 'tema-36496' })
  assert.ok(sub.texto.split('\n').length > 10)
  const con = await c.tool('listar_catalogos', { catalogo: 'conceptos_fp', anio: '2024', limite: 3 })
  assert.match(con.texto, /2024/)
})

test('buscar_por_tema responde con temsubid y rótulos normalizados', LENTO, async () => {
  const { texto } = await c.tool('buscar_por_tema', { texto: 'teletrabajo', limite: 5 })
  assert.match(texto, /temsubid ts-\d+/)
  assert.doesNotMatch(texto, /PROVISIóN/, 'el rótulo debe salir normalizado')
})

test('un id de otra taxonomía se rechaza en vez de responder por el tema equivocado', CONTRATO, async () => {
  // El 38968 existe en los dos catálogos: en listar_catalogos "subtemas" es "Teletrabajo…" y
  // en el de buscar_por_tema es "INHABILIDADES / Ex Diputados". Antes de los
  // prefijos, cruzarlos devolvía una respuesta creíble sobre otra cosa.
  const cruzado = await c.tool('explicar_relacion_tema', { temsubid: 'sub-38968', normid: '31431' })
  assert.equal(cruzado.esError, true, 'un id de listar_catalogos "subtemas" no puede colar en explicar_relacion_tema')
  assert.match(cruzado.texto, /listar_catalogos/, 'debe decir de qué catálogo salió el id')

  const pelado = await c.tool('explicar_relacion_tema', { temsubid: '38968', normid: '31431' })
  assert.equal(pelado.esError, true, 'sin prefijo no se puede saber de qué catálogo es')
  assert.match(pelado.texto, /ts-/, 'debe decir cómo se escribe el id que sí vale')
})

test('un tipo de norma equivocado no devuelve otra norma distinta', LENTO, async () => {
  // Existen a la vez la Ley 1541 de 2012 y el Decreto 1541 de 2012. Aceptar el
  // otro sería peor que no encontrar nada: nadie sospecharía del cambiazo.
  const ley = await c.tool('resolver_cita', { cita: 'Ley 1541 de 2012' })
  assert.doesNotMatch(ley.texto, /Decreto 1541 de 2012\nid:/, 'devolvió el decreto en lugar de la ley')

  // Pero un tipo incompleto sí se corrige: "Decreto 1567" es "Decreto Ley 1567".
  const dl = await c.tool('resolver_cita', { cita: 'Decreto 1567 de 1998' })
  assert.match(dl.texto, /Decreto Ley 1567 de 1998/)
  assert.match(dl.texto, /el tipo oficial es/)
})

test('el aviso de baja pertinencia no culpa a un filtro que no se usó', LENTO, async () => {
  // Culpaba al filtro de fechas siempre, incluso sin desde/hasta: mandaba a
  // quitar algo que quien consulta nunca puso.
  const sinFechas = await c.tool('buscar_jurisprudencia', { termino: 'teletrabajo', tipos: ['A'], limite: 3 })
  if (/Atención:/.test(sinFechas.texto)) {
    assert.doesNotMatch(sinFechas.texto, /sin desde\/hasta/, 'culpa a las fechas sin que se hayan enviado')
  }
  const conFechas = await c.tool('buscar_jurisprudencia', {
    termino: 'teletrabajo',
    desde: '2024-01-01',
    hasta: '2025-01-01',
    limite: 3,
  })
  if (/Atención:/.test(conFechas.texto)) assert.match(conFechas.texto, /acotar por fechas/)
})

// --- tercer lote de fallos reportados ------------------------------------

test('el historial ve las notas que el modo artículo ya mostraba', LENTO, async () => {
  // El artículo 6 de la Ley 1221 de 2008 trae una inhibición (C-351 de 2013),
  // una exequibilidad condicionada (C-337 de 2011) y una adición (Ley 2466 de
  // 2025), y el historial respondía "no registran cambios sobre esta norma".
  const art = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', articulo: '6', historial: true })
  assert.doesNotMatch(art.texto, /no registran cambios/, 'el historial no ve lo que el propio texto muestra')
  assert.match(art.texto, /C-351/)
  assert.match(art.texto, /Ley 2466/)

  // Y la norma entera tampoco puede darse por intacta.
  const toda = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', historial: true })
  assert.doesNotMatch(toda.texto, /no registran cambios/)

  // Las mismas notas tienen que advertirse al leer el artículo, no solo al
  // pedir el historial: quien lee el texto no sabe que hay un historial.
  const texto = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', articulo: '6' })
  assert.match(texto.texto, /control constitucional/)
})

test('una cita sin año no elige por ti entre normas distintas', LENTO, async () => {
  // "Decreto 1072" son cuatro decretos (2025, 2015, 2004, 1999) y devolvía el
  // de 2025 sin avisar, cuando el que casi todo el mundo cita es el de 2015.
  const ambigua = await c.tool('resolver_cita', { cita: 'Decreto 1072' })
  assert.match(ambigua.texto, /ambigua/i, 'resolvió una cita ambigua sin decirlo')
  assert.match(ambigua.texto, /Decreto 1072 de 2015/)
  assert.match(ambigua.texto, /Decreto 1072 de 2025/)

  // Con el año sí resuelve, y a la norma pedida.
  const exacta = await c.tool('resolver_cita', { cita: 'Decreto 1072 de 2015' })
  assert.match(exacta.texto, /Decreto 1072 de 2015/)
  assert.doesNotMatch(exacta.texto, /ambigua/i)
})

test('listar_catalogos con conceptos_fp exige un filtro, como el resto de buscadores', LENTO, async () => {
  // Sin filtro devolvía los 21.759 conceptos, que no dicen de qué tratan.
  const vacia = await c.tool('listar_catalogos', { catalogo: 'conceptos_fp' })
  assert.equal(vacia.esError, true, 'la llamada sin filtros debe rechazarse')
  assert.match(vacia.texto, /numero o anio/)
})

test('el vacío por entidad señala la entidad que el Gestor sí usa', LENTO, async () => {
  // Ley + 1993 + "Congreso de la República" da 0 porque el Gestor las cataloga
  // bajo "Nivel Nacional"; el mensaje mandaba a dudar de la norma.
  const r = await c.tool('buscar_normas', { tipo_documento: 'Ley', anio: '1993', entidad: 'Congreso de la República' })
  assert.match(r.texto, /Nivel Nacional/, 'no sugiere la entidad que el Gestor sí usa')
})

test('el Consejo de Estado pagina y entrega el radicado para pegar', LENTO, async (t) => {
  const uno = await c.tool('buscar_jurisprudencia_consejo_estado', { texto: 'nulidad electoral', limite: 3 })
  // SAMAI agota el tiempo en su propia base de datos con consultas amplias y
  // responde 500. Es la fuente, no el MCP: se distingue y se salta, en vez de
  // dar por roto lo que funciona en cuanto el portal se recupera.
  if (/no respondió a tiempo/.test(uno.texto)) {
    t.skip('SAMAI devolvió 500 (timeout de su buscador)')
    return
  }
  assert.match(uno.texto, /Página 1 de \d+/)
  assert.match(uno.texto, /repite con pagina=2/)
  assert.match(uno.texto, /list_procesos\.aspx/, 'sin ficha de proceso no hay dónde leerla')

  const dos = await c.tool('buscar_jurisprudencia_consejo_estado', { texto: 'nulidad electoral', limite: 3, pagina: 2 })
  assert.match(dos.texto, /Página 2 de \d+/)
})

test('describir_fuentes declara el alcance con números medidos', CONTRATO, async () => {
  // Existe para que un vacío no se lea como "no existe". Lo importante no es
  // la lista de fuentes sino la de huecos, así que eso es lo que se verifica.
  const r = await c.tool('describir_fuentes')
  assert.equal(r.esError, false)
  assert.match(r.texto, /LO QUE NO ESTÁ CUBIERTO/)
  assert.match(r.texto, /ESTADO PROCESAL/, 'el hueco más importante debe estar declarado')
  assert.match(r.texto, /no significa que la norma no exista/i)

  // Los números salen de los índices reales, no de prosa escrita a mano: si el
  // índice deja de viajar con la instalación, tiene que decirlo, no callarlo.
  assert.match(r.texto, /Índice de SUIN: (\d[\d.,]* leyes|NO viaja)/)
  assert.match(r.texto, /Índice temático: (\d[\d.,]* pares|NO viaja)/)
})

test('la Corte Suprema amplía la búsqueda en vez de decir que no hay nada', LENTO, async () => {
  // Con exacto por defecto, una frase sin coincidencia exacta devolvía vacío.
  // Ampliar está bien; presentarlo como la búsqueda pedida, no.
  const r = await c.tool('buscar_jurisprudencia_suprema', {
    texto: 'despido sin justa causa por teletrabajo sobreviniente',
    sala: 'Laboral',
    limite: 3,
  })
  assert.equal(r.esError, false)
  if (/AVISO: la frase exacta/.test(r.texto)) {
    assert.match(r.texto, /b[úu]squeda AMPLIADA/i)
    assert.match(r.texto, /Verifica la pertinencia/)
  } else {
    // Si hubo frase exacta, no puede anunciarse como ampliada.
    assert.doesNotMatch(r.texto, /AMPLIADA/)
  }
})

test('la búsqueda de la Corte Suprema entrega la ruta con la que se pide el texto', LENTO, async () => {
  // La búsqueda y el texto son dos herramientas, y la segunda solo sirve si la
  // primera entrega la ruta Y la sala. Antes la respuesta terminaba diciendo que
  // el texto no se podía dar: si eso vuelve, esta prueba lo caza.
  const b = await c.tool('buscar_jurisprudencia_suprema', { texto: 'despido sin justa causa', sala: 'Laboral', limite: 3 })
  assert.equal(b.esError, false)
  assert.doesNotMatch(b.texto, /no se puede entregar|no lee ese formato/, 'ya no es cierto que no haya texto')
  const ruta = b.texto.match(/ruta="([^"]+)"/)?.[1]
  assert.ok(ruta, 'la búsqueda debe decir con qué ruta pedir el texto')

  const t = await c.tool('obtener_documento', { fuente: 'suprema', ruta, sala: 'Laboral', limite_caracteres: 1200 })
  assert.equal(t.esError, false)
  assert.match(t.texto, /Texto total: \d[\d.,]* caracteres/, 'debe declarar cuánto mide y cuánto muestra')

  // El troceo tiene que respetarse: devolver la providencia entera revienta el
  // contexto, y es justo lo que hace obtener_documento en las demás fuentes.
  const cuerpo = t.texto.split('--- Texto ---')[1] ?? ''
  assert.ok(cuerpo.length <= 1400, `el tope de caracteres no se respetó: ${cuerpo.length}`)

  const f = await c.tool('obtener_documento', { fuente: 'suprema', ruta, sala: 'Laboral', buscar_en_texto: 'casación' })
  assert.equal(f.esError, false)
  assert.match(f.texto, /aparici[óo]n\(es\) de "casación"|no aparece en esta providencia/)
})

test('el Consejo de Estado ya no dice que no puede dar el texto', LENTO, async () => {
  const b = await c.tool('buscar_jurisprudencia_consejo_estado', { texto: 'liquidación del contrato estatal', limite: 3 })
  assert.equal(b.esError, false)
  assert.doesNotMatch(b.texto, /texto completo de la providencia no se entrega/i, 'ya no es cierto')
  // El token caduca en una hora: la respuesta tiene que decirlo, o se citará.
  assert.match(b.texto, /CADUCAN EN UNA HORA/, 'un token caduco citado como fuente es una cita rota')
  const token = b.texto.match(/token="([^"]+)"/)?.[1]
  assert.ok(token, 'la búsqueda debe entregar el token con el que pedir el texto')

  const t = await c.tool('obtener_documento', { fuente: 'consejo', token, limite_caracteres: 1000 })
  assert.equal(t.esError, false, `obtener_documento(consejo) falló: ${t.texto.slice(0, 200)}`)
  if (/no se sirve como PDF/.test(t.texto)) return // legítimo: hay actuaciones comprimidas
  assert.match(t.texto, /Texto total: \d[\d.,]* caracteres/)
  const cuerpo = t.texto.split('--- Texto ---')[1] ?? ''
  assert.ok(cuerpo.length <= 1200, `el tope de caracteres no se respetó: ${cuerpo.length}`)
})

test('el buscador sectorial nunca responde sin decir qué no cubre', LENTO, async () => {
  // Diez reguladores en una herramienta: el riesgo es que "tener algo sectorial"
  // se lea como "tener lo sectorial". Por eso la advertencia de la fuente viaja
  // en TODA respuesta, haya resultados o no.
  const r = await c.tool('buscar_normativa_sectorial', { entidad: 'supertransporte', limite: 3 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Qué NO cubre:/, 'la respuesta no declara los límites de la fuente')
  assert.match(r.texto, /Fuente: Superintendencia de Transporte/)

  // Y un vacío tiene que seguir declarándolos: es justo cuando más importa.
  const vacia = await c.tool('buscar_normativa_sectorial', {
    entidad: 'supertransporte',
    texto: 'zzqxnoexisteestetermino',
  })
  assert.match(vacia.texto, /Qué NO cubre:/, 'un vacío sin advertencia se lee como "esa norma no existe"')
})

test('el esquema sectorial ofrece las entidades sin que haya que adivinarlas', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  const t = tools.find((x: any) => x.name === 'buscar_normativa_sectorial')
  const enum_ = t.inputSchema.properties.entidad.enum
  assert.ok(Array.isArray(enum_) && enum_.length >= 10, `entidad debe enumerar los reguladores: ${enum_}`)
  assert.deepEqual(t.inputSchema.required, ['entidad'], 'sin entidad la herramienta no sabe a quién preguntar')
  // Y la descripción tiene que desviar a resolver_cita lo que ya está cubierto:
  // duplicar leyes y decretos con una fuente peor sería un retroceso.
  assert.match(t.description, /Decreto Único Reglamentario|resolver_cita/)
})

test('listar_catalogos dice de quién son sus catálogos', CONTRATO, async () => {
  // Buscar "DIAN" en entidades devuelve vacío y parecía que no hay normativa
  // de la DIAN, cuando lo que pasa es que tiene su propio normograma.
  const { tools } = await c.peticion('tools/list')
  const t = tools.find((x: any) => x.name === 'listar_catalogos')
  assert.match(t.description, /Gestor Normativo de Función Pública/)
  assert.match(t.description, /buscar_normativa_tributaria/)
})

// --- herramientas V2 ------------------------------------------------------

test('las herramientas V2 se declaran con esquema y sin red no mienten', CONTRATO, async () => {
  const { tools } = await c.peticion('tools/list')
  const nombres = [
    'consultar_por_jerarquia',
    'analizar_conflicto',
    'cambios_desde',
    'comparar_articulos',
    'consultar_perfil',
    'expediente',
  ]
  for (const n of nombres) {
    const t = tools.find((x: any) => x.name === n)
    assert.ok(t, `falta la herramienta V2 ${n}`)
    assert.ok(t.description?.length > 40, `${n} necesita una descripción útil`)
    assert.ok(t.inputSchema?.properties && Object.keys(t.inputSchema.properties).length >= 0, `${n} schema roto`)
  }
  // Expedientes sin EXPEDIENTES=1: capacidad ausente, no fallo.
  const crear = await c.tool('expediente', { accion: 'crear' })
  assert.equal(crear.esError, false)
  assert.match(crear.texto, /desactivada|EXPEDIENTES=1/)
})

test('consultar_perfil responde el perfil y su advertencia', LENTO, async () => {
  const r = await c.tool('consultar_perfil', { perfil: 'tributario', texto: 'retención', limite: 3 })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Perfil:/)
  assert.match(r.texto, /Advertencia:/)
})

test('resolver_cita con validar clasifica sin afirmar vigencia', LENTO, async () => {
  const r = await c.tool('resolver_cita', { cita: 'Ley 909 de 2004', validar: true })
  assert.equal(r.esError, false)
  assert.match(r.texto, /Resultado: (cita validada|cita parcialmente validada|no fue posible validar)/)
})
