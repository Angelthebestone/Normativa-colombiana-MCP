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
import { sinTildes } from './parse.ts'

export type ClaseVacancia =
  | 'inmediata'
  | 'fecha-fija'
  | 'relativa'
  | 'escalonada'
  | 'no-determinada'
  | 'no-encontrada'

export type Vacancia = {
  /** El artículo analizado, con su número y texto literal (recortado a lo necesario). */
  articulo: { numero: string; texto: string }
  clase: ClaseVacancia
  /** ISO AAAA-MM-DD; solo con `fecha-fija` (o `relativa` con fecha de publicación conocida). */
  desde?: string
  /** Frase lista para la respuesta, en prosa prudente. */
  resumen: string
}

// --- fechas: números en letras, meses y aritmética -------------------------

const UNIDADES: Record<string, number> = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
}
const PALABRAS_NUMERO = Object.keys(UNIDADES).join('|')

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}
const MES_TXT = Object.keys(MESES).join('|')
const MESES_NOMBRE = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «seis», «veinticuatro», «dos mil doce», «mil novecientos noventa y tres». */
function numeroEnLetras(frase: string): number | null {
  const palabras = sinTildes(frase)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p && p !== 'y')
  if (!palabras.length) return null
  let total = 0
  let actual = 0
  for (const p of palabras) {
    if (p === 'mil') {
      total += (actual || 1) * 1000
      actual = 0
      continue
    }
    const v = UNIDADES[p]
    if (v === undefined) return null
    actual += v
  }
  return total + actual
}

/** Día dicho de cualquiera de las formas medidas: «1», «01», «1o.», «dos (2)», «primero (1)». */
function numeroDeTexto(txt: string): number | null {
  const par = txt.match(/\(\s*(\d{1,2})\s*\)/)
  if (par) return Number(par[1])
  const dig = txt.trim().match(/^(\d{1,2})/)
  if (dig) return Number(dig[1])
  return numeroEnLetras(txt)
}

function isoValido(anio: number, mes: number, dia: number): string | null {
  if (anio < 1800 || anio > 2200 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

const fechaLarga = (iso: string): string => {
  const [a, m, d] = iso.split('-') as [string, string, string]
  return `${Number(d)} de ${MESES_NOMBRE[Number(m) - 1]} de ${a}`
}

type Fecha = { iso: string; inicio: number; fin: number }

const RE_MES = new RegExp(String.raw`\bde\s+(${MES_TXT})\b`, 'gi')
const RE_DIA = /((?:\d{1,2}\s*[°ºo]?\.?)|(?:[a-záéíóúñ]+(?:\s+y\s+[a-záéíóúñ]+)?(?:\s*\(\s*\d{1,2}\s*\))?))[^a-záéíóúñ0-9]*$/i

/** El año que sigue a «<mes>»: en dígitos o en letras, y cuánto texto consumió. */
function anioTras(cola: string): { anio: number; largo: number } | null {
  const salto = cola.match(/^\s*(?:,\s*|de(?:l)?(?:\s+ano)?\s*)/i)?.[0].length ?? 0
  const resto = cola.slice(salto)
  const dig = resto.match(/^(\d{4})\b/)
  if (dig) return { anio: Number(dig[1]), largo: salto + dig[0].length }
  const piezas = resto.split(/\s+/)
  for (let k = Math.min(5, piezas.length); k >= 1; k--) {
    const usado = piezas.slice(0, k).join(' ')
    const n = numeroEnLetras(usado)
    if (n !== null && n >= 1800 && n <= 2200) return { anio: n, largo: salto + usado.length }
  }
  return null
}

/**
 * Primera fecha absoluta del trozo: «29 de julio de 2016», «el dos (2) de julio
 * del año 2012», «el primero (1) de enero de dos mil catorce (2014)».
 */
function buscarFecha(trozo: string): Fecha | null {
  for (const m of trozo.matchAll(RE_MES)) {
    const mes = MESES[m[1]!.toLowerCase()]
    if (mes === undefined) continue
    const i = m.index!
    const base = Math.max(0, i - 44)
    const dm = trozo.slice(base, i).match(RE_DIA)
    if (!dm || dm.index === undefined) continue
    const dia = numeroDeTexto(dm[1]!)
    if (dia === null) continue
    const anio = anioTras(trozo.slice(i + m[0].length, i + m[0].length + 70))
    if (anio === null) continue
    const iso = isoValido(anio.anio, mes, dia)
    if (!iso) continue
    return { iso, inicio: base + dm.index, fin: i + m[0].length + anio.largo }
  }
  return null
}

function sumarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number]
  const total = m - 1 + meses
  const anio = a + Math.floor(total / 12)
  const mes = ((total % 12) + 12) % 12 + 1
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return `${anio}-${String(mes).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}

function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number]
  const t = new Date(Date.UTC(a, m - 1, d + dias))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

const hoyISO = (hoy: Date): string =>
  `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`

// --- localizar el artículo de vigencia -------------------------------------

type Articulo = { numero: string; desde: number; hasta: number; titulo: string }

/** Los artículos del texto por su encabezado a renglón propio, igual que parse.ts. */
function partirEnArticulos(plano: string): Articulo[] {
  const marcas: { numero: string; desde: number; fin: number }[] = []
  for (const m of plano.matchAll(/(?:^|\n)[ \t]*(?:ARTICULO|Articulo)\s+(\d[\d.]*(?:-\d+)?[A-Za-z]?)\s*[°º]?[.:]?[ \t]*/gi)) {
    marcas.push({ numero: m[1]!, desde: m.index!, fin: m.index! + m[0].length })
  }
  return marcas.map((mk, i) => {
    const hasta = marcas[i + 1]?.desde ?? plano.length
    const cabecera = plano.slice(mk.fin, Math.min(mk.fin + 90, hasta))
    const corte = cabecera.search(/[.\n]/)
    const titulo = (corte >= 0 ? cabecera.slice(0, corte) : cabecera).replace(/\s+/g, ' ').trim()
    return { numero: mk.numero.replace(/\.+$/, ''), desde: mk.desde, hasta, titulo }
  })
}

const normalizar = (s: string): string => sinTildes(s).toLowerCase().replace(/[.,;:]+$/, '').replace(/\s+/g, ' ').trim()

/**
 * Título que anuncia la cláusula de vigencia. La palabra tiene que cerrar el
 * título: así quedan fuera «VIGENCIA FONDOS ELÉCTRICOS», «VIGENCIAS FUTURAS DE
 * LA NACIÓN…» (Ley 1955) y «Vigencia del Sistema General de Pensiones»
 * (Ley 100), que llevan la palabra pero no son la entrada en vigor de la norma.
 */
const esTituloDeVigencia = (titulo: string): boolean => {
  const t = normalizar(titulo)
  return (
    /^(?:la\s+)?(?:entrada\s+en\s+)?vigencia?s?$/.test(t) ||
    /^vigencias?\s+(?:y|e)\s+derogatorias?$/.test(t) ||
    /^derogatorias?\s+(?:y|e)\s+vigencias?$/.test(t) ||
    /(?:^|\s)y\s+vigencias?$/.test(t)
  )
}

/**
 * Entrada en vigor de la propia norma dicha en prosa, sin título que la anuncie.
 * El sujeto tiene que ser la norma misma y empezar oración: «El presente Código
 * comenzará a regir el dos (2) de julio del año 2012». Sin esa exigencia, un
 * parágrafo que diga «el reglamento entrará en vigencia seis meses después» o
 * «lo dispuesto en el presente artículo entrará en vigencia…» pasaría por la
 * cláusula de la ley.
 */
const VERBO_ENTRADA =
  String.raw`(?:rige|rigen|regir(?:a|an|e|en|ia|ian)?|entrar(?:a|an|on)?\s+(?:en\s+vigor|en\s+vigencia|a\s+regir)|entra(?:n)?\s+(?:en\s+vigor|en\s+vigencia|a\s+regir)|(?:empezar|comenzar|principiar)(?:a|an|o|on)?\s+a\s+regir)`

/** Los sujetos genéricos no aportan nada al enumerar: «la presente ley, desde su publicación». */
const SUJETO_GENERICO =
  /^(?:la presente ley|esta ley|el presente codigo|el presente decreto|el presente acto legislativo|el presente estatuto|la presente resolucion|el presente acuerdo|la presente ordenanza|el presente reglamento)$/i

const RE_FORMULA_PROPIA = new RegExp(
  String.raw`(?:^|[\n.;:”"'’]\s*)(?:la\s+presente\s+ley|esta\s+ley|el\s+presente\s+codigo|el\s+presente\s+decreto|el\s+presente\s+acto\s+legislativo|el\s+presente\s+estatuto|la\s+presente\s+resolucion|el\s+presente\s+acuerdo|la\s+presente\s+ordenanza|el\s+presente\s+reglamento)\s[^.;:]{0,140}?\b${VERBO_ENTRADA}\b`,
  'i',
)

const RE_VERBO_VIGENCIA = new RegExp(String.raw`\b${VERBO_ENTRADA}\b`, 'gi')

/** «su publicación», «la promulgación»: el ancla de la que cuelga la entrada en vigor. */
const ANCLA: Record<string, string> = {
  publicacion: 'la publicación',
  promulgacion: 'la promulgación',
  sancion: 'la sanción',
  expedicion: 'la expedición',
}

const RE_INMEDIATA = /(su|la)\s+(publicacion|promulgacion|sancion|expedicion)/i
const RE_RELATIVA = new RegExp(
  String.raw`(?:\((\d{1,3})\)|(\d{1,3})|(${PALABRAS_NUMERO}))\s*(?:\((\d{1,3})\)\s*)?(mes(?:es)?|anos?|dias?)\s*(?:despues\s+de|siguientes?(?:\s+(?:a|al|de))?|contados?\s+a\s+partir\s+de|de)\s+(?:su\s+|la\s+|el\s+)?(publicacion|promulgacion|sancion|expedicion|entrada\s+en\s+vigencia)`,
  'i',
)

/** Lo que frena una fecha: no es entrada en vigor sino un vencimiento. */
const RE_VENCIMIENTO = /(?:hasta|antes\s+de(?:l)?|a\s+mas\s+tardar)\s*(?:el\s+|la\s+|los\s+|las\s+)?$/i

type Clausula = {
  tipo: 'inmediata' | 'fecha' | 'relativa'
  /** ISO, solo en `fecha`. */
  iso?: string
  /** Plazo en meses (los años se convierten) o en días, solo en `relativa`. */
  plazo?: number
  unidad?: 'meses' | 'dias'
  /** «su publicación»: de dónde cuelga la entrada en vigor. */
  ancla: string
  /** Sujeto que encabeza la cláusula, si se pudo aislar. */
  sujeto: string
  /** Cita literal de la cláusula, desde el verbo. */
  cita: string
}

/** El sujeto que precede al verbo, si es un sintagma limpio y corto. */
function sujetoAntes(texto: string, verbo: number): string {
  const corte = Math.max(
    texto.lastIndexOf('.', verbo - 1),
    texto.lastIndexOf(';', verbo - 1),
    texto.lastIndexOf('\n', verbo - 1),
  )
  const trozo = texto.slice(corte + 1, verbo).replace(/\s+/g, ' ').trim().replace(/[,;:.]+$/, '')
  if (trozo.length < 8 || trozo.length > 130 || SUJETO_GENERICO.test(sinTildes(trozo))) return ''
  return /^(?:El|La|Los|Las|Lo)\s/.test(trozo) ? trozo : ''
}

/** Las determinaciones de entrada en vigor que contiene el artículo de vigencia. */
function clausulasDe(plano: string, texto: string): Clausula[] {
  const clausulas: Clausula[] = []
  const cita = (a: number, b: number): string => texto.slice(a, b).replace(/\s+/g, ' ').trim()
  for (const v of plano.matchAll(RE_VERBO_VIGENCIA)) {
    const ini = v.index!
    if (/\bse\s+$/i.test(plano.slice(Math.max(0, ini - 3), ini))) continue // «se regirá por…» remite, no fecha
    const tras = ini + v[0].length
    // ponytail: la determinación se busca en los 280 caracteres que siguen al
    // verbo, que es donde cae en todo lo medido (la más lejana, «rige a partir
    // del primero (1) de noviembre de 2023» precedida del nombre del impuesto,
    // cabe en ~230). Techo: una cláusula que enumere dos párrafos entre el verbo
    // y su fecha; el salto sería analizar por oración, no por ventana.
    const ventana = plano.slice(tras, tras + 280)
    const rel = ventana.match(RE_RELATIVA)
    const inm = ventana.match(RE_INMEDIATA)
    const fec = buscarFecha(ventana)
    // Gana lo que el texto pone primero después del verbo: en «rige desde su
    // publicación, salvo el artículo 5, que rige desde el 1 de enero de 2026»
    // cada verbo se queda con su propia determinación.
    const opciones: { pos: number; c: Clausula }[] = []
    if (rel && rel.index !== undefined) {
      const n = Number(rel[1] ?? rel[2] ?? '') || numeroEnLetras(rel[3] ?? '') || Number(rel[4] ?? '')
      const palabra = rel[5] ?? ''
      const esAnio = palabra.startsWith('ano')
      if (n > 0) {
        opciones.push({
          pos: rel.index,
          c: {
            tipo: 'relativa',
            plazo: esAnio ? n * 12 : n,
            unidad: palabra.startsWith('dia') ? 'dias' : 'meses',
            ancla: `su ${rel[6] ?? ''}`,
            sujeto: sujetoAntes(texto, ini),
            cita: cita(ini, tras + rel.index + rel[0].length),
          },
        })
      }
    }
    if (inm && inm.index !== undefined) {
      opciones.push({
        pos: inm.index,
        c: {
          tipo: 'inmediata',
          ancla: ANCLA[inm[2]!] ?? 'su publicación',
          sujeto: sujetoAntes(texto, ini),
          cita: cita(ini, tras + inm.index + inm[0].length),
        },
      })
    }
    if (fec && !RE_VENCIMIENTO.test(ventana.slice(Math.max(0, fec.inicio - 40), fec.inicio))) {
      opciones.push({
        pos: fec.inicio,
        c: {
          tipo: 'fecha',
          iso: fec.iso,
          ancla: fechaLarga(fec.iso),
          sujeto: sujetoAntes(texto, ini),
          cita: cita(ini, tras + fec.fin),
        },
      })
    }
    if (opciones.length) clausulas.push(opciones.sort((a, b) => a.pos - b.pos)[0]!.c)
  }
  return clausulas
}

/** La nota del portal con la que algunas normas cierran: «NOTA: Publicada en el Diario Oficial 47.956 de enero 18 de 2011». */
function publicacionEnNota(plano: string): string | null {
  for (const m of plano.matchAll(/nota:\s*publicad[oa]\s+en\s+el\s+diario\s+oficial[^\n]{0,140}/gi)) {
    const f = buscarFecha(m[0])
    if (f) return f.iso
    // «Diario Oficial 48489 de julio 12 de 2012»: día y mes al revés.
    const r = m[0].match(new RegExp(String.raw`\b(${MES_TXT})\s+(\d{1,2})\s+de\s+(\d{4})`, 'i'))
    const iso = r ? isoValido(Number(r[3]), MESES[r[1]!.toLowerCase()]!, Number(r[2])) : null
    if (iso) return iso
  }
  return null
}

const isoCanonico = (s: string | undefined): string | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim())
  return m ? (isoValido(Number(m[1]), Number(m[2]), Number(m[3])) ?? undefined) : undefined
}

// --- análisis --------------------------------------------------------------

const RECORTE = 1400

export function analizarVacancia(texto: string, opciones: { publicacion?: string; hoy?: Date } = {}): Vacancia {
  const hoy = opciones.hoy ?? new Date()
  const plano = sinTildes(texto)
  const recorta = (s: string): string => {
    const t = s.length > RECORTE ? `${s.slice(0, RECORTE)}…` : s
    return t.replace(/\n{3,}/g, '\n\n').trim()
  }

  const candidatos = partirEnArticulos(plano)
    .map((a) => ({ ...a, plano: plano.slice(a.desde, a.hasta) }))
    .filter((a) => esTituloDeVigencia(a.titulo) || RE_FORMULA_PROPIA.test(a.plano))
    .map((a) => ({ ...a, clausulas: clausulasDe(a.plano, texto.slice(a.desde, a.hasta)) }))

  if (!candidatos.length) {
    return {
      articulo: { numero: '', texto: '' },
      clase: 'no-encontrada',
      resumen:
        'No se encontró un artículo de vigencia en el texto analizado. Puede venir recortado o usar una fórmula que ' +
        'este análisis no reconoce, así que la ausencia NO significa que la norma no tenga reglas de entrada en vigor: ' +
        'consulta el texto completo de la norma.',
    }
  }

  const elegido = [...candidatos].reverse().find((a) => a.clausulas.length) ?? candidatos.at(-1)!
  const todas = candidatos.flatMap((a) => a.clausulas)
  const base = { articulo: { numero: elegido.numero, texto: recorta(texto.slice(elegido.desde, elegido.hasta)) } }

  if (!todas.length) {
    const cita = recorta(texto.slice(elegido.desde, Math.min(elegido.hasta, elegido.desde + 600)).replace(/\s+/g, ' '))
    return {
      ...base,
      clase: 'no-determinada',
      resumen:
        `Hay artículo de vigencia (artículo ${elegido.numero}), pero de su texto no se desprende una fecha cierta ` +
        `—puede remitir a otra norma o depender de un hecho—. Se cita literal: «${cita}».`,
    }
  }

  const conClausulas = candidatos.filter((a) => a.clausulas.length)
  const fechas = [...new Set(todas.filter((c) => c.tipo === 'fecha').map((c) => c.iso!))]
  const relativas = todas.filter((c) => c.tipo === 'relativa')
  const inmediata = todas.find((c) => c.tipo === 'inmediata')
  const determinaciones = (inmediata ? 1 : 0) + fechas.length + new Set(relativas.map((c) => `${c.plazo} ${c.unidad}`)).size

  const deOpciones = isoCanonico(opciones.publicacion)
  const publicacion = deOpciones ?? publicacionEnNota(plano)
  const deLaNota = deOpciones === undefined && publicacion !== null

  if (determinaciones === 1 && inmediata) {
    return {
      ...base,
      clase: 'inmediata',
      resumen:
        `Su artículo de vigencia (artículo ${elegido.numero}) dice que rige desde ${inmediata.ancla}: no hay entrada ` +
        'en vigor diferida, así que la norma quedó exigible desde ese momento y no está en vacancia.',
    }
  }

  if (determinaciones === 1 && fechas.length === 1) {
    const desde = fechas[0]!
    const c = todas.find((x) => x.tipo === 'fecha')!
    const llego = hoyISO(hoy) >= desde
    return {
      ...base,
      clase: 'fecha-fija',
      desde,
      resumen:
        `Su artículo de vigencia (artículo ${elegido.numero}) fija un día, no un plazo: «${c.cita}». ` +
        (llego
          ? `Esa fecha ya llegó, así que rige desde el ${fechaLarga(desde)}.`
          : `Todavía no rige: entra a regir el ${fechaLarga(desde)}.`),
    }
  }

  if (determinaciones === 1 && relativas.length === 1) {
    const c = relativas[0]!
    if (!publicacion) {
      return {
        ...base,
        clase: 'relativa',
        resumen:
          `Su artículo de vigencia (artículo ${elegido.numero}) no fija un día, sino un plazo: «${c.cita}». ` +
          'Falta la fecha de publicación para calcularlo, así que la fecha de exigibilidad queda indeterminada: ' +
          'búscala en la ficha de la norma (campo «Medio de Publicación») o en la nota del Diario Oficial al final ' +
          'del texto, y repite el análisis con ella.',
      }
    }
    const desde = c.unidad === 'dias' ? sumarDias(publicacion, c.plazo!) : sumarMeses(publicacion, c.plazo!)
    const llego = hoyISO(hoy) >= desde
    return {
      ...base,
      clase: 'relativa',
      desde,
      resumen:
        `Su artículo de vigencia (artículo ${elegido.numero}) no fija un día, sino un plazo: «${c.cita}». ` +
        `Contado desde la publicación (${fechaLarga(publicacion)}${deLaNota ? ', fecha que trae la nota del Diario Oficial al final del texto' : ''}), ` +
        `rige desde el ${fechaLarga(desde)}. ` +
        (llego ? 'Esa fecha ya llegó.' : 'Todavía no rige: su exigibilidad empieza ese día.'),
    }
  }

  const variosArticulos = conClausulas.length > 1
  const numeroDe = (c: Clausula): string => (variosArticulos ? ` (artículo ${conClausulas.find((a) => a.clausulas.includes(c))!.numero})` : '')
  // Una determinación se enumera una vez: dos apartes que fijan la misma fecha
  // (los dos impuestos saludables de la Ley 2277) no son dos tramos.
  const clave = (c: Clausula): string =>
    c.tipo === 'inmediata' ? 'inmediata' : c.tipo === 'fecha' ? `fecha:${c.iso}` : `relativa:${c.plazo}:${c.unidad}`
  const items = todas
    .filter((c, i) => todas.findIndex((x) => clave(x) === clave(c)) === i)
    .map((c) => {
      const con = c.sujeto ? `${c.sujeto}, ` : ''
      if (c.tipo === 'inmediata') return `${con}desde ${c.ancla}${numeroDe(c)}`
      if (c.tipo === 'fecha') return `${con}a partir del ${fechaLarga(c.iso!)}${numeroDe(c)}`
      return `${con}${c.cita}${publicacion ? ` (contado desde la publicación, ${fechaLarga(publicacion)})` : ' (falta la fecha de publicación para calcularlo)'}${numeroDe(c)}`
    })
  return {
    ...base,
    clase: 'escalonada',
    resumen:
      `No entra en vigor en un solo tramo: ${items.join('; ')}. Es lo que dice el texto, y cada tramo tiene su fecha: ` +
      `para el detalle, lee el artículo ${elegido.numero} tal como se transcribe, y si buscas la suerte de un artículo ` +
      'concreto, ten en cuenta que puede estar en cualquiera de los tramos.',
  }
}

/** ¿A `hoy`, la norma sigue en vacancia? true/false, o null si no se puede afirmar. */
export function enVacancia(v: Vacancia, hoy: Date = new Date()): boolean | null {
  if (v.clase === 'inmediata') return false
  if (!v.desde) return null
  return hoyISO(hoy) < v.desde
}
