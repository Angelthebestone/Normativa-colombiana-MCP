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
import { CanarioError, limpiarTermino } from '../parse.ts'
import { pedir } from '../http.ts'

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
}

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

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
    items.push({
      radicado,
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
): Promise<{ paginas: number; pagina: number; items: Providencia[]; url: string }> {
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
  return { ...res, pagina: n, url }
}
