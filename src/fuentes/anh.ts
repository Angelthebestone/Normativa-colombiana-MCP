/**
 * ANH — Agencia Nacional de Hidrocarburos.
 *
 * La fuente más sencilla de todo este MCP: un formulario GET sobre la propia
 * página de listado, sin POST, sin estado de sesión, sin JavaScript y con la
 * tabla de resultados servida ya renderizada. Después de SAMAI, un descanso.
 *
 * Lo que hay que saber, todo medido:
 *
 * - **785 documentos exactos**: la paginación llega a `page=40` y la última
 *   trae 5 filas (39 × 20 + 5).
 * - **Dos de cada tres son actos de personal.** De 60 filas muestreadas, 40 son
 *   nombramientos y encargos de la categoría «Administrativo». Cada fila declara
 *   su categoría, así que se pueden apartar; el `<select name="sector">` del
 *   formulario viene VACÍO, sin opciones, de modo que ese filtro hay que
 *   aplicarlo aquí y no en el portal.
 * - **Los documentos son PDF**, así que no hay texto que extraer: se entrega el
 *   epígrafe —que es largo y sustancioso— y los dos enlaces de cada fila.
 */
import { CanarioError, cargar, sinTildes } from '../nucleo/parse.ts'
import { pedir } from '../nucleo/http.ts'

const BASE = 'https://www.anh.gov.co'
const RUTA = '/es/normatividad2/normatividad/'

/** Valores del `<select name="type">` del propio formulario. */
export const TIPOS = {
  'Acto Legislativo': '9',
  Acuerdo: '10',
  Circular: '11',
  Decreto: '12',
  Ley: '13',
  Resolución: '14',
} as const
export type TipoAnh = keyof typeof TIPOS

export type DocumentoAnh = {
  tipo: string
  numero: string
  fecha: string
  epigrafe: string
  /** «Administrativo», «Contratos de hidrocarburos», «Regalías»… */
  categoria: string
  urlPdf: string
  urlFicha: string
}

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** La categoría con la que la ANH marca lo que no es regulación, sino planta de personal. */
export const ES_ADMINISTRATIVO = (categoria: string): boolean => /^administrativo$/i.test(sinTildes(categoria).trim())

export async function buscar(opts: {
  texto?: string | undefined
  tipo?: TipoAnh | undefined
  numero?: string | undefined
  desde?: string | undefined
  hasta?: string | undefined
  pagina?: number | undefined
}): Promise<{ pagina: number; items: DocumentoAnh[]; url: string }> {
  const p = new URLSearchParams()
  if (opts.tipo) p.set('type', TIPOS[opts.tipo])
  if (opts.numero) p.set('number', String(opts.numero).replace(/\D/g, ''))
  if (opts.texto?.trim()) p.set('keyword', opts.texto.trim())
  if (opts.desde) p.set('start_date', opts.desde)
  if (opts.hasta) p.set('end_date', opts.hasta)
  const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
  p.set('page', String(pagina))

  const url = `${BASE}${RUTA}?${p}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`El portal de la ANH respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  const filas = $('tbody tr')
  // El formulario tiene que seguir ahí aunque no haya resultados: si desaparece,
  // es que la página cambió y un vacío se leería como "no hay normativa".
  if (!filas.length && !/name="keyword"/.test(r.cuerpo)) {
    throw new CanarioError('la página de normatividad de la ANH ya no trae su formulario de búsqueda')
  }

  const items: DocumentoAnh[] = []
  filas.each((_, tr) => {
    const $tr = $(tr)
    const celdas = $tr.find('td').map((__, td) => limpio($(td).text())).get()
    const pdf = $tr.find('a[href$=".pdf"]').first().attr('href') ?? ''
    const ficha = $tr.find('a[title="Detalle"], a[href*="/normatividad2/normatividad/"]').last().attr('href') ?? ''
    // La categoría va dentro de la celda del epígrafe, tras «Disponible en:».
    const categoria = limpio($tr.text().match(/Disponible en:\s*([^]{0,80}?)\s*Acciones/)?.[1] ?? '')
    const epigrafe = limpio($tr.find('.block-paragraph').text()) || celdas[4] || ''
    if (!celdas[1] && !epigrafe) return
    items.push({
      tipo: celdas[1] ?? '',
      numero: celdas[2] ?? '',
      fecha: celdas[3] ?? '',
      epigrafe,
      categoria,
      urlPdf: pdf ? new URL(pdf, BASE).toString() : '',
      urlFicha: ficha ? new URL(ficha, BASE).toString() : url,
    })
  })

  return { pagina, items, url }
}
