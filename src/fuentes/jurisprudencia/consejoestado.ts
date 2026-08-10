/**
 * Consejo de Estado — SAMAI, buscador de providencias tituladas.
 *
 * Es la tercera alta corte y la única que no tiene API. Su buscador es ASP.NET
 * WebForms, así que la primera versión enviaba el formulario con su
 * `__VIEWSTATE` y el `__EVENTTARGET` del LinkButton de búsqueda. Funcionaba,
 * pero solo daba la primera página: avanzar exigía otro postback encadenado.
 *
 * La propia página ofrece la salida, en su botón «Copiar Link Permanente de
 * Búsqueda»: un GET a `ResultadoBuscadorProvidenciasTituladas.aspx` con la
 * consulta y el número de página en un JSON. Sin `__VIEWSTATE`, sin cookie y
 * sin POST. Se comprobó que devuelve exactamente las mismas providencias y en
 * el mismo orden que el postback —tres consultas distintas, radicado por
 * radicado— y que `PaginaActual` avanza de verdad, así que reemplaza a la
 * maquinaria anterior en vez de convivir con ella.
 *
 * SAMAI pagina en bloques de ~10 y no acepta un desplazamiento libre; por eso
 * esto se pide por página y no con el `desde` del resto de herramientas. Los
 * bloques no siempre traen 10 filas legibles, así que un `desde` exacto sería
 * un número inventado.
 *
 * ponytail: el canario cuenta radicados y lee el rótulo de paginación, nunca el
 * código HTTP. Aquí un 200 no significa nada —la página de error responde 200
 * con HTML—, y devolver vacío en silencio se leería como "no existe esa
 * sentencia".
 */
import * as cheerio from 'cheerio/slim'
import { CanarioError, limpiarTermino, sinTildes } from '../../nucleo/parse.ts'
import { terminosSignificativos } from '../gestor.ts'
import { pedir, pedirBytes } from '../../nucleo/http.ts'

const BASE = 'https://samai.consejodeestado.gov.co'
const RUTA = '/TitulacionRelatoria/ResultadoBuscadorProvidenciasTituladas.aspx'
/** Código del Consejo de Estado en SAMAI; va fijo en el enlace permanente. */
const CORPORACION = '1100103'
/** El buscador tal como lo abre una persona, para remitir a él. */
export const BUSCADOR = `${BASE}/TitulacionRelatoria/BuscadorProvidenciasTituladas.aspx`

export type Titulacion = { problema: string; respuesta: string; nota: string }
export type Providencia = {
  radicado: string
  fecha: string
  ponente: string
  sala: string
  clase: string
  actor: string
  demandado: string
  titulaciones: Titulacion[]
  /** Ficha del proceso en SAMAI: es el enlace citable, no el del buscador. */
  url: string
  /**
   * Token firmado que el propio buscador emite para VER la providencia. Es la
   * única vía a su texto: la ficha del proceso pide una verificación anti-robot
   * y este camino, que el portal publica en sus resultados, no pide nada.
   * Caduca en una hora, así que no es citable: se regenera repitiendo la búsqueda.
   */
  token: string
}

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Texto de una providencia sobre el que se filtra: problema jurídico, respuesta y nota. */
const textoDe = (p: Providencia): string =>
  p.titulaciones.map((t) => `${t.problema} ${t.respuesta} ${t.nota}`).join(' ')

/**
 * Filtro local AND. SAMAI une los términos con OR, así que el filtro que exige
 * TODOS los términos va aquí, después de la consulta, sobre el texto que el
 * buscador sí publica en cada resultado (problema jurídico, respuesta y nota).
 * Las vacías no se exigen: "nulidad electoral" no debe descartar una providencia
 * por no traer la palabra "de".
 */
export function contienenTodas(items: Providencia[], frase: string): { items: Providencia[]; exigidos: string[]; omitidos: number } {
  const exigidos = terminosSignificativos(frase)
  if (exigidos.length < 2) return { items, exigidos, omitidos: 0 }
  const quedan = items.filter((p) => {
    const heno = sinTildes(textoDe(p)).toLowerCase()
    return exigidos.every((t) => heno.includes(t))
  })
  return { items: quedan, exigidos, omitidos: items.length - quedan.length }
}

/**
 * El enlace permanente que genera la propia página. Los paréntesis delimitan la
 * consulta en la sintaxis del buscador, así que los del término se quitan: uno
 * suelto la dejaría sin cerrar y SAMAI devolvería otra cosa sin avisar.
 */
export function enlaceBusqueda(texto: string, pagina: number): string {
  const dic = JSON.stringify({
    corporacion: CORPORACION,
    modo: '2',
    filtro: '',
    busqueda: `(${texto.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim()})`,
    searchMode: 'any',
    PaginaActual: String(Math.max(0, pagina)),
  })
  return `${BASE}${RUTA}?BusquedaDictionary=${encodeURIComponent(dic)}`
}

/**
 * Cada providencia es una fila del repetidor, y sus campos llevan id propio
 * terminado en el mismo índice: `HypRadicado_3`, `LblPonente_3`, etc.
 *
 * El primer intento buscaba el radicado por cercanía al bloque de texto y era
 * un error caro: hay diez bloques y solo siete radicados, separados por
 * decenas de miles de caracteres, así que emparejar por posición habría
 * atribuido la tesis de una providencia a otra. En una herramienta jurídica esa
 * es la peor equivocación posible, y encima silenciosa. Se lee por id o no se
 * lee.
 */
const RAIZ = 'ContentPlaceHolder1_ResultadoBusqueda1_TitulacionesRepeater_'

function parsear(html: string, limite: number, urlBusqueda: string): { paginas: number; items: Providencia[] } {
  const $ = cheerio.load(html)
  const campoDe = (nombre: string, n: number): string => limpio($(`[id="${RAIZ}${nombre}_${n}"]`).first().text())

  const indices = [...new Set([...html.matchAll(new RegExp(`${RAIZ}HypRadicado_(\\d+)"`, 'g'))].map((m) => Number(m[1])))]
    .sort((a, b) => a - b)
    .slice(0, limite)

  const items: Providencia[] = []
  for (const n of indices) {
    const radicado = campoDe('HypRadicado', n)
    if (!radicado) continue

    // Las titulaciones de ESTA providencia, por su índice, no por proximidad.
    const titulaciones: Titulacion[] = []
    // `[id*=ProblemaJuridicoLabel]` casa también con SeResuelveProblemaJuridicoLabel,
    // y la respuesta se colaba en la lista como si fuera otro problema jurídico.
    $(`[id^="${RAIZ}TitulacionProvidenciaTexto1_${n}_"][id*="ProblemaJuridicoLabel"]`).each((_, el) => {
      const idEl = $(el).attr('id') ?? ''
      if (/SeResuelveProblemaJuridicoLabel/.test(idEl)) return
      const base = idEl.replace(/ProblemaJuridicoLabel_(\d+)$/, '')
      const suf = idEl.match(/_(\d+)$/)?.[1] ?? '0'
      const problema = limpio($(el).text()).replace(/^Problema jur[íi]dico:\s*/i, '')
      if (!problema) return
      const respuesta = limpio($(`[id="${base}SeResuelveProblemaJuridicoLabel_${suf}"]`).text()).replace(
        /^Respuesta al problema jur[íi]dico:\s*/i,
        '',
      )
      const nota = limpio($(`[id="${base}NotaRelatoriaLabel_${suf}"]`).text()).replace(/^NOTA DE RELATOR[ÍI]A:\s*/i, '')
      if (!titulaciones.some((t) => t.problema === problema && t.nota === nota)) {
        titulaciones.push({ problema, respuesta, nota })
      }
    })

    // El radicado enlaza a la ficha del proceso. Es lo que hace citable el
    // resultado: sin ella solo quedaba decir "búscalo en el buscador".
    const href = $(`[id="${RAIZ}HypRadicado_${n}"]`).first().attr('href') ?? ''
    // El enlace a la providencia va en `documentlink_<n>`, con el MISMO índice
    // que el radicado. Se lee por id por la razón de siempre en este módulo:
    // emparejar por proximidad atribuiría el documento de una providencia a otra.
    const token =
      $(`[id="${RAIZ}documentlink_${n}"]`).first().attr('onclick')?.match(/tokenDocumento=([A-Za-z0-9_,.-]+)/)?.[1] ?? ''
    items.push({
      radicado,
      token,
      fecha: campoDe('LblFECHAPROC', n),
      ponente: campoDe('LblPonente', n),
      sala: campoDe('LbNombreSalaDecision', n),
      clase: campoDe('LblClaseProceso', n),
      actor: campoDe('LblActor', n),
      demandado: campoDe('LblDemandado', n),
      titulaciones: titulaciones.slice(0, 4),
      url: href ? new URL(href, `${BASE}${RUTA}`).toString() : urlBusqueda,
    })
  }

  const pag = limpio($('[id$="PaginaActualLabel"]').first().text()).match(/de\s+([\d.,]+)/i)?.[1] ?? ''
  return { paginas: pag ? Number(pag.replace(/[.,]/g, '')) : -1, items }
}

export async function buscar(
  texto: string,
  limite = 5,
  pagina = 1,
): Promise<{ paginas: number; pagina: number; items: Providencia[]; url: string; nota?: string | undefined; omitidos: number }> {
  const q = limpiarTermino(texto)
  if (!q) throw new Error('Indica un término para buscar en el Consejo de Estado.')

  // El enlace cuenta las páginas desde cero; hacia fuera se numeran desde uno,
  // que es como las rotula la propia página ("Página 1 de 15406").
  const n = Math.max(1, Math.trunc(pagina))
  const url = enlaceBusqueda(q, n - 1)
  const r = await pedir(url, 120_000)

  // Un 500 de SAMAI no es un cambio de marcado. Su backend responde
  // «The wait operation timed out» cuando la consulta agota el tiempo en su
  // base de datos, y sin esta comprobación el canario culpaba a la estructura
  // del portal y mandaba a actualizar la extensión, que no arregla nada.
  if (r.status >= 500) {
    throw new Error(
      `SAMAI no respondió a tiempo (error ${r.status}): su buscador agota el tiempo con consultas amplias. ` +
        `Vuelve a intentarlo, o usa un término más específico. No es que no haya providencias.`,
    )
  }
  if (r.status !== 200) throw new Error(`SAMAI respondió ${r.status}.`)

  const res = parsear(r.cuerpo, Math.min(Math.max(limite, 1), 10), url)

  // Un 200 no prueba nada, así que el canario mira el contenido. Sin el rótulo
  // de paginación la respuesta ni siquiera es la página de resultados: eso es
  // un cambio de marcado, no un "no hay nada".
  if (res.paginas < 0) {
    throw new CanarioError(
      'SAMAI respondió sin el rótulo de paginación: el enlace permanente de búsqueda dejó de devolver resultados',
    )
  }
  // Con paginación pero sin ninguna fila legible el fallo es del parseo, y este
  // es el caso traicionero: parece "no hay providencias" y no lo es.
  if (!res.items.length && res.paginas > 0 && n <= res.paginas) {
    throw new CanarioError(
      `SAMAI dice tener ${res.paginas} página(s) de resultados pero no se pudo leer ninguna providencia ` +
        `(los identificadores del repetidor cambiaron)`,
    )
  }

  // SAMAI une los términos con OR, así que exigir TODOS es un filtro local sobre
  // el texto que el buscador publica. De la página pedida solo quedan las
  // providencias que tratan todo el asunto, no las que rozan una palabra.
  const { items: filtrados, exigidos, omitidos } = contienenTodas(res.items, q)
  const nota =
    exigidos.length >= 2
      ? `Se exigieron TODOS los términos (${exigidos.join(', ')}) sobre el problema jurídico, la respuesta y la nota ` +
        `de relatoría: SAMAI los une con OR, así que esto es un filtro local de pertinencia.`
      : undefined

  return { ...res, items: filtrados, pagina: n, url, ...(nota ? { nota } : {}), omitidos }
}

/** Página que abre la providencia con el token del buscador. No pide verificación. */
export const enlaceProvidencia = (token: string): string =>
  `${BASE}/PaginasTransversales/VerProvidencia.aspx?tokenDocumento=${token}`

export type TextoProvidencia = { texto: string; paginas: number; urlVisor: string; fichero: string }

/**
 * Texto de una providencia, por el token que emite el buscador.
 *
 * El camino es de tres saltos y lo publica el propio portal: el buscador emite
 * `VerProvidencia.aspx?tokenDocumento=<JWT>`, esa página genera una URL firmada
 * (SAS de Azure, solo lectura y una hora de vida) y ahí está el PDF. La ficha
 * del proceso, que es a donde se enlazaba antes, pide una verificación
 * anti-robot; esta ruta no pide nada.
 *
 * El token caduca en una hora, así que no es citable: para citar sigue valiendo
 * el radicado. Si caducó, se vuelve a buscar y sale uno nuevo.
 */
export async function obtenerTexto(token: string): Promise<TextoProvidencia | null> {
  const urlVisor = enlaceProvidencia(token)
  const r = await pedir(urlVisor, 90_000)
  if (r.status !== 200) return null

  // El visor recibe su configuración en un `init` con JSON literal; ahí viaja la
  // URL firmada. Se lee de ahí porque la URL del blob que aparece suelta en el
  // HTML va SIN firma y responde 409 PublicAccessNotPermitted.
  const m = r.cuerpo.match(/VerProvidenciaViewer\.init\([^,]+,\s*(\{[\s\S]*?\})\s*\)/)
  if (!m) return null
  let cfg: { url?: string; filename?: string; forceZip?: boolean }
  try {
    cfg = JSON.parse(m[1]!.replace(/\\u0026/g, '&')) as typeof cfg
  } catch {
    throw new CanarioError('el visor de SAMAI cambió el formato de su configuración')
  }
  if (!cfg.url) return null

  const fichero = cfg.filename ?? ''
  // Algunas actuaciones se sirven comprimidas o en otro formato. Decirlo vale
  // más que devolver basura: el enlace del visor sigue sirviendo para abrirlas.
  if (cfg.forceZip || !/\.pdf($|\?)/i.test(cfg.url)) {
    return { texto: '', paginas: 0, urlVisor, fichero }
  }

  const pdf = await pedirBytes(cfg.url, 120_000)
  if (pdf.status !== 200) return null

  // El extractor se carga en diferido: solo esta herramienta lo necesita y son
  // ~200 KB del bundle que ninguna otra consulta debería pagar al arrancar.
  //
  // Es `unpdf` —pdf.js— y no @llamaindex/liteparse, que era el doble de rápido
  // (417 ms frente a 884 en la misma sentencia de 36 páginas) y se descartó
  // igual: trae un binario NATIVO por plataforma, así que el .mcpb, que viaja
  // sin node_modules, respondía "Failed to load native module for win32-x64".
  // Comprobado ejecutando el servidor compilado en un directorio limpio. Este
  // proyecto ya había descartado antes una dependencia nativa, por lo mismo.
  const { extractText, getDocumentProxy } = await import('unpdf')
  const doc = await getDocumentProxy(new Uint8Array(pdf.datos))
  const { totalPages, text } = await extractText(doc, { mergePages: true })
  const texto = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return { texto, paginas: totalPages, urlVisor, fichero }
}
