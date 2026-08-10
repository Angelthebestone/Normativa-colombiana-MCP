/**
 * `obtener_documento`: un solo punto de lectura para las fuentes con texto.
 * Antes eran seis herramientas con el mismo esquema y el mismo cuerpo
 * (fragmentos + trocear + advertenciasVigencia + avisoSinTexto) repetido;
 * aquí el discriminador es `fuente` y los extras que cada una exige.
 *
 * El esquema común (buscar_en_texto/desde/max_pasajes/limite_caracteres) se
 * define una vez; cada fuente añade lo suyo (id/articulo/historial en gestor,
 * ruta/seccion en corte, sala en suprema, token en consejo, link en dian,
 * ruta en creg, entidad/url en sectorial). El texto se trocea igual en todas,
 * informando total/mostrado/omitido, y las advertencias de vigencia viajan
 * siempre. Con `entero=true` se escribe el documento a disco y se devuelve la
 * ruta con un trozo de lectura; con `ruta_destino` se descarga tal cual.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import {
  advertenciasVigencia,
  articulo as extraerArticulo,
  avisoSinTexto,
  cargar,
  fragmentos,
  historial,
  indiceArticulos,
  normalizarRotulo,
  seccion as seccionDe,
  seccionesPresentes,
  sinTildes,
  textoDe,
  trocear,
} from '../nucleo/parse.ts'
import { NoExisteError } from '../nucleo/parse.ts'
import { pedir as pedirHttp } from '../nucleo/http.ts'
import { descargarA } from '../nucleo/descargas.ts'
import { parsearCita } from '../nucleo/citas.ts'
import { extraerTextoWord } from '../fuentes/sectorial/word.ts'
import { textoDePdfSectorial, avisoEscaneo } from '../fuentes/sectorial/pdf.ts'
import { adaptador } from '../fuentes/sectorial.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'
import * as suprema from '../fuentes/jurisprudencia/cortesuprema.ts'
import * as consejo from '../fuentes/jurisprudencia/consejoestado.ts'
import * as dian from '../fuentes/normograma.ts'
import * as creg from '../fuentes/creg.ts'
import { esCompiladora, avisoCompiladora } from '../nucleo/compiladas.ts'

export const TITULO = 'Obtener el texto de un documento por fuente'

export const DESCRIPCION =
  'Devuelve el texto (troceado, nunca entero) de un documento de una de las siete fuentes con texto: ' +
  '"gestor" (normas del Gestor Normativo por id), "corte" (sentencias de la Corte Constitucional por ruta o ' +
  'cita), "suprema" (Corte Suprema por ruta + sala), "consejo" (Consejo de Estado por token), "dian" ' +
  '(normograma de la DIAN por link), "creg" (resoluciones CREG por ruta) y "sectorial" (actos de un ' +
  'regulador sectorial por entidad + url del acto, PDF o Word). Usa buscar_en_texto para encontrar ' +
  'un término dentro del documento, articulo/seccion para una parte puntual, o historial (solo gestor) para ' +
  'los cambios anotados. Nunca devuelve el documento entero: respeta limite_caracteres (200–40.000, default ' +
  '8000) e informa total/mostrado/omitido. Con entero=true escribe el documento a disco y devuelve la ruta ' +
  'con un trozo de lectura; con ruta_destino lo descarga a esa carpeta sin devolver el texto.'

/** El esquema común a todas las fuentes. */
const comun = {
  buscar_en_texto: z.string().optional().describe('Devuelve solo los fragmentos que mencionan este término'),
  desde: z.coerce.number().int().min(0).default(0),
  max_pasajes: z.coerce.number().int().positive().optional().describe('Máximo de pasajes con buscar_en_texto (por defecto 10)'),
  limite_caracteres: z.coerce
    .number()
    .int()
    .positive()
    .default(8000)
    .describe('Tope del TEXTO devuelto; se ajusta al rango 200–40.000'),
}

export const schema = {
  fuente: z
    .enum(['gestor', 'corte', 'suprema', 'consejo', 'dian', 'creg', 'sectorial'])
    .describe('De qué fuente sale el documento'),
  ...comun,
  // Extras por fuente (opcionales; el handler valida cuál aplica según fuente).
  id: z.coerce.string().optional().describe('Solo gestor: id numérico de la norma'),
  articulo: z.string().optional().describe('Solo gestor: número de artículo'),
  historial: z
    .boolean()
    .optional()
    .describe('Solo gestor: en vez del texto, devuelve los cambios anotados sobre la norma'),
  ruta: z.string().optional().describe('corte/suprema/creg: ruta del documento'),
  seccion: z
    .enum(['antecedentes', 'consideraciones', 'decision'])
    .optional()
    .describe('Solo corte: devuelve solo esa parte de la providencia'),
  sala: z.string().optional().describe('Solo suprema: la MISMA sala con la que se encontró'),
  token: z.string().optional().describe('Solo consejo: token que devuelve buscar_jurisprudencia_consejo_estado'),
  link: z.string().optional().describe('Solo dian: nombre del archivo, ej. "decreto_1625_2016.htm"'),
  entidad: z
    .string()
    .optional()
    .describe('Solo sectorial: id del regulador (los lista buscar_normativa_sectorial)'),
  url: z
    .string()
    .optional()
    .describe('Solo sectorial: enlace del acto a leer, tal como lo devuelve buscar_normativa_sectorial'),
  entero: z
    .boolean()
    .optional()
    .describe('En vez de trocear, escribe el documento a disco y devuelve la ruta con un trozo del texto'),
  ruta_destino: z
    .string()
    .optional()
    .describe('Carpeta donde guardar el archivo (con entero o para descargar el PDF/Word sin devolver texto)'),
}

const schemaCompleto = z.object(schema)
/** El tipo de entrada (los valores con default se resuelven al validar). */
type Parametros = z.input<typeof schemaCompleto>
/** Ya validado y con los defaults aplicados (desde/limite_caracteres resueltos). */
type Resueltas = z.infer<typeof schemaCompleto>

const topeDe = (l: number | undefined): number => Math.min(Math.max(l ?? 8000, 200), 40_000)

/** Avisa del escaneo o del texto ausente, con el enlace. */
function sinTexto(caracteres: number, url: string, escaneo = false): string {
  return avisoSinTexto(caracteres, url, escaneo)
}

/** Texto troceado con sus avisos — formato idéntico al de los handlers previos. */
function cuerpo(t: { texto: string; total: number; desde: number; omitido: number }, url: string): string {
  const avisos = advertenciasVigencia(t.texto).join('\n')
  return (
    `Texto total: ${t.total} caracteres; se muestran ${t.texto.length} desde ${t.desde}` +
    (t.omitido > 0 ? `; quedan ${t.omitido} (usa desde/limite_caracteres o buscar_en_texto).` : '.') +
    (avisos ? `\n${avisos}` : '') +
    `\n\n${t.texto}\n\nURL: ${url}${mencionesDe(t.texto)}`
  )
}

/** Busca dentro del texto con los pasajes agrupados — formato idéntico al previo. */
function pasajes(
  texto: string,
  termino: string,
  maxPasajes: number | undefined,
  tope: number,
  url: string,
  cabecera = '',
): string {
  const f = fragmentos(texto, termino, 400, maxPasajes ?? 10, tope)
  if (!f.total) {
    return `${cabecera}El término "${termino}" no aparece en el documento (${texto.length} caracteres revisados).\nURL: ${url}`
  }
  const mostrado = f.trozos.join('\n\n---\n\n')
  return (
    `${cabecera}${f.total} aparición(es) de "${termino}", agrupadas en ${f.pasajes} pasaje(s); se muestran ${f.mostrados}` +
    (f.mostrados < f.pasajes ? ` (los demás no caben en ${tope} caracteres: sube limite_caracteres o afina el término).` : '.') +
    `\n${advertenciasVigencia(mostrado).join('\n')}\n\n${mostrado}\n\nURL: ${url}${mencionesDe(mostrado)}`
  )
}

/**
 * Citas a otras normas detectadas en un texto, en forma canónica y sin
 * repetir. Se devuelve la línea final lista para pegar, o '' si no hay nada.
 */
export function mencionesDe(texto: string): string {
  const vistos = new Set<string>()
  const anadir = (trozo: string) => {
    const c = parsearCita(trozo)
    if (!c) return
    vistos.add(c.sentencia ?? `${c.tipo.charAt(0).toUpperCase()}${c.tipo.slice(1)} ${c.numero}${c.anio ? ` de ${c.anio}` : ''}`)
  }
  // Normas con su tipo: "Ley 100 de 1993", "Decreto 1072 de 2015", "art. 6 de
  // la Ley 1221". El trozo se ciñe al patrón tipo+número(+año) para que una
  // sentencia incrustada en la misma frase no se trague la cita de la norma.
  const RE_TIPO =
    /\b(?:acto legislativo|circular conjunta|circular externa|circular unificada|constituci[oó]n pol[ií]tica|concepto marco|criterio unificado|decreto ley|documento conpes|acuerdo|auto|circular|concepto|decreto|directiva|estatutos|ley|reglamento|resoluci[oó]n|sentencia)\b\s*(?:n[ºo°.]?\s*)?\d+(?:\s*(?:de|del|\/)\s*\d{2,4})?/gi
  for (const m of texto.matchAll(RE_TIPO)) anadir(m[0])
  // Las sentencias también se citan en corto, sin la palabra "sentencia":
  // "C-337/11", "T-099/24". La aduana de parsearCita descarta los falsos.
  for (const m of texto.matchAll(/\b(?:C|T|SU|A)[\s.-]*\d{1,4}(?:\s*(?:[/-]|\s+de\s+)\s*\d{2,4})?/gi)) anadir(m[0])
  if (!vistos.size) return ''
  return `\n\nEste documento menciona: ${[...vistos].join('; ')} (resuélvelas con resolver_cita).`
}

/** Añade la línea de menciones cuando el texto citado las tiene. */
const conMenciones = (s: string, texto: string): string => s + mencionesDe(texto)

// --- fuentes --------------------------------------------------------------

async function gestorDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.id) throw new Error('Para fuente="gestor" hace falta id.')
  let n: Awaited<ReturnType<typeof gestor.obtenerNorma>>
  try {
    n = await gestor.obtenerNorma(p.id)
  } catch (e) {
    if (e instanceof NoExisteError) return `No encontré una norma con id ${p.id}. Verifica el id con buscar_normas o resolver_cita.`
    throw e
  }

  const anioTitulo = n.titulo.match(/\bde\s+((?:19|20)\d{2})\b/)?.[1]
  const anioVigencia = Object.entries(n.fechas)
    .find(([k]) => /entrada\s+en\s+vigencia/i.test(k))?.[1]
    ?.match(/\b((?:19|20)\d{2})\b/)?.[1]
  const desajuste =
    anioTitulo && anioVigencia && anioVigencia !== anioTitulo
      ? `\nOJO CON ESE CAMPO: el portal fecha la entrada en vigencia en ${anioVigencia} para una norma de ` +
        `${anioTitulo}. Es su dato, no una comprobación de esta extensión, y en las normas compiladas no consta ` +
        `qué mide: no lo cites como fecha de expedición ni como prueba de que rige.`
      : ''
  const fechas = Object.entries(n.fechas)
  const cab = [
    n.titulo,
    ...(fechas.length ? ['Ficha del portal (campos del Gestor, copiados sin interpretar):'] : []),
    ...fechas.map(([k, v]) => `  ${k}: ${v || '(vacío en el portal)'}`),
    `URL: ${n.url}`,
    `PDF: ${n.urlPdf}`,
  ].join('\n') + desajuste

  if (n.texto.length < 200) {
    return `${cab}\n\n${sinTexto(n.texto.length, n.urlPdf, await gestor.pdfEscaneado(n.id))}`
  }

  if (p.historial) {
    const ambito = p.articulo ? extraerArticulo(n.texto, p.articulo) : n.texto
    if (p.articulo && !ambito) {
      return `${cab}\n\nNo encontré el artículo ${p.articulo}. Artículos detectados: ${indiceArticulos(n.texto).join(', ') || '(ninguno)'}`
    }
    const cambios = historial(ambito!)
    const donde = p.articulo ? `el artículo ${p.articulo}` : 'esta norma'
    if (!cambios.length) {
      return (
        `${cab}\n\nLas notas del Gestor no registran cambios sobre ${donde}. Eso NO equivale a que siga intacto: ` +
        `el portal no siempre anota las reformas, y la vigencia se consulta con resolver_cita.`
      )
    }
    return (
      `${cab}\n\n${cambios.length} cambio(s) anotados sobre ${donde}, en el orden en que aparecen en el documento:\n\n` +
      cambios
        .map(
          (c) =>
            `- ${c.accion.toUpperCase()}${c.norma ? ` por ${c.norma} de ${c.anio}` : ''}` +
            `${c.articulo ? `, artículo ${c.articulo}` : ''}\n  Nota literal: «${c.literal}»`,
        )
        .join('\n') +
      `\n\nSon las notas que el propio portal incrusta en el texto, citadas tal cual. No están ordenadas por ` +
      `fecha ni se deduce cuál rige hoy: para eso hay que leer el artículo y comprobar la vigencia.`
    )
  }

  const compiladora = !p.articulo && !p.buscar_en_texto && esCompiladora(n.titulo, n.texto.length)

  let cuerpo: string
  let avisoTexto = ''

  if (p.articulo) {
    const art = extraerArticulo(n.texto, p.articulo)
    if (!art) {
      return `${cab}\n\nNo encontré el artículo ${p.articulo}. Artículos detectados: ${indiceArticulos(n.texto).join(', ') || '(ninguno)'}`
    }
    cuerpo = art
  } else if (p.buscar_en_texto) {
    const f = fragmentos(n.texto, p.buscar_en_texto, 400, p.max_pasajes ?? 10, tope)
    if (!f.total) {
      return (
        `${cab}\n\nEl término "${p.buscar_en_texto}" no aparece en el texto de esta norma ` +
        `(${n.texto.length} caracteres revisados).`
      )
    }
    cuerpo = f.trozos.join('\n\n---\n\n')
    avisoTexto =
      `${f.total} aparición(es) de "${p.buscar_en_texto}", agrupadas en ${f.pasajes} pasaje(s); se muestran ${f.mostrados}` +
      (f.mostrados < f.pasajes ? ` (los demás no caben en ${tope} caracteres: sube limite_caracteres o afina el término).` : '.')
  } else {
    const t = trocear(n.texto, p.desde, tope)
    cuerpo = t.texto
    const arts = indiceArticulos(n.texto)
    avisoTexto =
      `Texto total: ${t.total} caracteres. Se muestran ${t.texto.length} desde la posición ${t.desde}` +
      (t.omitido > 0 ? `; quedan ${t.omitido} sin mostrar (usa desde/limite_caracteres o buscar_en_texto).` : '.') +
      (t.texto.length === 0 && t.total > 0
        ? `\nEl "desde" (${p.desde}) está más allá del final del texto: pide uno menor o usa buscar_en_texto.`
        : '') +
      (arts.length ? `\nArtículos detectados: ${arts.join(', ')}` : '')
  }

  const avisos = advertenciasVigencia(cuerpo)
  const aguja = sinTildes(p.buscar_en_texto ?? p.articulo ?? '').toLowerCase().trim()
  const pertinente = (t: (typeof n.temas)[number]) =>
    Number(sinTildes(`${t.tema} ${t.subtema} ${t.restrictor}`).toLowerCase().includes(aguja))
  const ordenados = aguja ? [...n.temas].sort((a, b) => pertinente(b) - pertinente(a)) : n.temas
  const cuantosTemas = tope < 2000 ? 3 : 10

  const temas = ordenados.length
    ? `\n\nTemas asociados (${Math.min(10, ordenados.length)} de ${ordenados.length}` +
      `${aguja ? ', primero los que mencionan lo buscado' : ', sin ordenar por relevancia'}):\n` +
      ordenados
        .slice(0, cuantosTemas)
        .map((t) => `- ${normalizarRotulo(t.tema)} / ${normalizarRotulo(t.subtema)}: ${t.restrictor}`)
        .join('\n')
    : ''

  return (
    `${cab}\n${compiladora ? `\n${avisoCompiladora(n.titulo, n.texto)}\n` : ''}${avisoTexto ? `\n${avisoTexto}\n` : ''}${avisos.length ? `\n${avisos.join('\n')}\n` : ''}` +
    `\n--- Texto ---\n${cuerpo}${temas}${mencionesDe(cuerpo)}`
  )
}

async function corteDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.ruta) throw new Error('Para fuente="corte" hace falta ruta.')
  let doc: Awaited<ReturnType<typeof corte.obtenerTexto>>
  try {
    doc = await corte.obtenerTexto(p.ruta)
  } catch (e) {
    if (e instanceof corte.NoExisteProvidencia) return `No existe una providencia en la ruta "${p.ruta}". Verifícala con buscar_jurisprudencia.`
    throw e
  }
  if (doc.texto.length < 200) return `Providencia ${p.ruta}\n\n${sinTexto(doc.texto.length, doc.url)}`

  if (p.seccion) {
    const hay = seccionesPresentes(doc.texto)
    const cuerpoSeccion = seccionDe(doc.texto, p.seccion)
    if (!cuerpoSeccion) {
      return (
        `No encontré la sección "${p.seccion}" en ${p.ruta}.` +
        (hay.length ? ` Esta providencia trae: ${hay.join(', ')}.` : ' No se reconoció ninguna sección con encabezado propio.')
      )
    }
    const t = trocear(cuerpoSeccion, p.desde, tope)
    return (
      `Providencia ${p.ruta} — sección "${p.seccion}" (${t.total} caracteres de ${doc.texto.length} del documento).\n` +
      `Secciones disponibles: ${hay.join(', ')}.` +
      (t.omitido > 0 ? ` Se muestran ${t.texto.length} desde ${t.desde}; quedan ${t.omitido}.` : '') +
      `\n\n--- ${p.seccion} ---\n${t.texto}\n\nURL: ${doc.url}`
    )
  }

  if (p.buscar_en_texto) return pasajes(doc.texto, p.buscar_en_texto, p.max_pasajes, tope, doc.url, `Providencia ${p.ruta}\n`)
  return `Providencia ${p.ruta}\n${cuerpo(trocear(doc.texto, p.desde, tope), doc.url)}`
}

async function supremaDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.ruta || !p.sala) throw new Error('Para fuente="suprema" hacen falta ruta y sala.')
  const doc = await suprema.obtenerTexto(p.ruta, p.sala as (typeof suprema.SALAS)[number])
  if (!doc) {
    return (
      `No encontré una providencia en la ruta "${p.ruta}" dentro de la sala ${p.sala}. ` +
      `Comprueba que la ruta salga de buscar_jurisprudencia_suprema y que la sala sea la misma con la que apareció.`
    )
  }
  const cab = `Corte Suprema de Justicia, sala ${p.sala}\nRuta: ${p.ruta}`
  if (doc.texto.length < 200) return `${cab}\n\n${sinTexto(doc.texto.length, p.ruta)}`
  if (p.buscar_en_texto) return pasajes(doc.texto, p.buscar_en_texto, p.max_pasajes, tope, p.ruta, `${cab}\n`)
  return `${cab}\n${cuerpo(trocear(doc.texto, p.desde, tope), p.ruta)}`
}

async function consejoDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.token) throw new Error('Para fuente="consejo" hace falta token.')
  const doc = await consejo.obtenerTexto(p.token)
  if (!doc) {
    return (
      'No encontré una providencia para ese token. ' +
      'Los tokens caducan en una hora: repite buscar_jurisprudencia_consejo_estado y usa el que venga ahora.'
    )
  }
  const cab = `Consejo de Estado${doc.fichero ? ` — ${doc.fichero}` : ''}\nVisor: ${doc.urlVisor}`
  if (!doc.texto) {
    return (
      `${cab}\n\nEsta actuación no se sirve como PDF (viene comprimida o en otro formato), así que aquí no hay ` +
      `texto que extraer. Ábrela en el visor de arriba. Que no haya texto NO dice nada sobre su contenido.`
    )
  }
  if (p.buscar_en_texto) return pasajes(doc.texto, p.buscar_en_texto, p.max_pasajes, tope, doc.urlVisor, `${cab}\n`)
  const t = trocear(doc.texto, p.desde, tope)
  return `${cab}\n${doc.paginas} página(s). ${cuerpo(t, doc.urlVisor)}`
}

async function dianDocumento(p: Parametros, tope: number): Promise<string> {
  if (!p.link) throw new Error('Para fuente="dian" hace falta link.')
  const url = dian.urlDocumento(p.link)
  const r = await pedirHttp(url, 90_000)
  if (r.status !== 200) {
    return `No encontré el documento "${p.link}" en el normograma de la DIAN. Verifica el link con buscar_normativa_tributaria.`
  }
  const texto = textoDe(cargar(r.cuerpo), 'body')
  if (texto.length < 200) return `${p.link}\n\n${sinTexto(texto.length, url)}`
  if (p.buscar_en_texto) return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, url, `${p.link}\n`)
  return `${p.link}\n${cuerpo(trocear(texto, p.desde, tope), url)}`
}

async function cregDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.ruta) throw new Error('Para fuente="creg" hace falta ruta.')
  const d = await creg.obtenerTexto(p.ruta)
  if (d.texto.length < 200) return `${p.ruta}\n\n${sinTexto(d.texto.length, d.url)}`
  if (p.buscar_en_texto) return pasajes(d.texto, p.buscar_en_texto, p.max_pasajes, tope, d.url, `${p.ruta}\n`)
  return `${p.ruta}\n${cuerpo(trocear(d.texto, p.desde, tope), d.url)}`
}

// --- sectorial y guardado a disco ----------------------------------------

/** Cómo se extrae el texto de un enlace sectorial, según el formato del archivo. */
function esFormatoWord(url: string): boolean {
  const nombre = url.split(/[?#]/)[0]!.toLowerCase()
  return nombre.endsWith('.doc') || nombre.endsWith('.docx') || nombre.endsWith('.zip')
}
const esPdf = (url: string): boolean => url.split(/[?#]/)[0]!.toLowerCase().endsWith('.pdf')

/**
 * Dependencias inyectables para probar sin red: los extractores sectoriales y
 * la descarga aceptan las suyas, y aquí se propagan. El servidor llama sin
 * ellas; los tests las pasan para no depender de portales.
 */
export type DepsLectura = {
  pedirBytes?: typeof import('../nucleo/http.ts')['pedirBytes']
  extraerPdf?: (bytes: Uint8Array) => Promise<string>
  descomprimirZip?: (bytes: Uint8Array) => Promise<Uint8Array | null>
}

/**
 * Sectorial sin entero ni ruta_destino: extrae el texto (PDF o Word) y lo
 * trocea como el resto de fuentes, con la advertencia de la fuente siempre
 * presente y las menciones a otras normas detectadas al final.
 */
async function sectorialDocumento(p: Resueltas, tope: number, deps: DepsLectura = {}): Promise<string> {
  if (!p.entidad || !p.url) throw new Error('Para fuente="sectorial" hacen falta entidad y url.')
  const a = adaptador(p.entidad)
  if (!a) {
    return `No hay un regulador sectorial llamado "${p.entidad}". Pide la lista a describir_fuentes o a buscar_normativa_sectorial.`
  }
  const cab = `Fuente: ${a.nombre} (${a.sector}).\nQué NO cubre: ${a.advertencia}`
  if (esPdf(p.url)) {
    const r = await textoDePdfSectorial(a, p.url, {
      ...(deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {}),
      ...(deps.extraerPdf ? { extraer: deps.extraerPdf } : {}),
    })
    if ('escaneo' in r) return `${cab}\n\n${avisoEscaneo(r.url)}`
    return `${cab}\n${conMenciones(cuerpo(trocear(r.texto, p.desde, tope), r.url), r.texto)}`
  }
  if (esFormatoWord(p.url)) {
    const r = await extraerTextoWord(a, p.url, {
      ...(deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {}),
      ...(deps.descomprimirZip ? { descomprimirZip: deps.descomprimirZip } : {}),
    })
    if ('sinTexto' in r) {
      return `${cab}\n\n${avisoSinTexto(0, r.url)} (los .doc binarios de Office no se pueden leer aquí).`
    }
    return `${cab}\n${conMenciones(cuerpo(trocear(r.texto, p.desde, tope), r.url), r.texto)}`
  }
  // El resto de formatos (HTML de un normograma, sobre todo) se lee como página.
  const r = await pedirHttp(p.url, 90_000)
  if (r.status !== 200) throw new Error(`El enlace respondió ${r.status}: no se pudo leer ${p.url}.`)
  const texto = textoDe(cargar(r.cuerpo), 'body')
  if (texto.length < 200) return `${cab}\n\n${sinTexto(texto.length, p.url)}`
  if (p.buscar_en_texto) return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, p.url, `${cab}\n`)
  return `${cab}\n${conMenciones(cuerpo(trocear(texto, p.desde, tope), p.url), texto)}`
}

/** La URL del archivo que se puede bajar en las fuentes con enlace directo. */
function urlDeDescarga(p: Resueltas): string | null {
  if (p.fuente === 'dian') return p.link ? dian.urlDocumento(p.link) : null
  if (p.fuente === 'sectorial') return p.url ?? null
  return null
}

/** El dominio que autoriza la descarga de cada fuente. */
function dominioDe(p: Resueltas): string {
  switch (p.fuente) {
    case 'gestor':
      return 'https://www.funcionpublica.gov.co'
    case 'corte':
      return 'https://www.corteconstitucional.gov.co'
    case 'creg':
      return 'https://gestornormativo.creg.gov.co'
    case 'dian':
      return 'https://normograma.dian.gov.co'
    case 'sectorial':
      return adaptador(p.entidad ?? '')?.dominioPermitido ?? ''
    default:
      return ''
  }
}

/** Directorio temporal de una llamada: normativa-<algo>, limpio al terminar. */
async function temporal(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'normativa-'))
}

/**
 * `entero=true`: se escribe el documento a disco (con descargarA cuando hay
 * enlace directo, o reconstruyendo el texto de las fuentes de texto) y se
 * devuelve la ruta absoluta con un trozo de lectura; nunca el documento entero.
 */
async function enteroDocumento(p: Resueltas, tope: number, deps: DepsLectura = {}): Promise<string> {
  const destino = p.ruta_destino ?? (await temporal())
  const url = urlDeDescarga(p)
  if (url) {
    const dominio = dominioDe(p)
    if (!dominio) throw new Error(`Para fuente="${p.fuente}" hace falta un enlace: usa dian con link o sectorial con url.`)
    const { rutaAbsoluta, bytes } = await descargarA(dominio, url, destino, deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {})
    return `Archivo guardado en: ${rutaAbsoluta} (${bytes} bytes).\n\nURL de origen: ${url}`
  }

  // Fuentes de texto sin enlace directo: se reconstruye el documento y se
  // escribe como texto; el trozo de lectura evita los 2 MB por stdio.
  let texto: string
  let origen = ''
  if (p.fuente === 'gestor') {
    if (!p.id) throw new Error('Para fuente="gestor" hace falta id.')
    const n = await gestor.obtenerNorma(p.id)
    texto = n.texto
    origen = n.url
  } else if (p.fuente === 'corte') {
    if (!p.ruta) throw new Error('Para fuente="corte" hace falta ruta.')
    const d = await corte.obtenerTexto(p.ruta)
    texto = d.texto
    origen = d.url
  } else if (p.fuente === 'creg') {
    if (!p.ruta) throw new Error('Para fuente="creg" hace falta ruta.')
    const d = await creg.obtenerTexto(p.ruta)
    texto = d.texto
    origen = d.url
  } else if (p.fuente === 'suprema') {
    if (!p.ruta || !p.sala) throw new Error('Para fuente="suprema" hacen falta ruta y sala.')
    const d = await suprema.obtenerTexto(p.ruta, p.sala as (typeof suprema.SALAS)[number])
    if (!d) throw new Error(`No encontré la providencia "${p.ruta}" en la sala ${p.sala}: no se puede guardar.`)
    texto = d.texto
    origen = p.ruta
  } else {
    throw new Error(`Fuente="${p.fuente}" sin enlace directo ni texto reconstruible: usa entero solo con gestor, corte, suprema, creg, dian o sectorial.`)
  }
  await mkdir(destino, { recursive: true })
  const txt = join(destino, `texto-${p.fuente}.txt`)
  await writeFile(txt, texto, 'utf8')
  return `Archivo guardado en: ${txt} (${texto.length} caracteres).\n\nURL de origen: ${origen}\n\n--- Texto (primeros caracteres) ---\n${trocear(texto, 0, tope).texto}`
}

const POR_FUENTE: Record<Resueltas['fuente'], (p: Resueltas, tope: number, deps: DepsLectura) => Promise<string>> = {
  gestor: gestorDocumento,
  corte: corteDocumento,
  suprema: supremaDocumento,
  consejo: consejoDocumento,
  dian: dianDocumento,
  creg: cregDocumento,
  sectorial: sectorialDocumento,
}

export async function escribir(p: Parametros, deps: DepsLectura = {}): Promise<string> {
  const r = schemaCompleto.parse(p) as Resueltas
  const tope = topeDe(r.limite_caracteres)
  // Con ruta_destino la orden es descargar, no leer: se obedece antes que el troceo.
  if (r.ruta_destino) return enteroDocumento(r, tope, deps)
  if (r.entero) return enteroDocumento(r, tope, deps)
  return POR_FUENTE[r.fuente](r, tope, deps)
}
