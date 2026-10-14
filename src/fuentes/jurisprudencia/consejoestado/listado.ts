import * as cheerio from 'cheerio/slim'
import { colapsarEspacios } from '../../../nucleo/parse.ts'
import { BASE, RUTA } from './enlaces.ts'
import type { Providencia, Titulacion } from './providencia.ts'

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
export const RAIZ = 'ContentPlaceHolder1_ResultadoBusqueda1_TitulacionesRepeater_'

export function parsear(html: string, limite: number, urlBusqueda: string): { paginas: number; items: Providencia[] } {
  const $ = cheerio.load(html)
  const campoDe = (nombre: string, n: number): string => colapsarEspacios($(`[id="${RAIZ}${nombre}_${n}"]`).first().text())

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
      const problema = colapsarEspacios($(el).text()).replace(/^Problema jur[íi]dico:\s*/i, '')
      if (!problema) return
      const respuesta = colapsarEspacios($(`[id="${base}SeResuelveProblemaJuridicoLabel_${suf}"]`).text()).replace(
        /^Respuesta al problema jur[íi]dico:\s*/i,
        '',
      )
      const nota = colapsarEspacios($(`[id="${base}NotaRelatoriaLabel_${suf}"]`).text()).replace(/^NOTA DE RELATOR[ÍI]A:\s*/i, '')
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

  const pag = colapsarEspacios($('[id$="PaginaActualLabel"]').first().text()).match(/de\s+([\d.,]+)/i)?.[1] ?? ''
  return { paginas: pag ? Number(pag.replace(/[.,]/g, '')) : -1, items }
}
