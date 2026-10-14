/**
 * ¿La norma ya rige? Vacancia legal y vigencia diferida.
 *
 * Las normas complejas no empiezan a regir el día de su sanción: «La presente
 * ley regirá seis (6) meses después de su promulgación» (Ley 1801 de 2016),
 * «…entrará en vigor el 01 de julio de 2025» (Ley 2381 de 2024), «…a partir del
 * primero (1) de noviembre de 2023» (Ley 2277 de 2022). Tratarlas como exigibles
 * hoy es el error caro, y este módulo solo afirma lo que el artículo de vigencia
 * dice: cuando el texto no permite calcular la fecha, lo declara en vez de
 * suponerla.
 *
 * Todo lo que sigue está medido el 2026-09-28 sobre 15 normas reales del Gestor
 * (Leyes 2277/2022, 2381/2024, 2466/2025, 2010/2019, 1564/2012, 1437/2011,
 * 909/2004, 1801/2016, 1955/2019, 1819/2016, 2101/2021, 1996/2019, 2294/2023 y
 * 100/1993, más el Código General del Proceso):
 *
 * - El artículo de vigencia no es el último por regla: en la Ley 2381/2024 el
 *   que cierra es el 95 («Derogatorias») y el 94 es la vigencia; en la
 *   1955/2019 el 336 es «Vigencias y derogatorias» pero su parágrafo primero
 *   escalona seis artículos; en la 2294/2023, el 372 hace lo mismo con el 282.
 *   Se localiza por su título («Vigencia», «Vigencias y derogatorias», «Régimen
 *   de transición y vigencia») o por una fórmula que toma la propia norma como
 *   sujeto («la presente ley rige/regirá/entrará en vigencia/empezará a
 *   regir»), nunca por su posición.
 * - Las fechas se escriben de muchas formas y todas las de abajo aparecieron:
 *   «el dos (2) de julio del año 2012» (CPACA), «el primero (1) de octubre de
 *   dos mil doce (2012)» y «el primero (1) de enero de dos mil catorce (2014)»
 *   (CGP), «el 01 de julio de 2025» (Ley 2381), «el 1o. de abril de 1994»
 *   (Ley 100) y «el primero (1) de noviembre de 2023» (Ley 2277). Por eso el
 *   día y el año se leen también en letras, prefiriendo el dígito entre
 *   paréntesis cuando existe.
 * - Los plazos también: «seis (6) meses después de su promulgación» (Ley 1801),
 *   «veinticuatro (24) meses después de la promulgación» (Ley 1996).
 * - La fecha de publicación no está en el texto de todas las normas. El Gestor
 *   la publica en la ficha cuando la tiene («Medio de Publicación»: «Diario
 *   Oficial 41.148 del 23 de Diciembre de 1993», Ley 100) y a veces la deja
 *   vacía (Ley 2277). Algunas la traen al final del propio texto, como nota del
 *   portal («NOTA: Publicada en el Diario Oficial 48489 de julio 12 de 2012»),
 *   y esa nota se usa para calcular las vigencias relativas: sin fecha de
 *   publicación, `relativa` no calcula y el resumen dice qué falta.
 * - Fórmulas que NO son la cláusula de entrada en vigor de la norma y se
 *   descartan, con el texto real donde se midieron: «El presente artículo
 *   entrará en vigencia una vez la Administración Tributaria realice los
 *   ajustes informáticos…» (Ley 1819, art. 589 par. transitorio), «Lo dispuesto
 *   en el presente artículo entrará en vigencia seis (6) meses después de la
 *   sanción de la presente Ley» (Ley 2466, art. 10 par. 2), «VIGENCIAS FUTURAS
 *   DE LA NACIÓN…» y «VIGENCIA FONDOS ELÉCTRICOS» (títulos de los arts. 112 y
 *   21 de la Ley 1955) y «Vigencia del Sistema General de Pensiones» (Ley 100,
 *   art. 151, que fecha un subsistema, no la norma).
 */
export { analizarVacancia, enVacancia, type ClaseVacancia, type Vacancia } from './analisis.ts'
