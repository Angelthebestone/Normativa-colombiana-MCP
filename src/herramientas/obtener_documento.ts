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
  mapaDeSecciones,
  etiquetaEn,
  ENCABEZADO_PROVIDENCIA,
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
import { adaptador, ids } from '../fuentes/sectorial.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'
import * as suprema from '../fuentes/jurisprudencia/cortesuprema.ts'
import * as consejo from '../fuentes/jurisprudencia/consejoestado.ts'
import * as dian from '../fuentes/normograma.ts'
import * as creg from '../fuentes/creg.ts'
import { esCompiladora, avisoCompiladora } from '../nucleo/compiladas.ts'
import { alcance, proyectar } from '../nucleo/alcance.ts'

export const TITULO = 'Obtener el texto de un documento por fuente'

export const DESCRIPCION =
  'Devuelve el texto (troceado, nunca entero) de una de las siete fuentes con texto. CADA FUENTE EXIGE LO ' +
  'SUYO y los parámetros de otra no valen con ella: gestor necesita id; corte, ruta; suprema, ruta y sala; ' +
  'consejo, token; dian, link; creg, ruta; sectorial, entidad y url. Una combinación que no encaje se ' +
  'rechaza antes de salir a la red, diciendo qué falta y el ejemplo mínimo que funciona. Dentro del texto: ' +
  'buscar_en_texto localiza un término, articulo (gestor) o seccion (corte, suprema, consejo) una parte puntual, e historial ' +
  '(gestor) los cambios anotados. Respeta limite_caracteres (200–40.000, por defecto 8000), informa ' +
  'total/mostrado/omitido y devuelve el "desde" exacto del trozo siguiente.'

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
  // Solo las fuentes encendidas (FUENTES): la llamada a una apagada no se puede
  // ni escribir, y la valida el mismo esquema antes de tocar la red.
  fuente: z
    .enum(proyectar(['gestor', 'corte', 'suprema', 'consejo', 'dian', 'creg', 'sectorial'] as const, (f) => f))
    .describe('De qué fuente sale el documento'),
  ...comun,
  // Extras por fuente (opcionales; el handler valida cuál aplica según fuente).
  id: z.coerce.string().optional().describe('Solo gestor: id numérico de la norma'),
  articulo: z.string().optional().describe('Solo gestor: número de artículo'),
  historial: z
    .boolean()
    .optional()
    .describe('Solo gestor: en vez del texto, devuelve los cambios anotados sobre la norma'),
  sin_temas: z
    .boolean()
    .optional()
    .describe('Solo gestor: omite el bloque de temas asociados (ahorra contexto cuando solo se quiere el articulado)'),
  ruta: z.string().optional().describe('corte/suprema/creg: ruta del documento'),
  seccion: z
    .enum(['encabezado', 'antecedentes', 'consideraciones', 'decision', 'salvamentos', 'aclaraciones', 'notas'])
    .optional()
    .describe(
      'Solo corte, suprema y consejo: devuelve solo esa parte de la providencia. "consideraciones" es la motivación ' +
        'de la MAYORÍA; "salvamentos" y "aclaraciones" son los votos particulares, que NO son doctrina de la Sala.',
    ),
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

/**
 * El contrato real de `fuente`, en una tabla que el mensaje de error reutiliza.
 *
 * La unión discriminada de abajo ES la validación de verdad, pero no puede ser
 * el `inputSchema` publicado: `registerTool` normaliza con
 * `normalizeObjectSchema`, que devuelve `undefined` para una unión (no tiene
 * `.shape`) y publica entonces un esquema VACÍO —medido: el cliente dejaría de
 * ver los 18 parámetros de esta herramienta, que es la que más pesa—. Por eso
 * el contrato va además en la descripción, que el cliente sí lee, y se comprueba
 * aquí antes de tocar la red.
 */
const EXIGE: Record<string, string[]> = {
  gestor: ['id'],
  corte: ['ruta'],
  suprema: ['ruta', 'sala'],
  consejo: ['token'],
  dian: ['link'],
  creg: ['ruta'],
  sectorial: ['entidad', 'url'],
}

/** El ejemplo mínimo que funciona, por fuente: es lo que el error devuelve. */
const EJEMPLO: Record<string, string> = {
  gestor: '{"fuente":"gestor","id":"31431"}',
  corte: '{"fuente":"corte","ruta":"2021/SU-371-21.htm"}',
  suprema: '{"fuente":"suprema","ruta":"<la de buscar_jurisprudencia_suprema>","sala":"Laboral"}',
  consejo: '{"fuente":"consejo","token":"<el de buscar_jurisprudencia_consejo_estado>"}',
  dian: '{"fuente":"dian","link":"decreto_1625_2016.htm"}',
  creg: '{"fuente":"creg","ruta":"<la de buscar_resoluciones_creg>"}',
  sectorial: '{"fuente":"sectorial","entidad":"sic","url":"<la de buscar_normativa_sectorial>"}',
}

/**
 * Parámetro exclusivo → fuentes que lo admiten. Con otra fuente se RECHAZA en
 * vez de ignorarse: `{fuente:"gestor", id:"31431", ruta:"…"}` devolvía la norma
 * del id y tiraba la ruta sin decir nada, que es el peor desenlace posible.
 */
const EXCLUSIVOS: Record<string, string[]> = {
  id: ['gestor'],
  articulo: ['gestor'],
  historial: ['gestor'],
  sin_temas: ['gestor'],
  seccion: ['corte', 'suprema', 'consejo'],
  sala: ['suprema'],
  token: ['consejo'],
  link: ['dian'],
  ruta: ['corte', 'suprema', 'creg'],
  entidad: ['sectorial'],
  url: ['sectorial'],
}

const SECCIONES_PROVIDENCIA = [
  'encabezado',
  'antecedentes',
  'consideraciones',
  'decision',
  'salvamentos',
  'aclaraciones',
  'notas',
] as const

/**
 * Identificador que se acepta como número o como texto, pero que NO se inventa
 * cuando falta: `z.coerce.string()` convierte `undefined` en la cadena
 * "undefined", así que una fuente sin su parámetro obligatorio pasaría la unión
 * y el error se daría más tarde. Medido: `{fuente:"gestor"}` colaba por ahí.
 */
const identificador = z.union([z.string(), z.number()]).transform(String)

/**
 * La unión discriminada por `fuente`: cada rama exige lo suyo y `.strict()`
 * convierte el parámetro de otra fuente en un error en vez de en un descarte
 * silencioso. El SDK no la publica (ver arriba), pero es la que valida.
 */
const union = z.discriminatedUnion('fuente', [
  z
    .object({
      ...comun,
      fuente: z.literal('gestor'),
      id: identificador,
      articulo: z.string().optional(),
      historial: z.boolean().optional(),
      sin_temas: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...comun, fuente: z.literal('corte'), ruta: z.string(), seccion: z.enum(SECCIONES_PROVIDENCIA).optional() }).strict(),
  z
    .object({ ...comun, fuente: z.literal('suprema'), ruta: z.string(), sala: z.string(), seccion: z.enum(SECCIONES_PROVIDENCIA).optional() })
    .strict(),
  z.object({ ...comun, fuente: z.literal('consejo'), token: z.string(), seccion: z.enum(SECCIONES_PROVIDENCIA).optional() }).strict(),
  z.object({ ...comun, fuente: z.literal('dian'), link: z.string() }).strict(),
  z.object({ ...comun, fuente: z.literal('creg'), ruta: z.string() }).strict(),
  // La entidad se resuelve en el handler (y allí se listan los ids válidos):
  // enumerarla aquí exigiría el registro sectorial ya cargado, y este módulo se
  // evalúa antes de `src/fuentes/sectorial/registro.ts`.
  z.object({ ...comun, fuente: z.literal('sectorial'), entidad: z.string(), url: z.string() }).strict(),
])

/** El error de una combinación imposible: qué se pidió, qué falta o sobra, y qué sí funciona. */
function problemaDeFuente(r: Resueltas): string {
  const campos = r as unknown as Record<string, unknown>
  const f = r.fuente
  const faltan = (EXIGE[f] ?? []).filter((k) => campos[k] === undefined)
  const sobran = Object.entries(EXCLUSIVOS)
    .filter(([k, dueñas]) => !dueñas.includes(f) && campos[k] !== undefined)
    .map(([k, dueñas]) => `${k} (es de ${dueñas.join('/')})`)
  const motivo =
    [faltan.length ? `hace falta ${faltan.join(' y ')}` : '', sobran.length ? `sobra ${sobran.join(', ')}` : '']
      .filter(Boolean)
      .join('; ') || 'los parámetros no encajan con esa fuente'
  return (
    `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}. ` +
    `Cada valor de "fuente" exige lo suyo (${Object.entries(EXIGE).map(([k, v]) => `${k}→${v.join('+')}`).join(', ')}). ` +
    `Ejemplo mínimo que funciona: ${EJEMPLO[f]}`
  )
}

const topeDe = (l: number | undefined): number => Math.min(Math.max(l ?? 8000, 200), 40_000)

/**
 * Detalle de la línea de alcance: el identificador con el que se pidió el
 * documento (lo único que se puede declarar de él antes de leerlo). El switch
 * cubre todas las fuentes, así que es total.
 */
function pedidoDe(r: Resueltas): string {
  switch (r.fuente) {
    case 'gestor':
      return `id ${r.id}`
    case 'corte':
    case 'suprema':
    case 'creg':
      return `ruta ${r.ruta}`
    case 'consejo':
      return 'por token'
    case 'dian':
      return `link ${r.link}`
    case 'sectorial':
      return `entidad ${r.entidad}`
  }
}

/** Avisa del escaneo o del texto ausente, con el enlace. */
function sinTexto(caracteres: number, url: string, escaneo = false): string {
  return avisoSinTexto(caracteres, url, escaneo)
}

/**
 * La llamada literal que trae el trozo siguiente, con el `desde` ya calculado.
 * Antes la respuesta decía cuántos caracteres quedaban y dejaba la aritmética
 * al cliente; el encargo lo pidió al revés: devolver el asa.
 */
function reanudar(p: Resueltas, desde: number): string {
  const a = [`fuente="${p.fuente}"`]
  for (const k of ['id', 'ruta', 'sala', 'token', 'link', 'entidad', 'url', 'seccion', 'articulo'] as const) {
    if (p[k] !== undefined) a.push(`${k}="${String(p[k])}"`)
  }
  return `Trozo siguiente: obtener_documento con ${a.join(', ')}, desde=${desde}`
}

/**
 * Pega el origen en CADA bloque de texto: el troceo y la búsqueda parten el
 * documento en párrafos, y un párrafo citable sin su URL en el mismo bloque se
 * cita como si fuera de otro documento.
 */
const conOrigen = (texto: string, url: string): string =>
  texto
    .split(/\n{2,}/)
    .map((bloque) => `${bloque}\nURL: ${url}`)
    .join('\n\n')

/** Texto troceado con sus avisos — formato idéntico al de los handlers previos. */
function cuerpo(t: { texto: string; total: number; desde: number; omitido: number }, url: string, p: Resueltas): string {
  const avisos = advertenciasVigencia(t.texto).join('\n')
  return (
    `Texto total: ${t.total} caracteres; se muestran ${t.texto.length} desde ${t.desde}` +
    (t.omitido > 0 ? `; quedan ${t.omitido} sin mostrar.\n${reanudar(p, t.desde + t.texto.length)}.` : '.') +
    (avisos ? `\n${avisos}` : '') +
    `\n\n${conOrigen(t.texto, url)}${mencionesDe(t.texto)}`
  )
}

/** Busca dentro del texto con los pasajes agrupados — formato idéntico al previo. */
/**
 * `etiquetar` rotula cada pasaje con la parte del documento de la que sale. Lo
 * pasan las tres cortes, donde un pasaje de un voto particular no es doctrina
 * de la Sala; en una norma no hay nada análogo que rotular.
 */
function pasajes(
  texto: string,
  termino: string,
  maxPasajes: number | undefined,
  tope: number,
  url: string,
  cabecera = '',
  etiquetar?: (pos: number) => string,
): string {
  const f = fragmentos(texto, termino, 400, maxPasajes ?? 10, tope)
  if (!f.total) {
    return `${cabecera}El término "${termino}" no aparece en el documento (${texto.length} caracteres revisados).\nURL: ${url}`
  }
  const etiquetas = etiquetar ? f.inicios.map(etiquetar) : []
  const mostrado = f.trozos
    .map((t, i) => (etiquetas[i] ? `[${etiquetas[i]}]\n${t}` : t))
    .join('\n\n---\n\n')
  // Que los pasajes salgan de partes distintas es justo lo que hay que decir
  // arriba: es donde se comete el error de atribuir a la mayoría un voto suelto.
  const distintas = [...new Set(etiquetas)]
  const aviso =
    distintas.length > 1
      ? `\nATENCIÓN: los pasajes salen de partes distintas de la providencia (${distintas.join('; ')}). ` +
        'Cada uno va rotulado con la suya. Solo las consideraciones de la mayoría son doctrina de la Sala.'
      : ''
  return (
    `${cabecera}${f.total} aparición(es) de "${termino}", agrupadas en ${f.pasajes} pasaje(s); se muestran ${f.mostrados}` +
    (f.mostrados < f.pasajes ? ` (los demás no caben en ${tope} caracteres: sube limite_caracteres o afina el término).` : '.') +
    `${aviso}\n${advertenciasVigencia(mostrado).join('\n')}\n\n${conOrigen(mostrado, url)}${mencionesDe(mostrado)}`
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
      const arts = indiceArticulos(n.texto)
      return (
        `${cab}\n\nNo encontré el artículo ${p.articulo}. ` +
        (arts.length ? `Artículos detectados: ${arts.join(', ')}. Repite con articulo= y uno de esos.` : 'No se detectó ningún artículo en el texto.')
      )
    }
    cuerpo = art
  } else if (p.buscar_en_texto) {
    const f = fragmentos(n.texto, p.buscar_en_texto, 400, p.max_pasajes ?? 10, tope)
    if (!f.total) {
      // El vacío enseña: dice qué se buscó, sobre cuánto texto, y por dónde
      // seguir sin tener que adivinar ni volver a pedir la norma entera.
      const arts = indiceArticulos(n.texto)
      return (
        `${cab}\n\nEl término "${p.buscar_en_texto}" no aparece en el texto de esta norma ` +
        `(${n.texto.length} caracteres revisados). La búsqueda es literal, sin sinónimos ni lematización: ` +
        `prueba otra forma de la palabra, o pide el artículo por su número.` +
        (arts.length ? `\nArtículos detectados: ${arts.join(', ')}` : '')
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
      (t.omitido > 0 ? `; quedan ${t.omitido} sin mostrar.\n${reanudar(p, t.desde + t.texto.length)}.` : '.') +
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

  // El bloque de temas es costoso (en un artículo puntual ocupa varias veces
  // lo que ocupa el artículo) y casi siempre ruido: se puede omitir.
  const temas =
    p.sin_temas || !ordenados.length
      ? p.sin_temas
        ? '\n\n(Bloque de temas asociados omitido con sin_temas=true.)'
        : ''
      : `\n\nTemas asociados (${Math.min(10, ordenados.length)} de ${ordenados.length}` +
        `${aguja ? ', primero los que mencionan lo buscado' : ', sin ordenar por relevancia'}):\n` +
        ordenados
          .slice(0, cuantosTemas)
          .map((t) => `- ${normalizarRotulo(t.tema)} / ${normalizarRotulo(t.subtema)}: ${t.restrictor}`)
          .join('\n')

  return (
    `${cab}\n${compiladora ? `\n${avisoCompiladora(n.titulo, n.texto)}\n` : ''}${avisoTexto ? `\n${avisoTexto}\n` : ''}${avisos.length ? `\n${avisos.join('\n')}\n` : ''}` +
    `\n--- Texto ---\n${conOrigen(cuerpo, n.url)}${temas}${mencionesDe(cuerpo)}`
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
  return leerProvidencia(doc.texto, doc.url, `Providencia ${p.ruta}`, p, tope)
}

/**
 * Una providencia de cualquiera de las tres cortes: estructura en la cabecera,
 * la sección pedida y cada pasaje de buscar_en_texto rotulado con la parte de
 * la que sale. Un solo camino para las tres, porque el error que evita —citar
 * un voto particular como doctrina de la Sala— es el mismo en las tres, y sus
 * encabezados también (medido sobre doce providencias de la Suprema y del
 * Consejo el 2026-09-24; ver SECCIONES en parse.ts).
 *
 * `encabezado` rotula lo que va antes del primer encabezado: en la Corte
 * Constitucional lo pone su relatoría; en las otras dos es la identificación
 * del proceso.
 */
function leerProvidencia(
  texto: string,
  url: string,
  cab: string,
  p: Resueltas,
  tope: number,
  encabezado?: string,
  pie = '',
): string {
  // El mapa se calcula una vez: rotula la estructura en la cabecera, acota la
  // sección pedida y etiqueta cada pasaje de buscar_en_texto.
  const mapa = mapaDeSecciones(texto, encabezado)
  const estructura = mapa.map((t) => `${t.etiqueta} (${t.hasta - t.desde} car.)`).join(' · ')

  if (p.seccion) {
    const cuerpoSeccion = seccionDe(texto, p.seccion, encabezado)
    if (!cuerpoSeccion) {
      const hay = seccionesPresentes(texto)
      return (
        `${cab}\nNo encontré la sección "${p.seccion}".` +
        (hay.length ? ` Esta providencia trae: ${hay.join(', ')}.` : ' No se reconoció ninguna sección con encabezado propio.')
      )
    }
    const t = trocear(cuerpoSeccion, p.desde, tope)
    return (
      `${cab} — sección "${p.seccion}" (${t.total} caracteres de ${texto.length} del documento).\n` +
      `Estructura: ${estructura}.` +
      (t.omitido > 0
        ? ` Se muestran ${t.texto.length} desde ${t.desde}; quedan ${t.omitido} sin mostrar.\n${reanudar(p, t.desde + t.texto.length)}.`
        : '') +
      `\n\n${conOrigen(t.texto, url)}`
    )
  }

  if (p.buscar_en_texto) {
    return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, url, `${cab}\nEstructura: ${estructura}.\n`, (pos) =>
      etiquetaEn(mapa, pos),
    )
  }
  return `${cab}\nEstructura: ${estructura}.\n${pie}${cuerpo(trocear(texto, p.desde, tope), url, p)}`
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
  return leerProvidencia(doc.texto, p.ruta, cab, p, tope, ENCABEZADO_PROVIDENCIA)
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
  return leerProvidencia(doc.texto, doc.urlVisor, cab, p, tope, ENCABEZADO_PROVIDENCIA, `${doc.paginas} página(s). `)
}

async function dianDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.link) throw new Error('Para fuente="dian" hace falta link.')
  const url = dian.urlDocumento(p.link)
  const r = await pedirHttp(url, 90_000)
  if (r.status !== 200) {
    return `No encontré el documento "${p.link}" en el normograma de la DIAN. Verifica el link con buscar_normativa_tributaria.`
  }
  const texto = textoDe(cargar(r.cuerpo), 'body')
  if (texto.length < 200) return `${p.link}\n\n${sinTexto(texto.length, url)}`
  if (p.buscar_en_texto) return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, url, `${p.link}\n`)
  return `${p.link}\n${cuerpo(trocear(texto, p.desde, tope), url, p)}`
}

async function cregDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.ruta) throw new Error('Para fuente="creg" hace falta ruta.')
  const d = await creg.obtenerTexto(p.ruta)
  if (d.texto.length < 200) return `${p.ruta}\n\n${sinTexto(d.texto.length, d.url)}`
  if (p.buscar_en_texto) return pasajes(d.texto, p.buscar_en_texto, p.max_pasajes, tope, d.url, `${p.ruta}\n`)
  return `${p.ruta}\n${cuerpo(trocear(d.texto, p.desde, tope), d.url, p)}`
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
    // Sin los ids a la vista, el usuario solo sabe que se equivocó. Se listan.
    return (
      `No hay un regulador sectorial llamado "${p.entidad}". Los ids válidos son: ${ids().join(', ')}. ` +
      `Cada uno con su sector, en describir_fuentes; los actos de uno concreto, en buscar_normativa_sectorial.`
    )
  }
  const cab = `Fuente: ${a.nombre} (${a.sector}).\nQué NO cubre: ${a.advertencia}`
  if (esPdf(p.url)) {
    const r = await textoDePdfSectorial(a, p.url, {
      ...(deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {}),
      ...(deps.extraerPdf ? { extraer: deps.extraerPdf } : {}),
    })
    if ('escaneo' in r) return `${cab}\n\n${avisoEscaneo(r.url)}`
    return `${cab}\n${conMenciones(cuerpo(trocear(r.texto, p.desde, tope), r.url, p), r.texto)}`
  }
  if (esFormatoWord(p.url)) {
    const r = await extraerTextoWord(a, p.url, {
      ...(deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {}),
      ...(deps.descomprimirZip ? { descomprimirZip: deps.descomprimirZip } : {}),
    })
    if ('sinTexto' in r) {
      return `${cab}\n\n${avisoSinTexto(0, r.url)} (los .doc binarios de Office no se pueden leer aquí).`
    }
    return `${cab}\n${conMenciones(cuerpo(trocear(r.texto, p.desde, tope), r.url, p), r.texto)}`
  }
  // El resto de formatos (HTML de un normograma, sobre todo) se lee como página.
  const r = await pedirHttp(p.url, 90_000)
  if (r.status !== 200) throw new Error(`El enlace respondió ${r.status}: no se pudo leer ${p.url}.`)
  const texto = textoDe(cargar(r.cuerpo), 'body')
  if (texto.length < 200) return `${cab}\n\n${sinTexto(texto.length, p.url)}`
  if (p.buscar_en_texto) return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, p.url, `${cab}\n`)
  return `${cab}\n${conMenciones(cuerpo(trocear(texto, p.desde, tope), p.url, p), texto)}`
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
    // El Consejo de Estado no publica un archivo descargable: su texto sale del
    // PDF del visor, que no se reconstruye aquí.
    throw new Error(
      `entero/ruta_destino no aplica a fuente="${p.fuente}": no hay archivo que guardar. ` +
        `Con fuente="consejo" pide el texto sin entero (o abre el visor); entero sí vale con gestor, corte, suprema, creg, dian y sectorial.`,
    )
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
  // El esquema publicado valida los tipos; la unión valida la COMBINACIÓN, que
  // es lo que el esquema plano no puede decir. Se hace aquí, antes de tocar la
  // red: una llamada imposible no gasta viaje ni devuelve un vacío que se lea
  // como "no hay resultados".
  const r = schemaCompleto.parse(p) as Resueltas
  if (!union.safeParse(r).success) throw new Error(problemaDeFuente(r))
  const tope = topeDe(r.limite_caracteres)
  // Con ruta_destino la orden es descargar, no leer: se obedece antes que el troceo.
  const cuerpo =
    r.ruta_destino || r.entero ? await enteroDocumento(r, tope, deps) : await POR_FUENTE[r.fuente](r, tope, deps)
  // Cada llamada consulta UNA sola fuente, la de `fuente`. La excepción es un
  // id sectorial inexistente: devuelve la lista de ids válidos sin salir a la
  // red, y declarar ahí que se consultó el regulador sería falso.
  const cabecera =
    r.fuente === 'sectorial' && !adaptador(r.entidad ?? '')
      ? 'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).'
      : alcance([{ clave: r.fuente, detalle: pedidoDe(r) }])
  return `${cabecera}\n\n${cuerpo}`
}
