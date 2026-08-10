/**
 * Corte Suprema de Justicia — buscador de providencias.
 *
 * Backend separado del portal (`consultaprovidenciasbk`), encontrado leyendo su
 * bundle, igual que con la Constitucional. Es GraphQL, con la introspección
 * abierta, así que el esquema es verificable y no adivinado.
 *
 * Lo que aporta y ninguna otra fuente da: cada providencia trae la lista de
 * normas que cita, y esas citas encadenan directo con resolver_cita.
 *
 * Dos avisos verificados:
 *
 * - Una ruta inventada NO da 404: devuelve 200 con una página de mantenimiento.
 *   El canario valida la forma del JSON, nunca el código HTTP.
 * - Hay que indicar sala: sin `typeOfQuery` la consulta devuelve `null` en vez
 *   de error. Es la trampa que más tiempo cuesta si no se sabe.
 *
 * El texto completo lo entrega el propio backend, ya extraído, con
 * `getContentSearch`. Se creía que haría falta una dependencia para leer OOXML y
 * era falso por partida doble: los ficheros del servidor son casi todos `.doc`
 * BINARIO —18 de 22 providencias muestreadas en las cuatro salas, frente a 3
 * `.docx` y 1 `.pdf`—, así que una librería de docx habría fallado en el grueso,
 * y además no hace falta ninguna.
 */
import { CanarioError, cargar, textoDe } from '../../nucleo/parse.ts'
import { quitarStopwords } from '../gestor.ts'
import { pedirJson } from '../../nucleo/http.ts'

const API = 'https://consultaprovidenciasbk.cortesuprema.gov.co/api'

/** Salas que expone el buscador; sin una de estas la consulta devuelve null. */
export const SALAS = ['Tutelas', 'Civil', 'Laboral', 'Penal'] as const
export type Sala = (typeof SALAS)[number]

export type Providencia = {
  titulo: string
  sala: string
  clase: string
  magistrado: string
  fecha: string
  anio: number
  ruta: string
  normasCitadas: string[]
}

const CONSULTA =
  'query($q:SearchQuery!){getSearchResult(searchQuery:$q){numOfResults searchResults{' +
  'title id onlinePath doctor fechaCreacion ano autoSentencia leyesOArticulos}}}'

type Cruda = {
  title?: string
  onlinePath?: string
  doctor?: string
  fechaCreacion?: string
  ano?: number
  autoSentencia?: string
  leyesOArticulos?: string[]
}

/**
 * Número de providencia, sin extensión ni ruta: "STP9317-2025.docx" y
 * "STP9317-2025.pdf" son el mismo fallo publicado en dos formatos.
 */
const numeroProvidencia = (titulo: string): string =>
  titulo
    .replace(/\.(docx?|pdf|html?)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()

/**
 * El índice de la Corte tiene una entrada por ARCHIVO, no por providencia: el
 * mismo auto aparece en .docx y .pdf, y a veces con el ponente escrito de dos
 * formas ("Myriam Avila" y "Myriam Ávila Roldán"). Sin deduplicar, una página
 * de diez resultados podía traer cinco veces el mismo AP430-2023.
 *
 * Se conserva la variante con el nombre del ponente más completo, que es la
 * que sirve para citar.
 */
function deduplicar(items: Providencia[]): Providencia[] {
  const porNumero = new Map<string, Providencia>()
  for (const p of items) {
    const clave = numeroProvidencia(p.titulo)
    const previa = porNumero.get(clave)
    if (!previa || p.magistrado.length > previa.magistrado.length) {
      porNumero.set(clave, { ...p, titulo: clave })
    }
  }
  return [...porNumero.values()]
}

export async function buscar(opts: {
  texto: string
  sala?: Sala | undefined
  anio?: string | undefined
  magistrado?: string | undefined
  exacto?: boolean | undefined
  desde?: number | undefined
  limite?: number | undefined
}): Promise<{ total: number; items: Providencia[]; exacto: boolean; brutos: number; descartadas?: string[] }> {
  // El backend busca sobre el texto completo y no descarta palabras vacías:
  // "de" solo devuelve 69.454 providencias. Para los términos poco distintivos
  // se descartan antes de consultar, como en el Gestor. Un término que queda
  // vacío no se consulta: no hay nada significativo que buscar.
  const { usadas, descartadas } = quitarStopwords(opts.texto)
  if (!usadas) throw new Error('El término solo contiene palabras vacías; indica una palabra distintiva.')
  const texto = usadas.trim()
  const sala = opts.sala ?? 'Tutelas'

  const j = await pedirJson<{
    data?: { getSearchResult?: { numOfResults?: number; searchResults?: Cruda[] } | null }
    errors?: { message?: string }[]
  }>(API, {
    query: CONSULTA,
    variables: {
      q: {
        query: texto,
        // La sala viaja en los dos campos: así la pide su propio front.
        typeOfQuery: sala,
        roomTutelas: sala,
        start: Math.max(0, opts.desde ?? 0),
        isExact: opts.exacto ?? false,
        magistrate: opts.magistrado ?? '',
        year: opts.anio ?? '',
        autoSentencia: '',
        order: '',
        addedQueries: [],
      },
    },
  })

  if (j.errors?.length) throw new CanarioError(`el buscador de la Corte Suprema rechazó la consulta: ${j.errors[0]?.message}`)
  const r = j.data?.getSearchResult
  // `null` sin error es su forma de decir "faltan filtros"; no es "sin resultados".
  if (r === null || r === undefined) {
    throw new CanarioError('la Corte Suprema devolvió una respuesta vacía (suele faltar la sala)')
  }
  if (!Array.isArray(r.searchResults)) throw new CanarioError('la respuesta de la Corte Suprema no trae la lista de providencias')

  const items = deduplicar(
    r.searchResults.map((p) => ({
      titulo: p.title ?? '',
      sala,
      clase: p.autoSentencia ?? '',
      magistrado: (p.doctor ?? '').replace(/^Dr[a]?\.\s*/i, ''),
      fecha: (p.fechaCreacion ?? '').slice(0, 10),
      anio: p.ano ?? 0,
      ruta: p.onlinePath ?? '',
      normasCitadas: Array.isArray(p.leyesOArticulos) ? p.leyesOArticulos : [],
    })),
  )

  const limite = opts.limite ?? items.length
  return {
    total: typeof r.numOfResults === 'number' ? r.numOfResults : items.length,
    items: items.slice(0, Math.max(1, limite)),
    exacto: opts.exacto ?? false,
    // Cuántas entradas traía la página antes de deduplicar. Importa: el índice
    // repite tanto que una página de diez puede quedar en dos providencias, y
    // si no se dice, "quedan N resultados" promete documentos que no existen.
    brutos: r.searchResults.length,
    // Se declara qué se descartó: el usuario pidió "despido sin justa causa"
    // y el backend buscó "despido justa causa".
    ...(descartadas.length ? { descartadas } : {}),
  }
}

const CONTENIDO =
  'query($p:SearchPreviewDocument!){getContentSearch(previewDocument:$p){title id contentText}}'

/**
 * Lo que devuelve `getContentSearch` NO es el documento: es el conjunto de
 * pasajes que contienen `text`. Sin `text` solo llegan los rótulos de las
 * secciones (547 caracteres en la SL3772-2018) y con "despido" llegan 49.956.
 *
 * ponytail: para pedir el documento entero se manda un punto, que casa con todo
 * —659.513 caracteres de HTML, 47.104 de texto, de la cabecera al salvamento de
 * voto y sin repetir pasajes—. El techo es que una providencia sin un solo punto
 * volvería corta, cosa que no existe en un fallo judicial. El salto, si algún
 * día importa, es un parámetro `resaltar` que pase el término del usuario y
 * devuelva solo sus pasajes, que es para lo que el backend está hecho.
 */
const TODO = '.'

export type TextoProvidencia = { texto: string; ruta: string }

/**
 * Texto completo de una providencia por su `ruta` (el `onlinePath` que devuelve
 * `buscar`). Devuelve `null` cuando el backend no la encuentra: no lanza, porque
 * una ruta caducada es una respuesta sobre el documento, no un fallo de la fuente.
 */
export async function obtenerTexto(ruta: string, sala: Sala): Promise<TextoProvidencia | null> {
  const j = await pedirJson<{
    data?: { getContentSearch?: { title?: string; id?: string; contentText?: string } | null }
    errors?: { message?: string }[]
  }>(API, { query: CONTENIDO, variables: { p: { id: ruta, room: sala, text: TODO } } })

  if (j.errors?.length) throw new CanarioError(`la Corte Suprema rechazó la petición de texto: ${j.errors[0]?.message}`)
  const d = j.data?.getContentSearch
  if (!d) throw new CanarioError('la respuesta de texto de la Corte Suprema no trae el documento')
  // Su forma de decir "no existe" es 200 con id "-1" y los campos rellenos con
  // el mismo rótulo; tratarlo como texto habría devuelto esa frase como si fuera
  // la providencia.
  if (!d.id || d.id === '-1' || d.contentText === 'No se encontraron resultados') return null

  // El backend resalta lo que casa con `text` envolviéndolo en <mark>, y como
  // aquí casa TODO acaba envolviendo carácter a carácter: "46498" viaja como
  // cinco <mark> y deja de existir como cadena. Eso pesa 659 KB de HTML para 47
  // KB de texto y partía la cabecera —el radicado, que es la clave de cita—.
  // Quitar el resaltado no pierde nada: con este `text` no señala nada.
  const html = (d.contentText ?? '').replace(/<\/?mark\b[^>]*>/gi, '')
  // Sin <body> el selector de textoDe no encuentra nada y devuelve "".
  const texto = textoDe(cargar(`<body>${html}</body>`), 'body')
  if (!texto) return null
  // `title` no se devuelve: su backend guarda ahí basura ("sdñlfmñksdaf" en la
  // SL3772-2018). El número que sirve para citar es el que ya trae `buscar`.
  return { texto, ruta }
}
