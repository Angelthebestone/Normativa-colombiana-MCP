/**
 * `historial_norma`: la cadena de reformas se estructura desde las notas del
 * Gestor con `historial()` (tres formas: pasiva, activa entre paréntesis,
 * control constitucional), se ordena por el año de la norma que introduce cada
 * cambio —las notas sin año van al final, marcadas— y el json sale del mismo
 * `acotar` que el markdown. Sin red: fixtures y `deps` inyectables.
 *
 *   node --test test/historial_norma.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { historial, type Cambio } from '../src/nucleo/parse.ts'
import { datosDe, escribir, formatearHistorial, ordenarCambios, ultimaReforma } from '../src/herramientas/historial_norma.ts'

const CON_REFORMAS = `ARTÍCULO 6. <p>El Gobierno reglamentará la materia.</p>
(Modificado por el art. 1 Decreto 666 de 2017)
(Adiciona Art 54 numerales 13, 14, 15 de la Ley 2466 de 2025)
NOTA: Declarada inhibida por ineptitud sustantiva de la demanda (Numeral 1.) Sentencia de la Corte Constitucional C-351 de 2013`

/** Un cambio del portal, con lo mínimo que pide el tipo. */
const cambio = (anio: string, literal: string, accion = 'modificado', norma = 'Ley 9'): Cambio => ({
  accion,
  norma,
  anio,
  articulo: '',
  literal,
})

test('historial() estructura las tres formas de nota (pasiva, activa, control)', () => {
  const cambios = historial(CON_REFORMAS)
  assert.ok(cambios.length >= 3, `se esperaban ≥3 cambios, llegaron ${cambios.length}`)
  const pasiva = cambios.find((c) => c.accion === 'modificado')
  assert.ok(pasiva)
  assert.equal(pasiva!.norma, 'Decreto 666')
  assert.equal(pasiva!.anio, '2017')
  assert.equal(pasiva!.articulo, '1')
  const activa = cambios.find((c) => c.accion === 'adicionado')
  assert.ok(activa)
  assert.equal(activa!.norma, 'Ley 2466')
  assert.equal(activa!.anio, '2025')
  assert.equal(activa!.articulo, '54')
})

/**
 * Notas reales de la Ley 909 de 2004 (i=14861): el portal escribe «Decreto
 * Nacional N de AAAA» y sin admitir «Nacional» en NORMA_CITADA las notas
 * quedaban sin año teniéndolo escrito (medido el 2026-09-28; 41 notas así en
 * las 14 normas medidas).
 */
const NOTAS_DECRETO_NACIONAL = [
  'ARTÍCULO 18. Sistema General de Información Administrativa.',
  '',
  '(Reglamentado por el Decreto Nacional 1409 de 2008.)',
  '',
  '(Modificado por el art. 228, Decreto Nacional 019 de 2012.)',
].join('\n')

test('las notas con «Decreto Nacional N de AAAA» ganan su año y se ordenan con él', () => {
  const cambios = historial(NOTAS_DECRETO_NACIONAL)
  const reglamentado = cambios.find((c) => c.accion === 'reglamentado')
  assert.ok(reglamentado)
  assert.equal(reglamentado!.norma, 'Decreto Nacional 1409')
  assert.equal(reglamentado!.anio, '2008')
  const modificado = cambios.find((c) => c.accion === 'modificado')
  assert.ok(modificado)
  assert.equal(modificado!.norma, 'Decreto Nacional 019')
  assert.equal(modificado!.anio, '2012')
  assert.equal(modificado!.articulo, '228')
  // Con año, entran en el orden cronológico y no en el bloque de las sin año.
  const s = formatearHistorial(cambios, 'Ley 909 de 2004', 'https://x.gov.co/n/14861')
  assert.doesNotMatch(s, /sin año en la nota/)
  assert.match(s, /MODIFICADO por Decreto Nacional 019 de 2012, artículo 228/)
})

test('formatearHistorial devuelve la cadena navegable con la nota literal', () => {
  const s = formatearHistorial(historial(CON_REFORMAS), 'Ley 1221 de 2008', 'https://x.gov.co/norma.php?i=1')
  assert.match(s, /MODIFICADO por Decreto 666 de 2017, artículo 1/)
  assert.match(s, /ADICIONADO por Ley 2466 de 2025/)
  assert.match(s, /Nota literal: «/)
  assert.match(s, /No se deduce cuál rige hoy/)
  assert.match(s, /resolver_cita/)
})

test('norma sin reformas avisa sin afirmar que está intacta', () => {
  const s = formatearHistorial([], 'Ley X de 2000', 'https://x.gov.co/n')
  assert.match(s, /no anota reformas/)
  assert.match(s, /NO equivale a que esté intacta/)
})

test('el tope se pagina con desde/limite y se declara lo que queda', () => {
  const cambios = Array.from({ length: 25 }, (_, i) => ({
    accion: 'modificado',
    norma: `Ley ${i}`,
    anio: '2000',
    articulo: '',
    literal: `nota ${i}`,
  }))
  const s = formatearHistorial(cambios, 'N', 'https://x.gov.co/n')
  assert.match(s, /25 cambio\(s\) anotado\(s\).*se muestran 1–20/s)
  assert.match(s, /Quedan 5: repite con desde=20/)
  const s2 = formatearHistorial(cambios, 'N', 'https://x.gov.co/n', { desde: 20 })
  assert.match(s2, /se muestran 21–25/)
  assert.doesNotMatch(s2, /Quedan/)
  const s3 = formatearHistorial(cambios, 'N', 'https://x.gov.co/n', { desde: 99 })
  assert.match(s3, /Pide un "desde" menor/)
})

test('el filtro por articulo solo trae los cambios de ese artículo', () => {
  const cambios = historial(CON_REFORMAS)
  const s = formatearHistorial(cambios, 'Ley 1221 de 2008', 'https://x.gov.co/norma.php?i=1', { articulo: '54' })
  assert.match(s, /sobre el artículo 54/)
  assert.match(s, /ADICIONADO por Ley 2466 de 2025/)
  assert.doesNotMatch(s, /MODIFICADO por Decreto 666/)
  const vacio = formatearHistorial(cambios, 'Ley 1221 de 2008', 'https://x.gov.co/norma.php?i=1', { articulo: '999' })
  assert.match(vacio, /ninguno sobre el artículo 999/)
  assert.match(vacio, /NO equivale a que siga intacto/)
})

// --- 4.2: orden por año, sin año al final y última reforma anotada ----------

test('ordenarCambios ordena por año y deja las notas sin año al final, en el orden del documento', () => {
  const orden = ordenarCambios([cambio('2020', 'a'), cambio('', 'sin-1'), cambio('2018', 'b'), cambio('2020', 'c')])
  assert.deepEqual(
    orden.map((x) => x.literal),
    ['b', 'a', 'c', 'sin-1'],
    'los empates de año conservan el orden del documento y las sin año van al final',
  )
})

test('ultimaReforma es la última con año; sin ninguna con año, null', () => {
  const con = ordenarCambios([cambio('2019', 'x'), cambio('2025', 'y'), cambio('', 'z')])
  assert.equal(ultimaReforma(con)!.literal, 'y')
  assert.equal(ultimaReforma(ordenarCambios([cambio('', 'z')])), null)
  assert.equal(ultimaReforma([]), null)
})

test('la respuesta señala la última reforma anotada y no la llama la que rige', () => {
  const s = formatearHistorial(historial(CON_REFORMAS), 'Ley 1221 de 2008', 'https://x.gov.co/norma.php?i=1')
  assert.match(s, /Reforma más reciente anotada por el portal sobre esta norma: ADICIONADO por Ley 2466 de 2025, artículo 54/)
  assert.match(s, /Es la última que el portal ANOTA, no la que rige/)
  // Ya no se declara el orden del documento: ahora hay orden por año, y se dice.
  assert.doesNotMatch(s, /en el orden en que aparecen en el documento/)
  assert.match(s, /ordenadas por el año de la norma que las introduce/)
})

test('una última reforma derogatoria se destaca', () => {
  const s = formatearHistorial(
    [cambio('2020', 'Derogado por el art. 5 de la Ley 1234 de 2020', 'derogado', 'Ley 1234')],
    'Ley X de 2000',
    'https://x.gov.co/n',
  )
  assert.match(s, /Reforma más reciente anotada por el portal sobre esta norma: DEROGADO por Ley 1234 de 2020/)
  assert.match(s, /ATENCIÓN: la última reforma que el portal anota es una DEROGATORIA/)
})

test('los cambios sin año van aparte, al final, marcados «sin año en la nota»', () => {
  const s = formatearHistorial([cambio('', 'la que no trae fecha'), cambio('2018', 'la de 2018')], 'N', 'https://x.gov.co/n')
  assert.ok(s.indexOf('la de 2018') < s.indexOf('la que no trae fecha'), 'la sin año tiene que ir después')
  assert.match(s, /Sin año en la nota \(no se pueden ordenar por fecha; van al final\):/)
  assert.match(s, / — sin año en la nota/)
  assert.match(s, /MODIFICADO por Ley 9 de 2018/)
})

test('si ninguna nota trae año se dice, en vez de inventar una más reciente', () => {
  const s = formatearHistorial([cambio('', 'una'), cambio('', 'otra')], 'N', 'https://x.gov.co/n')
  assert.match(s, /Ninguna nota trae año: no se puede señalar cuál es la reforma más reciente/)
})

// --- 1.2: formato json -----------------------------------------------------

const ITEM = {
  id: '31431',
  titulo: 'Ley 1221 de 2008',
  resumen: '',
  url: 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=31431',
}

/** `buscar`/`obtenerNorma` falsos: la norma que se pida será esta, sin red. */
const depsConTexto = (texto: string) => ({
  buscar: async (): Promise<{ total: number; items: (typeof ITEM)[]; aplicados: string[] }> => ({
    total: 1,
    items: [ITEM],
    aplicados: [],
  }),
  obtenerNorma: async (id: string | number) => ({
    id: String(id),
    titulo: ITEM.titulo,
    fechas: {},
    temas: [],
    texto,
    url: ITEM.url,
    urlPdf: '',
  }),
})

test('escribir json devuelve solo el objeto, con la forma prometida y los cambios ordenados', async () => {
  const r = await escribir(
    { cita: 'Ley 1221 de 2008', articulo: undefined, desde: 0, limite: 20, formato: 'json' },
    depsConTexto(CON_REFORMAS),
  )
  const d = JSON.parse(r)
  assert.deepEqual(Object.keys(d).sort(), [
    'alcance',
    'avisos',
    'cambios',
    'fecha_consulta',
    'titulo',
    'total',
    'ultima_reforma',
    'url',
  ])
  assert.match(d.fecha_consulta, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(d.alcance, /^Alcance: consulté Gestor Normativo/)
  assert.equal(d.titulo, 'Ley 1221 de 2008')
  assert.equal(d.url, ITEM.url)
  assert.equal(d.total, 3)
  assert.deepEqual(
    d.cambios.map((c: Cambio) => c.anio),
    ['2013', '2017', '2025'],
    'los cambios del json salen ya ordenados por año',
  )
  assert.equal(d.ultima_reforma.accion, 'adicionado')
  assert.equal(d.ultima_reforma.anio, '2025')
  assert.ok(Array.isArray(d.avisos) && d.avisos.length >= 2)
  assert.match(r, /^\{"fecha_consulta"/, 'el json va solo: sin la línea de alcance fuera')
})

test('escribir json: un artículo sin cambios sale con total 0 y aviso, no como error', async () => {
  const d = JSON.parse(
    await escribir({ cita: 'Ley 1221 de 2008', articulo: '999', desde: 0, limite: 20, formato: 'json' }, depsConTexto(CON_REFORMAS)),
  )
  assert.equal(d.total, 0)
  assert.deepEqual(d.cambios, [])
  assert.equal(d.ultima_reforma, null)
  assert.match(d.avisos.join(' '), /ninguno sobre el artículo 999/)
})

test('escribir json: una cita ilegible sale como objeto con aviso, sin consultar nada', async () => {
  const d = JSON.parse(
    await escribir({ cita: 'una cosa cualquiera', articulo: undefined, desde: 0, limite: 20, formato: 'json' }, depsConTexto(CON_REFORMAS)),
  )
  assert.equal(d.titulo, '')
  assert.equal(d.total, 0)
  assert.match(d.alcance, /sin consultar ninguna fuente/)
  assert.match(d.avisos[0], /No reconocí «una cosa cualquiera»/)
})

test('datosDe: el json y el texto cuentan y recortan igual (misma página)', () => {
  const cambios = historial(CON_REFORMAS)
  const d = datosDe(cambios, 'N', 'https://x.gov.co/n', 'Alcance: de prueba.', { desde: 1, limite: 1 })
  assert.equal(d.total, 3)
  assert.equal(d.cambios.length, 1)
  assert.equal(d.cambios[0]!.anio, '2017', 'desde=1 sobre la lista ordenada salta el 2013')
  assert.match(d.avisos.join(' '), /Quedan 1: repite con desde=2/)
})

test('escribir markdown sigue empezando por el alcance y con la lista de siempre', async () => {
  const md = await escribir(
    { cita: 'Ley 1221 de 2008', articulo: undefined, desde: 0, limite: 20, formato: 'markdown' },
    depsConTexto(CON_REFORMAS),
  )
  assert.match(md, /^Alcance: consulté Gestor Normativo/)
  assert.match(md, /se muestran 1–3/)
  assert.match(md, /Nota literal: «/)
  assert.doesNotMatch(md, /^\s*\{/)
})
