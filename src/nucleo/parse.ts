import * as cheerio from 'cheerio/slim'

export const BASE_GESTOR = 'https://www.funcionpublica.gov.co/eva/gestornormativo'

/**
 * El MCP vive del HTML de un portal que puede cambiar sin aviso. Cuando el
 * parseo deja de encontrar lo que esperaba hay que gritarlo: una lista vacía
 * en silencio es indistinguible de "no existe", y en materia legal esa
 * confusión es el peor fallo posible.
 */
export class CanarioError extends Error {
  constructor(que: string) {
    super(
      `El portal cambió su estructura y esta extensión no pudo leer la respuesta (${que}). ` +
        `No es que no haya resultados: es que no se pudieron interpretar. ` +
        `Actualiza la extensión desde https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases`,
    )
    this.name = 'CanarioError'
  }
}

export class NoExisteError extends Error {
  constructor(id: string) {
    super(`No existe un documento con el identificador ${id} en el Gestor Normativo.`)
    this.name = 'NoExisteError'
  }
}

// --- texto ---------------------------------------------------------------

const CON = 'áàäâÁÀÄÂéèëêÉÈËÊíìïîÍÌÏÎóòöôÓÒÖÔúùüûÚÙÜÛñÑçÇ'
const SIN = 'aaaaAAAAeeeeEEEEiiiiIIIIooooOOOOuuuuUUUUnNcC'
const TILDES: Record<string, string> = {}
for (let i = 0; i < CON.length; i++) TILDES[CON[i]!] = SIN[i]!

/** Quita tildes conservando la longitud, para poder cortar el texto original por índice. */
export const sinTildes = (s: string): string =>
  s.replace(/[áàäâÁÀÄÂéèëêÉÈËÊíìïîÍÌÏÎóòöôÓÒÖÔúùüûÚÙÜÛñÑçÇ]/g, (c) => TILDES[c] ?? c)

/** Colapsa cualquier serie de espacios (y saltos) a un solo espacio y recorta. */
export const colapsarEspacios = (s: string): string => s.replace(/\s+/g, ' ').trim()

export const tieneTildes = (s: string): boolean => sinTildes(s) !== s

/**
 * El portal guarda temas en mayúsculas pero con las vocales acentuadas en
 * minúscula ("PROVISIóN - ENCARGO"), porque quien los cargó usó una función que
 * no contempla tildes. Se corrige solo ese artefacto: las erratas del propio
 * dato oficial —"Telebrajo"— se dejan como están, porque son lo que el portal
 * tiene indexado y corregirlas en silencio rompería la correspondencia.
 */
export const normalizarRotulo = (s: string): string =>
  s.replace(/\S+/g, (palabra) => {
    if (!/[áéíóúüñ]/.test(palabra)) return palabra
    // Si al quitar las vocales acentuadas lo que queda son solo mayúsculas,
    // la palabra iba en mayúsculas y la tilde se quedó atrás.
    const resto = palabra.replace(/[áéíóúüñ]/g, '')
    return /[A-ZÁÉÍÓÚÑ]/.test(resto) && resto === resto.toUpperCase() ? palabra.toUpperCase() : palabra
  })

/** Ambos portales devuelven error ante comillas y signos de control en los términos. */
export const limpiarTermino = (s: string): string =>
  s.replace(/["'<>;%\\]/g, ' ').replace(/\s+/g, ' ').trim()

/** Basura que Word deja incrustada en los documentos viejos (ver Ley 114 de 1913). */
const LINEA_BASURA =
  /mso-|MsoNormal|X-NONE|Style Definitions|^\s*\d{4}-\d{2}-\d{2}T[\d:]{8}Z|^\s*<!\[endif\]|^(Clean|false|true|Normal|ES-CO|MicrosoftInternetExplorer\d*)$|^[\d.,]+( pto)?$|^[a-z-]+:[^;]{0,60};$/i

/**
 * Los documentos viejos abren con el bloque de propiedades de Word (autor,
 * revisiones, "Hewlett-Packard", CSS): el portal guardó el HTML de Word quitando
 * las etiquetas pero dejando los valores, así que no queda marca estructural.
 * Se descarta el preámbulo de líneas cortas hasta la primera línea sustantiva.
 *
 * ponytail: heurística acotada a las primeras 80 líneas y solo mientras las
 * líneas sean cortas; si aparece un documento que empiece con muchas líneas
 * cortas legítimas, hay que acotar por selector en vez de por contenido.
 *
 * Ese documento apareció: las providencias de la Corte Suprema abren con siete
 * líneas cortas —"CORTE SUPREMA DE JUSTICIA", "Radicación n.° 46498", el
 * ponente, "SL3772-2018"— y se descartaban enteras, con el radicado dentro, que
 * es la clave con la que se cita. Se resolvió por donde estaba previsto, con
 * INICIO_REAL: basta que la PRIMERA línea sea un comienzo reconocible para que
 * no se descarte nada. El preámbulo de Word nunca empieza por CORTE, SALA ni
 * RADICACIÓN: son "Clean", "false", "mso-…" o cifras sueltas.
 */
const INICIO_REAL =
  /^(LEY|DECRETO|RESOLUCI[ÓO]N|CIRCULAR|ACUERDO|SENTENCIA|CONCEPTO|AUTO|DIRECTIVA|CONSTITUCI[ÓO]N|ACTO|ART[ÍI]CULO|CORTE|SALA|RADICACI[ÓO]N|EL |LA |LOS |POR |REP[ÚU]BLICA|MINISTERIO|DEPARTAMENTO)/i

function quitarPreambuloWord(lineas: string[]): string[] {
  let i = 0
  let descartadas = 0
  while (i < lineas.length && descartadas < 40) {
    const l = lineas[i]!
    if (l === '') {
      i++ // los renglones en blanco no gastan el presupuesto de descarte
      continue
    }
    if (INICIO_REAL.test(l) || l.length >= 40) break
    descartadas++
    i++
  }
  return descartadas > 0 && i < lineas.length ? lineas.slice(i) : lineas
}

const DESCARGO = /Los datos publicados tienen prop[óo]sitos exclusivamente informativos[^.]*\./i

function limpiarTexto(bruto: string): string {
  const lineas = bruto
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => !LINEA_BASURA.test(l))

  const utiles = quitarPreambuloWord(lineas)

  let t = utiles.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  // El descargo del propio portal lo emitimos aparte, una vez, no dentro del articulado.
  const m = t.match(DESCARGO)
  if (m && t.indexOf(m[0]) < 400) t = t.slice(t.indexOf(m[0]) + m[0].length).trim()

  return t
}

const BLOQUES = 'p,div,br,tr,li,h1,h2,h3,h4,h5,h6,table,blockquote'

/** Carga HTML quitando de raíz lo que ensucia el texto (scripts, estilos, XML de Word). */
export function cargar(html: string): cheerio.CheerioAPI {
  const limpio = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|xml|o:p)\b[\s\S]*?<\/\1>/gi, ' ')
  return cheerio.load(limpio)
}

export function textoDe($: cheerio.CheerioAPI, selector: string): string {
  const $c = $(selector).first()
  if (!$c.length) return ''
  $c.find(BLOQUES).after('\n')
  return limpiarTexto($c.text())
}

// --- troceado y búsqueda dentro del texto --------------------------------

export type Trozo = { texto: string; total: number; desde: number; omitido: number }

export function trocear(texto: string, desde = 0, limite = 8000): Trozo {
  const ini = Math.max(0, Math.min(desde, texto.length))
  const fin = Math.min(texto.length, ini + limite)
  return { texto: texto.slice(ini, fin), total: texto.length, desde: ini, omitido: texto.length - fin }
}

/**
 * Búsqueda de texto completo del lado del cliente: el buscador del portal solo
 * indexa los resúmenes temáticos, así que es aquí donde realmente se busca
 * dentro del articulado.
 */
export function fragmentos(
  texto: string,
  termino: string,
  contexto = 400,
  max = 10,
  presupuesto = Number.POSITIVE_INFINITY,
) {
  const plano = sinTildes(texto).toLowerCase()
  const aguja = sinTildes(termino).toLowerCase().trim()
  if (!aguja) return { total: 0, trozos: [] as string[], inicios: [] as number[], pasajes: 0, mostrados: 0 }

  // Ventanas solapadas se fusionan: dos coincidencias cercanas producían seis
  // extractos casi idénticos y hacían leer lo mismo varias veces.
  const ventanas: { ini: number; fin: number; hits: number; primera: number }[] = []
  let total = 0
  for (let i = plano.indexOf(aguja); i !== -1; i = plano.indexOf(aguja, i + aguja.length)) {
    total++
    const ini = Math.max(0, i - contexto)
    const fin = Math.min(texto.length, i + aguja.length + contexto)
    const ultima = ventanas.at(-1)
    if (ultima && ini <= ultima.fin) {
      ultima.fin = Math.max(ultima.fin, fin)
      ultima.hits++
    } else {
      // `primera` es la posición de la coincidencia, no la de la ventana: quien
      // rotula el pasaje necesita saber dónde cae el término, no dónde empieza
      // el contexto, que puede haber cruzado una frontera de sección.
      ventanas.push({ ini, fin, hits: 1, primera: i })
    }
  }

  // El presupuesto de caracteres manda sobre el número de pasajes: sin él, diez
  // pasajes fusionados pueden superar los 18.000 caracteres justo en las normas
  // grandes, que son las que este troceado existe para poder manejar.
  const trozos: string[] = []
  const inicios: number[] = []
  let gastado = 0
  for (const v of ventanas.slice(0, max)) {
    if (gastado >= presupuesto) break
    const margen = presupuesto - gastado
    let cuerpo = texto.slice(v.ini, v.fin).trim()
    if (cuerpo.length > margen) cuerpo = `${cuerpo.slice(0, Math.max(0, margen - 1)).trimEnd()}…`
    const trozo =
      (v.ini > 0 ? '…' : '') +
      cuerpo +
      (v.fin < texto.length ? '…' : '') +
      (v.hits > 1 ? `\n[${v.hits} coincidencias en este pasaje]` : '')
    trozos.push(trozo)
    inicios.push(v.primera)
    gastado += cuerpo.length
  }

  return { total, trozos, inicios, pasajes: ventanas.length, mostrados: trozos.length }
}

/** true si lo que precede a un encabezado lo anuncia como texto citado ("…quedará así:"). */
const abreBloqueCitado = (previo: string): boolean => previo.trimEnd().endsWith(':')

/**
 * Números que un encabezado de sustitución anuncia: "Los artículos 217 y 218
 * del Código Civil quedarán así:" → {217, 218}. Sirve para no cortar el
 * artículo en medio del bloque que transcribe.
 */
// El número de un artículo: 217, 2.2.1.3.1, 771-5, 217A.
const NUM_ARTICULO = String.raw`[\d.]+(?:-\d+)?[A-Za-z]?`
const RE_ANUNCIADOS = new RegExp(
  String.raw`\bart[íi]culos?\s+((?:${NUM_ARTICULO})(?:\s*(?:,|y|e)\s*${NUM_ARTICULO})*)`,
  'gi',
)
const RE_NUM_SUELTO = new RegExp(NUM_ARTICULO, 'g')

function articulosAnunciados(intro: string): Set<string> {
  const nums = new Set<string>()
  for (const m of intro.matchAll(RE_ANUNCIADOS))
    for (const n of m[1]!.match(RE_NUM_SUELTO) ?? []) nums.add(n.replace(/\.$/, ''))
  return nums
}

/**
 * Índice de artículos, para que Claude sepa qué pedir sin traerse la norma entera.
 *
 * El encabezado tiene que abrir renglón. Sin esa exigencia, las referencias
 * cruzadas dentro de las notas —"modificado por el artículo 21 de la Ley 1955"—
 * entraban como artículos propios, y en el Decreto 1083 de 2015, que numera
 * 2.2.1.3.1, aparecían "21", "5" y "19" mezclados con la numeración real.
 * Es la misma regla que ya usaba `articulo()` para no cortar por una nota.
 */
export function indiceArticulos(texto: string, max = 60): string[] {
  const vistos = new Set<string>()
  const citados = new Set<string>()
  const re = new RegExp(String.raw`(?:^|\n)\s*(?:ART[IÍ]CULO|Art[ií]culo)\s+(${NUM_ARTICULO})`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(texto)) && vistos.size < max) {
    const num = m[1]!.replace(/\.$/, '')
    // El artículo que una ley modificatoria transcribe NO es un artículo suyo:
    // en la Ley 1060 de 2006 el "Artículo 217" que sigue a "quedará así:" es
    // del Código Civil, y listarlo hacía pedir un artículo que la ley no tiene.
    const previo = texto.slice(Math.max(0, m.index - 300), m.index)
    if (abreBloqueCitado(previo)) {
      for (const n of articulosAnunciados(previo)) citados.add(n)
      continue
    }
    if (citados.delete(num)) continue
    vistos.add(num)
  }
  return [...vistos]
}

const RE_ENCABEZADO = new RegExp(String.raw`\n\s*(?:ART[IÍ]CULO|Art[ií]culo)\s+(${NUM_ARTICULO})`)

export function articulo(texto: string, numero: string): string | null {
  const n = numero.replace(/[^\d.\-A-Za-z]/g, '').replace(/[.]+$/, '')
  if (!n) return null
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // El cierre no puede ser `\b`: con él, pedir el artículo 771 casaba con el
  // encabezado de "Artículo 771-5" y se devolvía otro artículo sin avisar.
  const re = new RegExp(`\\b(?:ART[IÍ]CULO|Art[ií]culo)\\s+${esc}(?![\\d\\-A-Za-z])`, 'g')
  const m = re.exec(texto)
  if (!m) return null
  const desde = m.index + m[0].length
  const fin = () => texto.slice(m.index, Math.min(texto.length, m.index + 20000)).trim()

  /**
   * El siguiente artículo tiene que ser un encabezado (inicio de renglón y
   * seguido de su número). Sin esa exigencia, una referencia cruzada dentro de
   * una nota —"Artículo 15 Ley 91 de 1989"— cortaba el artículo por la mitad y
   * se perdían justo las notas de vigencia.
   *
   * Y el encabezado no basta: la legislación modificatoria, que en Colombia es
   * la mayoría, transcribe el artículo que sustituye. "Artículo 5°. El artículo
   * 217 del Código Civil quedará así:" seguido de "Artículo 217. …" cortaba
   * justo en los dos puntos y el artículo se devolvía sin su contenido, que era
   * todo lo que se había pedido. Un encabezado se salta cuando lo anuncian los
   * dos puntos que lo preceden o cuando su número es de los que la sustitución
   * declara.
   */
  let anunciados: Set<string> | null = null
  let cursor = desde
  for (;;) {
    const enc = RE_ENCABEZADO.exec(texto.slice(cursor))
    if (!enc) return fin()
    const abs = cursor + enc.index
    // Pasado el encabezado entero: avanzar un carácter volvía a encontrar el
    // mismo, porque `\n\s*` casa también desde el renglón en blanco anterior.
    cursor = abs + enc[0].length
    const previo = texto.slice(m.index, abs)
    if (anunciados === null) anunciados = abreBloqueCitado(previo) ? articulosAnunciados(previo) : new Set()
    const num = enc[1]!.replace(/\.$/, '')
    if (abreBloqueCitado(previo) || anunciados.has(num)) {
      // Cada número anunciado se salta UNA vez: si la ley tuviera un artículo
      // propio con ese mismo número, saltárselo también se comería un artículo
      // entero sin que nada lo delatara.
      anunciados.delete(num)
      continue
    }
    return texto.slice(m.index, abs).trim()
  }
}

/**
 * Deja el texto "sustantivo" de un artículo: quita las notas entre paréntesis
 * que el portal incrusta ("(Modificado por el Art. 3 de la Ley 2418 de 2024)",
 * "(Ver Sentencia T-800 de 2011)"). Para COMPARAR dos artículos, esas notas son
 * ruido editorial, no contenido; el texto limpio es el que debe contrastarse.
 */
export function limpiarArticulo(texto: string): string {
  return texto
    .split('\n')
    .map((l) =>
      l.replace(/\([^)\n]{0,200}\)/g, ' ').replace(/\s+/g, ' ').trim(),
    )
    .filter(Boolean)
    .join('\n')
}

/**
 * Referencias a documentos que el texto manda consultar y que NO son normas:
 * manuales, protocolos, guías, cartillas, instructivos, anexos. Ninguna fuente
 * de esta extensión los tiene, así que callarlas es la peor respuesta posible:
 * quien pregunta por el punto que decide el caso recibe el artículo, no
 * encuentra la regla, y concluye que el artículo no dice nada.
 *
 * Medido el 2026-09-16 en el Decreto 1066 de 2015, artículo 2.4.1.2.44, numeral
 * 1.16 (id 76835, https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=76835):
 * «Las demás establecidas en el Manual de Uso, Manejo y Recomendaciones de
 * Medidas de Prevención y Protección, o el documento que haga sus veces». Ese
 * manual decidía el punto central de un caso real y no está en ninguna fuente.
 *
 * La palabra clave va en mayúscula inicial a propósito: así se lee como el
 * título de un documento («el Manual de Uso…») y no como una descripción
 * («el manual de funciones aplicable»), que no nombra nada que consultar.
 */
const DOCUMENTO_EXTERNO = /\b(?:Manual|Protocolo|Gu[íi]a|Cartilla|Instructivo|Anexo)\b[^.;\n]{0,110}/g

export function documentosRemitidos(texto: string): string[] {
  const plano = texto.replace(/\s+/g, ' ')
  const vistos = new Set<string>()
  for (const m of plano.matchAll(DOCUMENTO_EXTERNO)) {
    const doc = m[0].replace(/\s+/g, ' ').replace(/[,;:]$/, '').trim()
    // Un tramo que además nombra una norma no es el caso que aquí falta: eso
    // se resuelve con `resolver_cita`.
    if (/\b(?:Ley|Decreto|Resoluci[óo]n|Acuerdo|Circular)\s*\d/i.test(doc)) continue
    if (doc.length < 12) continue
    vistos.add(doc.length > 120 ? `${doc.slice(0, 119)}…` : doc)
  }
  return [...vistos]
}

/**
 * Erratas verificadas en el texto que sirven las fuentes, medidas una a una.
 * Medido el 2026-09-16 en la SU-371/21 (relatoría de la Corte Constitucional,
 * https://www.corteconstitucional.gov.co/relatoria/2021/SU371-21.htm): «tener
 * como validas tales grabaciones» (por «válidas») e «intensión» (por
 * «intención»). El texto se devuelve literal —corregirlo en silencio rompería
 * la correspondencia con la fuente—, así que lo que hay que hacer es declararlo.
 *
 * ponytail: la lista es corta y envejece: cubre solo las erratas comprobadas a
 * mano. El techo es una errata que nadie haya verificado antes; el salto, si
 * algún día importa, es un corrector ortográfico sobre el fragmento, no ampliar
 * la lista a ojo.
 */
const ERRATAS_VERIFICADAS = ['validas', 'intensión']

/**
 * Lo que el fragmento devuelto puede hacer creer y no es cierto. Hoy son tres
 * familias y el nombre solo nombra la primera: la vigencia incrustada en el
 * articulado, las remisiones a documentos que ninguna fuente tiene y las
 * erratas de la fuente que se transcriben sin corregir. Las tres comparten el
 * mismo motivo para vivir aquí —el fragmento viaja sin su contexto y quien lo
 * lee no puede saberlo—, y las tres viajan juntas porque todas las fuentes
 * llaman a esta función al devolver texto.
 *
 * La vigencia no es un campo: va incrustada en el articulado. El Decreto 1083
 * trae 155 "Modificado por" y 17 "Derogado". Citar un artículo derogado como
 * vigente es el error caro, así que se advierte sobre el fragmento devuelto.
 */
export function advertenciasVigencia(texto: string): string[] {
  const avisos: string[] = []
  const derogado = (texto.match(/\bDerogad[oa]\b/gi) ?? []).length
  const modificado = (texto.match(/\bModificad[oa] por\b/gi) ?? []).length
  // Las otras dos formas de anotar una reforma, las mismas que reconoce
  // `historial`. Sin ellas, el artículo 6 de la Ley 1221 de 2008 —declarado
  // exequible de forma condicionada e inhibida en un numeral, y adicionado por
  // la Ley 2466 de 2025— se mostraba sin una sola advertencia.
  const reformado = (texto.match(/\(\s*(?:Adiciona|Modifica|Deroga|Sustituye|Subroga|Corrige)\b[^)\n]{0,160}\)/gi) ?? []).length
  const constitucional = (texto.match(/\bDeclarad[oa]s?\b(?=[^\n]{0,160}\b(?:C|T|SU)-\s?\d)/gi) ?? []).length
  if (derogado) avisos.push(`El texto mostrado contiene ${derogado} marca(s) de derogatoria. Verifica si el aparte que te interesa sigue vigente.`)
  if (modificado) avisos.push(`Contiene ${modificado} nota(s) de "Modificado por". El texto original pudo haber cambiado.`)
  if (reformado) avisos.push(`Contiene ${reformado} nota(s) del portal en activa ("Adiciona…", "Deroga…"). Úsalas con obtener_documento con fuente="gestor" e historial=true.`)
  if (constitucional) {
    avisos.push(
      `Contiene ${constitucional} nota(s) de control constitucional (exequibilidad condicionada, inexequibilidad o ` +
        `inhibición). El aparte afectado puede no regir tal como está escrito: lee la sentencia citada.`,
    )
  }
  for (const doc of documentosRemitidos(texto)) {
    avisos.push(
      `Este artículo remite a un documento externo: «${doc}». Esta herramienta NO lo consulta —no está en ninguna ` +
        `de sus fuentes—, así que la regla que ese documento fija no puede leerse aquí. Búscalo aparte antes de ` +
        `concluir que el artículo no dice nada sobre el punto.`,
    )
  }
  const erratas = ERRATAS_VERIFICADAS.filter((e) => texto.includes(e))
  if (erratas.length) {
    avisos.push(
      `El texto se transcribe literalmente, tal como lo publica la fuente, sin corregir sus erratas ` +
        `(aparece ${erratas.map((e) => `«${e}»`).join(', ')}): si lo citas, cítalo así o advierte la errata.`,
    )
  }
  return avisos
}

// --- historial de cambios de un artículo ---------------------------------

export type Cambio = {
  accion: string
  /** Norma que introdujo el cambio, tal como la nombra la nota. */
  norma: string
  anio: string
  /** Artículo de la norma modificadora, si la nota lo dice. */
  articulo: string
  /** La nota completa, palabra por palabra. Es lo que hay que poder citar. */
  literal: string
}

const NORMA_CITADA =
  /\b(Ley|Decreto(?:\s+Ley)?|Resoluci[óo]n|Acuerdo|Circular|Acto\s+Legislativo)\s+(\d[\d.]*)\s+de\s+(\d{4})/i
const SENTENCIA_CITADA = /\b((?:C|T|SU|A)-\s?\d{1,4})\b/i

/**
 * El portal escribe sus notas de tres maneras, y el primer parser solo veía una.
 * El artículo 6 de la Ley 1221 de 2008 lleva las otras dos y por eso el
 * historial lo daba por intacto mientras el texto mostraba las reformas:
 *
 * - pasiva: `(Modificado por el art. 1 Decreto 666 de 2017)`
 * - activa entre paréntesis: `(Adiciona Art 54 numerales 13, 14,15 de la Ley 2466 de 2025)`
 * - control constitucional: `NOTA: Declarada inhibida por ineptitud sustantiva
 *   de la demanda (Numeral 1. ) Sentencia de la Corte Constitucional C-351 de 2013`
 *
 * Las dos formas nuevas exigen que la nota identifique la norma o la sentencia,
 * y la activa exige además ir entre paréntesis. Sin esas dos condiciones entra
 * la prosa del propio articulado —«las normas que la modifiquen o adicionen», o
 * el artículo de vigencias que dice qué deroga ESTA norma—, que apunta al revés:
 * diría que reformaron esta norma cuando es ella la que reforma a otra.
 */
const FORMAS = [
  {
    // La pasiva se acepta aunque la nota no diga qué norma cambió: "Derogado por
    // una norma que la nota no identifica" sigue siendo un cambio anotado.
    re: /(Modificad[oa]|Adicionad[oa]|Derogad[oa]|Sustituid[oa]|Subrogad[oa]|Compilad[oa]|Corregid[oa]|Reglamentad[oa])\s+por\s+([^\n)]{0,160})/gi,
    exigeReferencia: false,
  },
  { re: /\(\s*(Adiciona|Modifica|Deroga|Sustituye|Subroga|Corrige)\b([^)\n]{0,160})\)/gi, exigeReferencia: true },
  { re: /(Declarad[oa]s?)\b([^\n]{0,160})/gi, exigeReferencia: true },
] as const

/** Los verbos en activa se anotan en participio, como el resto. */
const PARTICIPIO: Record<string, string> = {
  adiciona: 'adicionado',
  modifica: 'modificado',
  deroga: 'derogado',
  sustituye: 'sustituido',
  subroga: 'subrogado',
  corrige: 'corregido',
}

/**
 * Reconstruye qué le pasó a un artículo a partir de las notas que el propio
 * portal incrusta en el texto ("Modificado por el Art. 1 del Decreto 226 de
 * 2026"). El Decreto 1083 trae 324.
 *
 * Se devuelve SIEMPRE la nota literal junto a los campos sueltos. La tentación
 * aquí es completar lo que la nota no dice; en materia legal eso convierte una
 * laguna en una afirmación falsa, así que lo que no consta va vacío y la nota
 * queda para que alguien la lea.
 *
 * ponytail: no se ordena cronológicamente ni se decide cuál cambio "gana". Las
 * notas no siempre traen fecha completa y encadenarlas exigiría interpretar;
 * se entregan en el orden en que aparecen, que es el del propio documento.
 */
export function historial(texto: string): Cambio[] {
  // Se recoge con la posición porque las tres formas se buscan en pasadas
  // distintas: sin reordenar, la respuesta dejaría de ir en el orden del
  // documento, que es lo único que se promete sobre la secuencia.
  const cambios: (Cambio & { pos: number })[] = []
  const vistos = new Set<string>()

  for (const { re, exigeReferencia } of FORMAS) {
    for (const m of texto.matchAll(re)) {
      const detalle = m[2] ?? ''
      const norma = detalle.match(NORMA_CITADA)
      const sentencia = detalle.match(SENTENCIA_CITADA)
      if (exigeReferencia && !norma && !sentencia) continue

      // La nota se lee hasta 160 caracteres. Cuando ahí se corta hay que
      // decirlo: una cita literal truncada en silencio se lee como completa.
      const literal =
        m[0].replace(/\s+/g, ' ').trim().replace(/[,.;]$/, '') + (detalle.length >= 160 ? '…' : '')
      if (vistos.has(literal)) continue // el portal repite la misma nota en varios apartes
      vistos.add(literal)

      const verbo = (m[1] ?? '').toLowerCase()
      cambios.push({
        pos: m.index,
        accion: PARTICIPIO[verbo] ?? verbo.replace(/a$/, 'o'),
        norma: norma ? `${norma[1]} ${norma[2]}` : sentencia ? `Sentencia ${sentencia[1]}` : '',
        // Sin norma citada, el año es el último que aparece en la nota: la Corte
        // se cita como "C-337 de fecha mayo 11 de 2011", con el año al final.
        anio: norma?.[3] ?? (sentencia ? (detalle.match(/\b((?:19|20)\d{2})\b(?![\s\S]*\b(?:19|20)\d{2}\b)/)?.[1] ?? '') : ''),
        articulo: detalle.match(/\bart[íi]?c?u?l?o?\.?\s*(\d+[\w.]*)/i)?.[1] ?? '',
        literal,
      })
    }
  }
  return cambios.sort((a, b) => a.pos - b.pos).map(({ pos: _pos, ...c }) => c)
}

// --- secciones de una providencia ----------------------------------------

/**
 * Una providencia no es un texto plano: es la mayoría, y después los votos
 * particulares de quienes no la comparten. Devolver un pasaje sin decir de cuál
 * de las dos sale es la vía directa a atribuirle a la Corte lo que dijo un
 * magistrado a título propio, y ese error no se ve: el texto es auténtico.
 *
 * Ocurrió, medido: en la SU-371/21, `buscar_en_texto: "instigar"` devuelve tres
 * pasajes, uno en las consideraciones (car. 142.092) y dos en la aclaración de
 * voto de la magistrada Ortiz Delgado (155.175 y 157.770), sin distinguirlos.
 * Se citaron los de la aclaración como doctrina de la Sala Plena.
 *
 * El encabezado tiene que ocupar su propio renglón y estar en mayúsculas. Sin
 * las dos condiciones, "Decisión frente a la cual presentó recurso…" —prosa a
 * mitad de la sentencia— pasaba por el encabezado de la decisión y devolvía el
 * trozo equivocado, que es el peor resultado posible: parece la respuesta.
 *
 * Los encabezados de voto se parten por renglones con frecuencia
 * ("ACLARACIÓN\nDE VOTO DEL MAGISTRADO", SU-371/21 car. 146.769), así que el
 * salto va contemplado dentro del patrón.
 *
 * Los mismos patrones sirven a la Corte Suprema y al Consejo de Estado, medido
 * el 2026-09-24 sobre doce providencias reales: el Consejo usa "II.
 * ANTECEDENTES", "V. CONSIDERACIONES", "FALLA"/"RESUELVE" y "ACLARACIÓN DE VOTO
 * DEL MAGISTRADO …" como la Corte; la Suprema escribe a veces el encabezado con
 * dos puntos ("RESUELVE:", "ANTECEDENTES Y CONSIDERACIONES:", casación penal
 * 22186 de 2004) o con apellido ("ANTECEDENTES RELEVANTES", ATP284-2021), y por
 * eso el cierre admite los dos puntos y el de antecedentes un resto de renglón.
 */
export const SECCIONES = {
  antecedentes: /\n[ \t]*(?:[IVX]+\.?[ \t]*)?ANTECEDENTES[^\n]{0,40}(?=\n)/,
  consideraciones: /\n[ \t]*(?:[IVX]+\.?[ \t]*)?CONSIDERACIONES[^\n]{0,40}(?=\n)/,
  decision: /\n[ \t]*(?:[IVX]+\.?[ \t]*)?(?:DECISI[ÓO]N|RESUELVE|FALLA)[ \t]*[.:]?[ \t]*(?=\n)/,
  salvamentos: /\n[ \t]*SALVAMENTO[ \t]*\n?[ \t]*(?:PARCIAL[ \t]*\n?[ \t]*)?DE[ \t]*\n?[ \t]*VOTO\b/,
  aclaraciones: /\n[ \t]*ACLARACI[ÓO]N[ \t]*\n?[ \t]*(?:PARCIAL[ \t]*\n?[ \t]*)?DE[ \t]*\n?[ \t]*VOTO\b/,
} as const

export type NombreSeccion = keyof typeof SECCIONES

/** Claves del mapa: las de SECCIONES más las dos que no nacen de un encabezado. */
export type ClaveTramo = NombreSeccion | 'encabezado' | 'notas'

/**
 * Rótulo que ve quien lee la respuesta. "consideraciones de la mayoría" y no
 * "consideraciones" a secas: el punto de todo esto es que se note de quién es
 * lo que se está leyendo.
 */
export const ROTULO_SECCION: Record<ClaveTramo, string> = {
  encabezado: 'encabezado de la relatoría (tema y síntesis)',
  antecedentes: 'antecedentes',
  consideraciones: 'consideraciones de la mayoría',
  decision: 'decisión',
  salvamentos: 'salvamento de voto',
  aclaraciones: 'aclaración de voto',
  notas: 'notas al pie',
}

/**
 * Lo que precede al primer encabezado. En la Corte Constitucional es el bloque
 * que añade su relatoría (tema y síntesis); en la Suprema y el Consejo de Estado
 * no hay relatoría delante, es la identificación del proceso y de las partes, y
 * llamarlo "síntesis de la relatoría" sería rotularlo mal.
 */
export const ENCABEZADO_PROVIDENCIA = 'encabezado de la providencia (corporación, partes y proceso)'

export type Tramo = { clave: ClaveTramo; etiqueta: string; quien: string; desde: number; hasta: number }

const NOMBRE_FIRMANTE = /^[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'’.\- ]*(?:\s+(?:Y|E)\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'’.\- ]*)*$/
const FIN_DEL_FIRMANTE = /\bA\s+LA\s+(?:SENTENCIA|PROVIDENCIA|ACLARACI|SALVAMENTO)|\bREFERENCIA\b|\bEXPEDIENTE\b|\bM\.?\s*P\.?\b/i

/**
 * Quién suscribe el voto. Degrada a cadena vacía sin romper nada: saber que un
 * pasaje es de un voto particular ya evita el error de atribución; el nombre es
 * precisión añadida, no el requisito.
 */
function firmanteDelVoto(texto: string, desde: number): string {
  const cola = texto.slice(desde, desde + 400)
  const m = cola.match(/\b(?:DE\s+LA[S]?\s+MAGISTRAD[AO][S]?|DE\s+LOS\s+MAGISTRADOS|DEL\s+MAGISTRAD[AO])\b/i)
  if (!m || m.index === undefined) return firmanteBajoElEncabezado(cola)
  let resto = cola.slice(m.index + m[0].length).replace(/^\s*PONENTE\b/i, '')
  const corte = resto.search(FIN_DEL_FIRMANTE)
  if (corte >= 0) resto = resto.slice(0, corte)
  const lineas: string[] = []
  for (const linea of resto.split('\n').map((x) => x.trim())) {
    // Un voto conjunto separa los nombres con "Y" y un renglón en blanco
    // (SU-020/22): parar en el blanco perdía al segundo firmante.
    if (!linea) {
      if (lineas.length && !/\s(?:Y|E)$/i.test(lineas.at(-1)!)) break
      continue
    }
    // Los nombres van en versal. El primer renglón con minúscula ya es otra
    // cosa: el tema de la relatoría o la prosa del voto.
    if (/[a-záéíóúñü]/.test(linea)) break
    lineas.push(linea)
  }
  const nombre = lineas.join(' ').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').replace(/\s+(?:Y|E)$/i, '').trim()
  return nombre.length >= 6 && nombre.length <= 90 && NOMBRE_FIRMANTE.test(nombre) ? nombre : ''
}

/**
 * La forma de la Corte Suprema: el nombre en versal en el renglón siguiente al
 * encabezado y "Magistrado …" debajo ("ACLARACIÓN DE VOTO\n\nFERNANDO CASTILLO
 * CADENA\n\nMagistrado ponente", SL4068-2022). Se exigen las dos cosas: sin el
 * "Magistrado" debajo, el renglón en versal puede ser una parte o un radicado.
 */
function firmanteBajoElEncabezado(cola: string): string {
  // [0] es el encabezado del voto; [1], el nombre; [2], "Magistrado …".
  const renglones = cola
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  const [primero, segundo] = [renglones[1] ?? '', renglones[2] ?? '']
  return /^Magistrad[oa]\b/i.test(segundo) && primero.length >= 6 && primero.length <= 90 && NOMBRE_FIRMANTE.test(primero)
    ? primero
    : ''
}

/**
 * Dónde empieza el aparato de notas al pie. Es el último "[1]" a renglón propio
 * del último 40 % del documento, y solo si le siguen al menos cinco llamadas
 * más: sin las dos condiciones, un "[1]" de referencia dentro del cuerpo se
 * llevaría media providencia. En la T-015/22 son 34.436 caracteres que hoy
 * viajan rotulados como "decisión".
 */
function inicioDeNotas(texto: string): number | null {
  const marcas = [...texto.matchAll(/\n\[1\][ \n]/g)].map((m) => m.index).filter((i) => i > texto.length * 0.6)
  if (!marcas.length) return null
  const p = marcas.at(-1)!
  const siguientes = (texto.slice(p).match(/\n\[\d{1,4}\][ \n]/g) ?? []).length
  return siguientes >= 5 ? p : null
}

/**
 * Estructura completa de la providencia, en orden y sin huecos: cada carácter
 * del documento pertenece a exactamente un tramo. Es la base tanto de `seccion`
 * como del rotulado de pasajes.
 */
export function mapaDeSecciones(texto: string, encabezado = ROTULO_SECCION.encabezado): Tramo[] {
  const marcas: { clave: NombreSeccion; desde: number }[] = []
  for (const clave of Object.keys(SECCIONES) as NombreSeccion[]) {
    const re = new RegExp(SECCIONES[clave].source, 'g')
    for (const m of texto.matchAll(re)) if (m.index !== undefined) marcas.push({ clave, desde: m.index })
  }
  marcas.sort((a, b) => a.desde - b.desde)

  const tramos: Tramo[] = []
  for (const marca of marcas) {
    const ultimo = tramos.at(-1)
    // Tras "III. DECISIÓN" viene "RESUELVE", que es su continuación y no otra
    // sección. Los votos sí se repiten: cada uno es su propio tramo.
    const repetible = marca.clave === 'salvamentos' || marca.clave === 'aclaraciones'
    if (ultimo && ultimo.clave === marca.clave && !repetible) continue
    const quien = repetible ? firmanteDelVoto(texto, marca.desde) : ''
    tramos.push({
      clave: marca.clave,
      quien,
      etiqueta: quien ? `${ROTULO_SECCION[marca.clave]} — ${quien}` : ROTULO_SECCION[marca.clave],
      desde: marca.desde,
      hasta: texto.length,
    })
  }

  if (!tramos.length) {
    return [{ clave: 'encabezado', etiqueta: encabezado, quien: '', desde: 0, hasta: texto.length }]
  }
  if (tramos[0]!.desde > 0) {
    tramos.unshift({ clave: 'encabezado', etiqueta: encabezado, quien: '', desde: 0, hasta: tramos[0]!.desde })
  }

  const notas = inicioDeNotas(texto)
  if (notas !== null) {
    while (tramos.length > 1 && tramos.at(-1)!.desde >= notas) tramos.pop()
    if (notas > tramos.at(-1)!.desde) {
      tramos.push({ clave: 'notas', etiqueta: ROTULO_SECCION.notas, quien: '', desde: notas, hasta: texto.length })
    }
  }

  for (let i = 0; i < tramos.length - 1; i++) tramos[i]!.hasta = tramos[i + 1]!.desde
  return tramos
}

/** A qué tramo pertenece una posición del documento. */
export function etiquetaEn(mapa: Tramo[], pos: number): string {
  return (mapa.find((t) => pos >= t.desde && pos < t.hasta) ?? mapa.at(-1)!).etiqueta
}

/**
 * Devuelve la sección pedida. Los votos particulares se concatenan todos, cada
 * uno bajo su rótulo, porque "dame las aclaraciones" quiere decir todas.
 */
export function seccion(texto: string, cual: ClaveTramo, encabezado?: string): string | null {
  const partes = mapaDeSecciones(texto, encabezado).filter((t) => t.clave === cual)
  if (!partes.length) return null
  return partes.map((t) => `--- ${t.etiqueta} ---\n${texto.slice(t.desde, t.hasta).trim()}`).join('\n\n').trim()
}

/** Qué secciones trae el documento, para poder ofrecerlas. */
export const seccionesPresentes = (texto: string): ClaveTramo[] => [
  ...new Set(mapaDeSecciones(texto).map((t) => t.clave)),
]

// --- documentos sin texto extraíble --------------------------------------

/**
 * Un PDF sin fuentes incrustadas cuyas páginas son imágenes es un escaneo: no
 * hay texto que extraer, por mucho que el documento diga cosas.
 *
 * ponytail: se decide por marcadores, sin decodificar los flujos. El techo es
 * un PDF que use solo las 14 fuentes estándar sin incrustarlas; si aparece uno,
 * el salto siguiente es OCR, no un parser mejor.
 */
export function pdfEsEscaneo(pdf: string): boolean {
  if (!pdf.includes('%PDF')) return false
  return !/\/FontFile\d?\b/.test(pdf) && /\/(DCTDecode|CCITTFaxDecode|JPXDecode|JBIG2Decode)\b/.test(pdf)
}

/**
 * Ningún documento vacío se devuelve a secas. "No hay texto" y "el documento no
 * dice nada" son cosas distintas, y confundirlas es el error caro: quien
 * pregunta por una sentencia escaneada no puede concluir que no resolvió nada.
 */
export function avisoSinTexto(caracteres: number, url: string, escaneo = false): string {
  return escaneo
    ? 'Este documento es un ESCANEO: sus páginas son imágenes, no texto. Esta extensión no hace OCR, así que ' +
        `no se puede leer su contenido aquí — pero eso NO significa que el documento no diga nada. Consúltalo en ${url}`
    : `El documento está registrado pero no trae texto publicado (se recibieron ${caracteres} caracteres). ` +
        `NO significa que no diga nada: consúltalo en ${url}`
}

// --- parsers del Gestor Normativo ----------------------------------------

export type Resultado = { id: string; titulo: string; resumen: string; url: string }

/**
 * Enlaces a normas de cualquier listado del portal (resultados, normas FP…).
 *
 * `termino` sirve para elegir el resumen: una norma puede traer varios
 * restrictores y el portal no ordena por pertinencia, así que al buscar
 * "teletrabajo" el Decreto 1083 salía resumido como "estándares para la
 * elección de personeros". Se prefiere el fragmento que menciona lo buscado.
 */
export function enlacesDeNormas(html: string, termino = ''): Resultado[] {
  const $ = cargar(html)
  const aguja = sinTildes(termino).toLowerCase().trim()
  const vistos = new Set<string>()

  return $('a[href*="norma.php?i="]')
    .map((_, el) => {
      const $a = $(el)
      const id = ($a.attr('href') ?? '').replace(/\D/g, '')

      const partes = $a
        .find('li')
        .map((__, li) => $(li).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean)
      const parrafos = partes.length
        ? partes
        : $a
            .find('p')
            .map((__, p) => $(p).text().replace(/\s+/g, ' ').trim())
            .get()
            .filter(Boolean)

      const pertinente = aguja ? parrafos.find((t) => sinTildes(t).toLowerCase().includes(aguja)) : undefined
      const resumen = pertinente ?? parrafos.join(' ')

      // Sin <h5> el título y el resumen quedan pegados ("Ley 87 de 1993Establece…").
      let titulo = $a.find('h5').text().replace(/\s+/g, ' ').trim()
      if (!titulo) {
        const todo = $a.text().replace(/\s+/g, ' ').trim()
        titulo = (resumen && todo.endsWith(resumen) ? todo.slice(0, -resumen.length) : todo).trim()
      }

      return { id, titulo, resumen, url: `${BASE_GESTOR}/norma.php?i=${id}` }
    })
    .get()
    .filter((r) => {
      if (!r.id || vistos.has(r.id)) return false // los listados repiten normas
      vistos.add(r.id)
      return true
    })
}

export function parseResultados(html: string, termino = ''): { total: number; items: Resultado[] } {
  const m = html.match(/encontrados:\s*(\d+)/i)
  if (!m) throw new CanarioError('no aparece "Número de documentos encontrados"')
  const total = Number(m[1])
  const items = enlacesDeNormas(html, termino)
  if (total > 0 && items.length === 0) throw new CanarioError('hay resultados pero ningún enlace de norma')
  return { total, items }
}

export type Norma = {
  id: string
  titulo: string
  fechas: Record<string, string>
  temas: { tema: string; subtema: string; restrictor: string }[]
  texto: string
  url: string
  urlPdf: string
}

export function parseNorma(html: string, id: string): Norma {
  const $ = cargar(html)
  const titulo = $('h2.titulo-norma').text().trim()
  if (!titulo) throw new CanarioError('no se encontró h2.titulo-norma')

  const fechas: Record<string, string> = {}
  $('#collapseOne p').each((_, el) => {
    const t = $(el).text().trim()
    const i = t.indexOf(':')
    if (i > 0) fechas[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  })

  const temas: Norma['temas'] = []
  let tema = ''
  let subtema = ''
  $('#collapseTwo').find('h5,h6,p').each((_, el) => {
    const $e = $(el)
    const t = $e.text().replace(/\s+/g, ' ').trim()
    if (!t) return
    if (el.tagName === 'h5') tema = t
    else if (el.tagName === 'h6') subtema = t.replace(/^-\s*Subtema:\s*/i, '')
    else temas.push({ tema, subtema, restrictor: t })
  })

  return {
    id,
    titulo,
    fechas,
    temas,
    // `.descripcion-contenido` deja fuera el aviso legal del portal, que va en
    // un `.alert` hermano; `col-lg-9` es el respaldo si el portal lo quita.
    texto: textoDe($, 'div.descripcion-contenido') || textoDe($, 'div.col-lg-9'),
    url: `${BASE_GESTOR}/norma.php?i=${id}`,
    urlPdf: `${BASE_GESTOR}/norma_pdf.php?i=${id}`,
  }
}

export function parseOpciones(html: string, idSelect: string): { id: string; nombre: string }[] {
  const $ = cheerio.load(html)
  const $sel = $(`#${idSelect}`)
  if (!$sel.length) throw new CanarioError(`no existe el select #${idSelect} en la consulta avanzada`)
  return $sel
    .find('option')
    .map((_, el) => ({ id: ($(el).attr('value') ?? '').trim(), nombre: $(el).text().trim() }))
    .get()
    .filter((o) => o.id && o.nombre)
}

export type FilaTema = { tema: string; subtema: string; temsubid: string; documentos: { normid: string; titulo: string }[] }

/**
 * La consulta temática enlaza cada norma con `info_restrictor('tema','subtema','titulo',temsubid,normid)`.
 * Los nombres de tema traen comillas y comas, así que solo se leen los dos números
 * del final — intentar separar los argumentos por coma rompe con temas como
 * `1) MUJERES 2) CONSEJERÍA...`.
 */
export function parseTematica(html: string): FilaTema[] {
  const $ = cargar(html)
  const filas: FilaTema[] = []

  $('h3').each((_, h3) => {
    const tema = $(h3).text().trim()
    $(h3)
      .nextAll()
      // `tr` a secas, no `tbody tr`: htmlparser2 no inserta el tbody implícito
      // que sí añade un parser conforme a la especificación, y el día que el
      // portal omita la etiqueta la tabla se leería vacía sin avisar.
      .find('tr')
      .each((__, tr) => {
        const $tds = $(tr).find('td')
        if ($tds.length < 2) return
        const subtema = $tds.eq(0).text().replace(/\s+/g, ' ').trim()
        const docs: { normid: string; titulo: string }[] = []
        let temsubid = ''
        $(tr)
          .find('a[onclick*="info_restrictor"]')
          .each((___, a) => {
            const oc = $(a).attr('onclick') ?? ''
            const ids = oc.match(/,\s*(\d+)\s*,\s*(\d+)\s*\)\s*$/)
            if (!ids) return
            temsubid = ids[1]!
            docs.push({ normid: ids[2]!, titulo: $(a).text().trim() })
          })
        if (docs.length) filas.push({ tema, subtema, temsubid, documentos: docs })
      })
  })

  return filas
}
