/**
 * Vacancia y vigencia diferida: una prueba por clase, con los artículos de
 * vigencia LITERALES medidos en el Gestor el 2026-09-28 (los recortes van
 * marcados con «…»), más los falsos positivos reales y una prueba de red que
 * se salta con SIN_RED=1.
 *
 *   node --test test/vacancia.ts
 *   SIN_RED=1 node --test test/vacancia.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { analizarVacancia, enVacancia, type ClaseVacancia } from '../src/nucleo/vacancia.ts'
import * as gestor from '../src/fuentes/gestor.ts'

/** Sin red: los casos que consultan el Gestor se saltan. */
const RED = { skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false, timeout: 240_000 }

// --- fixtures literales ----------------------------------------------------

/** Ley 2466 de 2025, art. 70. Inmediata: rige desde su promulgación. */
const LEY_2466_ART_70 =
  'Artículo 70. Vigencia y derogatorias. La presente ley rige a partir de su promulgación y deroga o modifica ' +
  'todas las que le sean contrarias o incompatibles. Se deroga el literal b) del artículo 162 del Código ' +
  'Sustantivo del Trabajo.'

/** Ley 2101 de 2021, art. 8. Inmediata, con la errata «empezara» tal como la sirve el portal. */
const LEY_2101_ART_8 =
  'ARTÍCULO 8. Vigencia. La presente ley empezara a regir a partir de la fecha de su publicación y deroga todas ' +
  'las disposiciones que le sean contrarias.'

/** Ley 1437 de 2011 (CPACA), art. 308. Fecha fija en letras: «el dos (2) de julio del año 2012». */
const CPACA_ART_308 =
  'ARTÍCULO 308. Régimen de transición y vigencia. El presente Código comenzará a regir el dos (2) de julio del ' +
  'año 2012.'

/** Ley 2381 de 2024, art. 94. El sistema nuevo entra en vigor en una fecha fija, dicha «en vigor». */
const LEY_2381_ART_94 =
  'ARTÍCULO 94. VIGENCIA. El Sistema de Protección Social Integral para la Vejez, invalidez y Muerte de origen ' +
  'común, previsto en la presente ley, entrará en vigor el 01 de julio de 2025.'

/** Ley 2381 de 2024, art. 95. El que cierra la ley no es el de vigencia, pero fecha la norma entera. */
const LEY_2381_ART_95 =
  'ARTÍCULO 95. DEROGATORIAS. la presente ley rige a partir de su sanción y deroga las disposiciones que le sean ' +
  "contrarios. '."

/** Ley 1801 de 2016, art. 243. Relativa: seis meses después de su promulgación. */
const LEY_1801_ART_243 = 'ARTÍCULO 243. Vigencia. La presente ley regirá seis (6) meses después de su promulgación.'

/** La nota con la que el propio texto cierra; el Gestor la sirve tras la firma. */
const LEY_1801_NOTA = 'NOTA: Publicado en el Diario Oficial. N 49949. 29 de julio de 2016'

/** Ley 1996 de 2019, arts. 52 y 63: dos artículos de vigencia y un tramo diferido (Capítulo V). */
const LEY_1996_ART_52 =
  'ARTÍCULO 52. Vigencia. Las disposiciones establecidas en esta ley entrarán en vigencia desde su promulgación, ' +
  'con excepción de aquellos artículos que establezcan un plazo para su implementación y los artículos contenidos ' +
  'en el Capítulo V de la presente ley, los cuales entrarán en vigencia veinticuatro (24) meses después de la ' +
  'promulgación de la presente ley.'

const LEY_1996_ART_63 = 'ARTÍCULO 63. Vigencia. La presente ley rige a partir de su promulgación.'

/** Ley 1564 de 2012 (CGP), art. 627. Escalonada: promulgación, 1 de octubre de 2012 y 1 de enero de 2014. */
const CGP_ART_627 = `Artículo 627. Vigencia. La vigencia de las disposiciones establecidas en esta ley se regirá por las siguientes reglas:

1. Corregido por el art. 18, Decreto Nacional 1736 de 2012. Los artículos 24, 30 numeral 8 y parágrafo, 31 numeral 2, 33 numeral 2, 206, 467, 610 a 627 entrarán a regir a partir de la promulgación de esta ley.

2. La prórroga del plazo de duración del proceso prevista en el artículo 121 de este código, será aplicable, por decisión de juez o magistrado, a los procesos en curso, al momento de promulgarse esta ley.

3. El Consejo Superior de la Judicatura dispondrá lo necesario para que los expedientes de procesos o asuntos en los que no se haya producido actuación alguna en los últimos dos (2) años anteriores a la promulgación de este código, no sean registrados dentro del inventario de procesos en trámite. En consecuencia, estos procesos o asuntos no podrán, en ningún caso, ser considerados para efectos de análisis de carga de trabajo, o congestión judicial.

4. Los artículos 17 numeral 1, 18 numeral 1, 20 numeral 1, 25, 30 numeral 8 y parágrafo, 31 numeral 6 y parágrafo, 32 numeral 5 y parágrafo, 94, 95, 317, 351, 398, 487 parágrafo, 531 a 576 y 590 entrarán a regir a partir del primero (1) de octubre de dos mil doce (2012).

5. A partir del primero (1) de julio de dos mil trece (2013) corresponderá a la Sala Administrativa del Consejo Superior de la Judicatura la expedición de las licencias provisionales y temporales previstas en el Decreto 196 de 1971, así como la aprobación para la constitución de consultorios jurídicos prevista en el artículo 30 de dicho Decreto.

6. Los demás artículos de la presente ley entrarán en vigencia a partir del primero (1) de enero de dos mil catorce (2014), en forma gradual, en la medida en que se hayan ejecutado los programas de formación de funcionarios y empleados y se disponga de la infraestructura física y tecnológica, del número de despachos judiciales requeridos al día, y de los demás elementos necesarios para el funcionamiento del proceso oral y por audiencias, según lo determine el Consejo Superior de la Judicatura, y en un plazo máximo de tres (3) años, al final del cual esta ley entrará en vigencia en todos los distritos judiciales del país.`

/** Ley 1955 de 2019, art. 336 y sus dos parágrafos (literal salvo el recorte marcado). */
const LEY_1955_ART_336 = `ARTÍCULO 336. VIGENCIAS Y DEROGATORIAS. La presente Ley rige a partir de su publicación y deroga todas las disposiciones que le sean contrarias.

Los artículos de las Leyes 812 de 2003,1151 de 2007, 1450 de 2011, y 1753 de 2015 no derogados expresamente en el siguiente inciso o por otras leyes continuarán vigentes hasta que sean derogados o modificados por norma posterior.

Se derogan expresamente el artículo 4 de la Ley 14 de 1983; el artículo 84 de la Ley 100 de 1993; … el artículo 110 de la Ley 1943 de 2018; y el artículo 4 de la Ley 1951 de 2019.

PARÁGRAFO PRIMERO. Los artículos 231, 232, 233, 234, 235 Y 236 de la presente Ley entrarán en vigencia a partir del 1 de enero de 2020.

PARÁGRAFO SEGUNDO. El artículo 49, 58 Y el numeral 43.2.2. del artículo 43 de la Ley 715 de 2001; el artículo 7 de la Ley 1608 de 2013 y los artículos 2 y 3 incisos 6 y 7 de la Ley 1797 de 2016/ perderán vigencia el 31 de diciembre de 2019.`

/** Ley 2294 de 2023, art. 372 (literal, con su lista de derogatorias y sus parágrafos). */
const LEY_2294_ART_372 = `ARTÍCULO 372. VIGENCIAS Y DEROGATORIAS. La presente Ley rige a partir de su publicación y deroga todas las disposiciones que le sean contrarias.

Los artículos de las Leyes 812 de 2003, 1151 de 2007, 1450 de 2011, 1753 de 2015 y 1955 de 2019 no derogados expresamente en el siguiente inciso o por otras leyes, continuarán vigentes hasta que sean derogados o modificados por norma posterior.

PARÁGRAFO PRIMERO. El artículo 282 de la presente ley entrará en vigencia a partir del 1 de enero de 2024.

PARÁGRAFO SEGUNDO. El artículo 49 de la Ley 1955 de 2019 perderá vigencia el 31 de diciembre de 2023.`

/** Ley 2277 de 2022, art. 96: rige desde la promulgación y los impuestos saludables desde el 1 de noviembre de 2023. */
const LEY_2277_ART_96 = `ARTÍCULO 96. VIGENCIA Y DEROGATORIAS. La presente ley rige a partir de su promulgación y deroga el artículo 36-3, los artículos 57, 57-1, el artículo 126, el parágrafo transitorio del artículo 143-1, el artículo 158-1, … el artículo 30 de la Ley 2133 de 2021; así como los artículos 37,38 y 39 de la Ley 2155 de 2021 que regirán hasta el primero (1) de enero de 2023.

Los Decretos Legislativos 560 y 772 de 2020 y sus decretos reglamentarios, quedarán prorrogados hasta el treinta y uno (31) de diciembre de 2023, con excepción del parágrafo 3 del artículo 5, el Título 111 del Decreto Legislativo 560 de 2020, y el Título 111 del Decreto Legislativo 772 de 2020.

Lo dispuesto en el artículo 2 de las Leyes 2238 y 2240 de 2022, relacionado con el término para acogerse al régimen ZESE, se aplicará hasta el treinta y uno (31) de diciembre de 2024.

El beneficio previsto en el artículo 40 de la Ley 2068 de 2020 estará vigente hasta el treinta y uno (31) de diciembre de 2024.

El impuesto a las bebidas ultraprocesadas azucaradas del Capítulo 1 del “TÍTULO V IMPUESTOS SALUDABLES” rige a partir del primero (1) de noviembre de 2023.

El impuesto a los productos comestibles ultraprocesados industrialmente y/o con alto contenido de azúcares añadidos, sodio o grasas saturadas del Capítulo 11 del “TÍTULO V IMPUESTOS SALUDABLES” rige a partir del primero (1) de noviembre de 2023.`

/**
 * Ley 1819 de 2016, art. 589 completo: la frase «entrará en vigencia» está en un
 * parágrafo transitorio condicionado y NO es la cláusula de la ley. Este
 * artículo no trae ninguna.
 */
const LEY_1819_ART_589 = `ARTÍCULO 589. Correcciones que disminuyan el valor a pagar o aumenten el saldo a favor. Para corregir las declaraciones tributarias, disminuyendo el valor a pagar o aumentando el saldo a favor, se deberá presentar la respectiva declaración por el medio al cual se encuentra obligado el contribuyente, dentro del año siguiente al vencimiento del término para presentar la declaración.

La corrección de las declaraciones a que se refiere este artículo no impide la facultad de revisión, la cual se contará a partir de la fecha de la corrección.

PARÁGRAFO . El procedimiento previsto en el presente artículo se aplicará igualmente a las correcciones que impliquen incrementos en los anticipos del impuesto para ser aplicados a las declaraciones de los ejercicios siguientes, salvo que la corrección del anticipo se derive de una corrección que incrementa el impuesto por el correspondiente ejercicio.

PARÁGRAFO transitorio. El presente artículo entrará en vigencia una vez la Administración Tributaria realice los ajustes informáticos necesarios y lo informe así en su página web, plazo que no podrá exceder un (1) año contado a partir del 1 de enero de 2017.`

/** Ley 2466 de 2025, art. 10 par. 2, transcrito dentro de la reforma: tampoco es la cláusula de la ley. */
const LEY_2466_PAR_2 =
  'Parágrafo 2°. Lo dispuesto en el presente artículo entrará en vigencia seis (6) meses después de la sanción ' +
  'de la presente Ley.'

/** Concepto 178311 de 2022 (Función Pública): un documento real sin artículo de vigencia. */
const CONCEPTO_178311 = `Al contestar por favor cite estos datos:

Radicado No.: 20226000178311

Fecha: 13/05/2022 03:20:06 p.m.

Bogotá

Ref.: INHABILIDADES E INCOMPATIBILIDADES. ¿Durante el periodo de aplicación de la Ley de Garantías, resulta viable la contratación de trabajadores oficiales por parte de una Empresa Industrial y Comercial del Estado? Radicado 20222060167322 del 19 de abril de 2022.

En atención a la última pregunta de su comunicación de la referencia, remitida a este Departamento Administrativo por la Agencia Colombia Compra Eficitente, en la cual consulta si durante el periodo de aplicación de la Ley de Garantías, resulta viable la contratación de trabajadores oficiales por parte de una Empresa Industrial y Comercial del Estado, me permito informarle lo siguiente:

Sea lo primero señalar que la Ley 996 del 24 de noviembre de 20051tiene por objeto garantizar la transparencia en los comicios electorales y limitar la vinculación y la contratación pública en las entidades de la Rama Ejecutiva, para el efecto señala las siguientes disposiciones:

“ARTÍCULO 32. Vinculación a la nómina estatal. Se suspenderá cualquier forma de vinculación que afecte la nómina estatal, en la Rama Ejecutiva del Poder Público, durante los cuatro (4) meses anteriores a la elección presidencial y hasta la realización de la segunda vuelta, si fuere el caso. Se exceptúan de la presente disposición, los casos a que se refiere el inciso segundo del artículo siguiente.`

/**
 * Construido, no medido: entre las 22 normas bajadas (2026-09-28) ninguna tenía
 * un artículo titulado «Vigencia» con una entrada en vigor condicionada, así que
 * esta fixture junta el título real (el que usa la mayoría de las normas) con la
 * cláusula condicional literal del parágrafo transitorio del art. 589 de la Ley
 * 1819 de 2016, recortada para que se lea como cláusula de vigencia. Es el caso
 * que la clase `no-determinada` declara en vez de inventar una fecha.
 */
const VIGENCIA_CONDICIONAL = `ARTÍCULO 89. Vigencia. El presente artículo entrará en vigencia una vez la Administración Tributaria realice los ajustes informáticos necesarios y lo informe así en su página web.`

/**
 * Construido, no medido: el año escrito en letras sin el dígito entre paréntesis
 * («dos mil veintisiete») no apareció en las 22 normas medidas; las formas
 * reales lo escriben con paréntesis («dos mil catorce (2014)», CGP art. 627).
 */
const ANIO_EN_LETRAS = 'ARTÍCULO 5. Vigencia. La presente ley empezará a regir el 1 de enero de dos mil veintisiete.'

// --- una prueba por clase --------------------------------------------------

test('inmediata: «rige a partir de su promulgación» (Ley 2466 de 2025, art. 70)', () => {
  const v = analizarVacancia(LEY_2466_ART_70)
  assert.equal(v.clase, 'inmediata')
  assert.equal(v.articulo.numero, '70')
  assert.equal(v.desde, undefined)
  assert.equal(enVacancia(v), false)
  assert.match(v.resumen, /desde la promulgación/)
  assert.match(v.articulo.texto, /rige a partir de su promulgación/)
})

test('inmediata: la errata «empezara» del portal no impide reconocerla (Ley 2101 de 2021, art. 8)', () => {
  const v = analizarVacancia(LEY_2101_ART_8)
  assert.equal(v.clase, 'inmediata')
  assert.equal(v.articulo.numero, '8')
  assert.equal(enVacancia(v), false)
})

test('fecha-fija: «el dos (2) de julio del año 2012» en letras (CPACA, art. 308)', () => {
  const v = analizarVacancia(CPACA_ART_308)
  assert.equal(v.clase, 'fecha-fija')
  assert.equal(v.desde, '2012-07-02')
  assert.equal(v.articulo.numero, '308')
  assert.equal(enVacancia(v, new Date('2012-07-01T12:00:00')), true)
  assert.equal(enVacancia(v, new Date('2012-07-02T12:00:00')), false)
  assert.match(v.resumen, /2 de julio de 2012/)
})

test('fecha-fija: «entrará en vigor el 01 de julio de 2025» y, con el art. 95, la ley entera es escalonada (Ley 2381 de 2024)', () => {
  const solo94 = analizarVacancia(LEY_2381_ART_94)
  assert.equal(solo94.clase, 'fecha-fija')
  assert.equal(solo94.desde, '2025-07-01')
  assert.equal(enVacancia(solo94, new Date('2025-06-30T12:00:00')), true)

  const ley = analizarVacancia(`${LEY_2381_ART_94}\n\n${LEY_2381_ART_95}`)
  assert.equal(ley.clase, 'escalonada')
  assert.equal(ley.articulo.numero, '95')
  assert.match(ley.resumen, /1 de julio de 2025/)
  assert.match(ley.resumen, /desde la sanción/)
  assert.equal(enVacancia(ley), null)
})

test('relativa sin fecha de publicación: no calcula y dice qué falta (Ley 1801 de 2016, art. 243)', () => {
  const v = analizarVacancia(LEY_1801_ART_243)
  assert.equal(v.clase, 'relativa')
  assert.equal(v.desde, undefined)
  assert.equal(enVacancia(v), null)
  assert.match(v.resumen, /seis \(6\) meses después de su promulgación/)
  assert.match(v.resumen, /falta la fecha de publicación/i)
})

test('relativa con la fecha de publicación que se le pasa: seis meses después (Ley 1801 de 2016)', () => {
  const v = analizarVacancia(LEY_1801_ART_243, { publicacion: '2016-07-29' })
  assert.equal(v.clase, 'relativa')
  assert.equal(v.desde, '2017-01-29')
  assert.equal(enVacancia(v, new Date('2017-01-28T12:00:00')), true)
  assert.equal(enVacancia(v, new Date('2017-01-29T12:00:00')), false)
})

test('relativa con la fecha de publicación que trae la nota del Diario Oficial al final del texto', () => {
  const v = analizarVacancia(`${LEY_1801_ART_243}\n\n---\n\n${LEY_1801_NOTA}`)
  assert.equal(v.clase, 'relativa')
  assert.equal(v.desde, '2017-01-29')
  assert.match(v.resumen, /nota del Diario Oficial/)
})

test('escalonada: el CGP entra por tramos (promulgación, 1 de octubre de 2012 y 1 de enero de 2014)', () => {
  const v = analizarVacancia(CGP_ART_627)
  assert.equal(v.clase, 'escalonada')
  assert.equal(v.articulo.numero, '627')
  assert.equal(v.desde, undefined)
  assert.match(v.resumen, /desde la promulgación/)
  assert.match(v.resumen, /1 de octubre de 2012/)
  assert.match(v.resumen, /1 de enero de 2014/)
  // El numeral 5 fija una competencia en una fecha, pero no es una entrada en vigor.
  assert.doesNotMatch(v.resumen, /1 de julio de 2013/)
})

test('escalonada: el parágrafo de un artículo de vigencia escalona seis artículos (Ley 1955 de 2019, art. 336)', () => {
  const v = analizarVacancia(LEY_1955_ART_336)
  assert.equal(v.clase, 'escalonada')
  assert.equal(v.articulo.numero, '336')
  assert.match(v.resumen, /1 de enero de 2020/)
  assert.match(v.resumen, /desde la publicación/)
  // «perderán vigencia el 31 de diciembre de 2019» es un vencimiento, no una entrada.
  assert.match(v.resumen, /1 de enero de 2020/)
  assert.doesNotMatch(v.resumen, /31 de diciembre de 2019/)
})

test('escalonada: la ley rige desde su publicación y el art. 282 desde el 1 de enero de 2024 (Ley 2294 de 2023, art. 372)', () => {
  const v = analizarVacancia(LEY_2294_ART_372)
  assert.equal(v.clase, 'escalonada')
  assert.match(v.resumen, /1 de enero de 2024/)
  assert.match(v.resumen, /desde la publicación/)
  assert.doesNotMatch(v.resumen, /31 de diciembre de 2023/)
})

test('escalonada: dos impuestos que rigen desde el 1 de noviembre de 2023 se enumeran una sola vez (Ley 2277 de 2022)', () => {
  const v = analizarVacancia(LEY_2277_ART_96)
  assert.equal(v.clase, 'escalonada')
  assert.equal(v.articulo.numero, '96')
  const menciones = v.resumen.match(/1 de noviembre de 2023/g) ?? []
  assert.equal(menciones.length, 1)
  // Los «regirán hasta el 1 de enero de 2023» son vencimientos: no entran.
  assert.doesNotMatch(v.resumen, /1 de enero de 2023/)
})

test('escalonada con dos artículos: la 1996 rige desde su promulgación y el Capítulo V a los 24 meses', () => {
  const v = analizarVacancia(`${LEY_1996_ART_52}\n\n${LEY_1996_ART_63}`)
  assert.equal(v.clase, 'escalonada')
  assert.equal(v.articulo.numero, '63')
  assert.match(v.resumen, /veinticuatro \(24\) meses/)
  assert.match(v.resumen, /artículo 52/)
})

test('no-determinada: hay artículo de vigencia pero ninguna fecha citable', () => {
  const v = analizarVacancia(VIGENCIA_CONDICIONAL)
  assert.equal(v.clase, 'no-determinada')
  assert.equal(v.desde, undefined)
  assert.equal(enVacancia(v), null)
  assert.match(v.resumen, /se cita literal/i)
})

test('no-encontrada: el artículo 589 de la Ley 1819 no trae cláusula de vigencia', () => {
  const v = analizarVacancia(LEY_1819_ART_589)
  assert.equal(v.clase, 'no-encontrada')
  assert.equal(v.desde, undefined)
  assert.equal(enVacancia(v), null)
})

test('no-encontrada: un concepto real no tiene artículo de vigencia', () => {
  const v = analizarVacancia(CONCEPTO_178311)
  assert.equal(v.clase, 'no-encontrada')
  assert.equal(enVacancia(v), null)
})

// --- falsos positivos ------------------------------------------------------

test('falso positivo: el parágrafo de la reforma no es la cláusula de la ley; manda el art. 70', () => {
  const v = analizarVacancia(`${LEY_2466_PAR_2}\n\n${LEY_2466_ART_70}`)
  assert.equal(v.clase, 'inmediata')
  assert.equal(v.articulo.numero, '70')
  assert.equal(v.desde, undefined)
})

test('falso positivo: «seis (6) meses después de la sanción» de un artículo suelto no fecha nada', () => {
  const v = analizarVacancia(LEY_2466_PAR_2)
  assert.equal(v.clase, 'no-encontrada')
  assert.equal(v.desde, undefined)
})

test('falso positivo: un número de artículo dentro de la lista no se lee como fecha', () => {
  const v = analizarVacancia(
    'ARTÍCULO 1. Vigencia. La presente ley rige a partir de su publicación y deroga los artículos 5, 12 y 30 de la Ley 100 de 1993.',
  )
  assert.equal(v.clase, 'inmediata')
  assert.equal(v.desde, undefined)
})

// --- fechas escritas de otras formas ---------------------------------------

test('el año en letras sin paréntesis también se lee («1 de enero de dos mil veintisiete»)', () => {
  const v = analizarVacancia(ANIO_EN_LETRAS)
  assert.equal(v.clase, 'fecha-fija')
  assert.equal(v.desde, '2027-01-01')
})

test('los años en letras con paréntesis se leen con el dígito cuando existe', () => {
  const v = analizarVacancia(
    'Artículo 10. Vigencia. El presente código entrará a regir a partir del primero (1) de enero de dos mil catorce (2014).',
  )
  assert.equal(v.clase, 'fecha-fija')
  assert.equal(v.desde, '2014-01-01')
})

// --- contrato de `enVacancia` ----------------------------------------------

test('enVacancia: null cuando la clase no permite afirmarlo y false cuando ya no hay espera', () => {
  assert.equal(enVacancia(analizarVacancia('ARTÍCULO 1. Objeto. La presente ley tiene por objeto regular la materia.')), null)
  assert.equal(enVacancia({ articulo: { numero: '1', texto: '' }, clase: 'no-determinada', resumen: '' }), null)
  assert.equal(enVacancia({ articulo: { numero: '1', texto: '' }, clase: 'escalonada', resumen: '' }), null)
  assert.equal(enVacancia({ articulo: { numero: '1', texto: '' }, clase: 'inmediata', resumen: '' }), false)
})

test('el artículo devuelto es el literal del texto, no una reconstrucción', () => {
  const v = analizarVacancia(LEY_2466_ART_70)
  assert.ok(LEY_2466_ART_70.includes(v.articulo.texto))
})

// --- contra la fuente real -------------------------------------------------

test('RED: tres normas del Gestor se clasifican como se midió el 2026-09-28', RED, async () => {
  const casos: [string, string, string, ClaseVacancia, string | undefined][] = [
    ['Ley', '1801', '2016', 'relativa', '2017-01-29'],
    ['Ley', '1437', '2011', 'fecha-fija', '2012-07-02'],
    ['Ley', '2466', '2025', 'inmediata', undefined],
  ]
  for (const [tipo, numero, anio, clase, desde] of casos) {
    const r = await gestor.buscar({ tipo, numero, anio })
    const item = r.items[0]
    assert.ok(item, `${tipo} ${numero} de ${anio} no apareció en el Gestor`)
    const n = await gestor.obtenerNorma(item.id)
    const v = analizarVacancia(n.texto)
    assert.equal(v.clase, clase, `${tipo} ${numero} de ${anio}: ${v.resumen}`)
    assert.equal(v.desde, desde, `${tipo} ${numero} de ${anio}`)
  }
})
