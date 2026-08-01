/**
 * Consejo de Estado — SAMAI, buscador de providencias tituladas.
 *
 * Es la tercera alta corte y la única que no tiene API. Su buscador es ASP.NET
 * WebForms: no hay JSON que pedir, hay que enviar el formulario. Lo que se
 * documenta aquí es lo que costó averiguar, porque nada de esto es evidente:
 *
 * - **La búsqueda NO es un botón.** Es un LinkButton que dispara
 *   `__doPostBack('ctl00$MainContent$BusquedaRapidaLinkButton')`. Mandar el
 *   formulario sin ese `__EVENTTARGET` devuelve 200 y la misma página, sin
 *   buscar nada: se parece tanto a "no hay resultados" que cuesta un rato ver
 *   que la petición nunca llegó a ser una búsqueda.
 * - **No hay asistente de tres pasos.** Las pestañas son `slideUp/slideDown`
 *   en el navegador; todos los campos viven en el mismo formulario y basta una
 *   petición.
 * - **El `__VIEWSTATE` inicial se reutiliza** entre búsquedas distintas, así
 *   que el formulario se pide una vez por proceso y las consultas siguientes
 *   cuestan una sola petición.
 *
 * ponytail: el canario cuenta radicados, nunca mira el código HTTP. Aquí un
 * 200 no significa nada —la página de error, la sesión caducada y el postback
 * mal formado responden todos 200 con HTML—, y devolver vacío en silencio se
 * leería como "no existe esa sentencia".
 */
import * as cheerio from 'cheerio/slim'
import { CanarioError } from '../parse.ts'
import { pedir } from '../http.ts'

const BASE = 'https://samai.consejodeestado.gov.co'
const RUTA = '/TitulacionRelatoria/BuscadorProvidenciasTituladas.aspx'
const BOTON = 'ctl00$MainContent$BusquedaRapidaLinkButton'

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
  url: string
}

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Campo oculto del formulario, tal como lo escribe ASP.NET. */
const oculto = (html: string, nombre: string): string =>
  html.match(new RegExp(`id="${nombre}"[^>]*value="([^"]*)"`))?.[1] ?? ''

type Formulario = { viewstate: string; generator: string; validation: string; cookie: string }
let formulario: Formulario | null = null

async function cargarFormulario(): Promise<Formulario> {
  if (formulario) return formulario
  const r = await pedir(`${BASE}${RUTA}`, 90_000)
  if (r.status !== 200) throw new CanarioError(`SAMAI respondió ${r.status} al pedir el formulario`)
  const f = {
    viewstate: oculto(r.cuerpo, '__VIEWSTATE'),
    generator: oculto(r.cuerpo, '__VIEWSTATEGENERATOR'),
    validation: oculto(r.cuerpo, '__EVENTVALIDATION'),
    cookie: r.cookies ?? '',
  }
  if (!f.viewstate || !f.validation) {
    throw new CanarioError('el formulario de SAMAI no trae __VIEWSTATE o __EVENTVALIDATION')
  }
  formulario = f
  return f
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
const RAIZ = 'MainContent_ResultadoBusqueda1_TitulacionesRepeater_'

function parsear(html: string, limite: number): { paginas: number; items: Providencia[] } {
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

    items.push({
      radicado,
      fecha: campoDe('LblFECHAPROC', n),
      ponente: campoDe('LblPonente', n),
      sala: campoDe('LbNombreSalaDecision', n),
      clase: campoDe('LblClaseProceso', n),
      actor: campoDe('LblActor', n),
      demandado: campoDe('LblDemandado', n),
      titulaciones: titulaciones.slice(0, 4),
      url: `${BASE}${RUTA}`,
    })
  }

  const pag = limpio($('[id$="PaginaActualLabel"]').first().text()).match(/de\s+([\d.,]+)/i)?.[1] ?? '0'
  return { paginas: Number(pag.replace(/[.,]/g, '')) || 0, items }
}

export async function buscar(texto: string, limite = 5): Promise<{ paginas: number; items: Providencia[] }> {
  const q = texto.trim()
  if (!q) throw new Error('Indica un término para buscar en el Consejo de Estado.')

  const f = await cargarFormulario()
  const cuerpo = new URLSearchParams({
    __EVENTTARGET: BOTON,
    __EVENTARGUMENT: '',
    __VIEWSTATE: f.viewstate,
    __VIEWSTATEGENERATOR: f.generator,
    __EVENTVALIDATION: f.validation,
    'ctl00$MainContent$BusquedaRapidaTextBox': q,
  }).toString()

  const cabeceras: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (f.cookie) cabeceras['Cookie'] = f.cookie
  const r = await pedir(`${BASE}${RUTA}`, 120_000, 'text/html', cabeceras, cuerpo)
  const res = parsear(r.cuerpo, Math.min(Math.max(limite, 1), 9))

  // Un 200 no prueba nada en WebForms, así que el canario mira el contenido.
  // Dos fallos distintos, y ninguno puede devolver una lista vacía en silencio:
  if (!res.items.length) {
    formulario = null // el estado pudo caducar; que la próxima lo repita
    if (!res.paginas) {
      throw new CanarioError('SAMAI respondió sin providencias ni paginación: el postback no llegó a ser una búsqueda')
    }
    // Este es el caso traicionero: el buscador SÍ buscó —hay paginación— pero no
    // se pudo leer ninguna fila. Es un cambio de marcado, no un "no hay nada".
    throw new CanarioError(
      `SAMAI dice tener ${res.paginas} página(s) de resultados pero no se pudo leer ninguna providencia ` +
        `(los identificadores del repetidor cambiaron)`,
    )
  }
  return res
}
