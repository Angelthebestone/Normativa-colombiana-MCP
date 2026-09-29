/**
 * Diario Oficial — Imprenta Nacional de Colombia (consulta pública).
 *
 * Es la fuente que dice QUÉ SE PUBLICÓ y CUÁNDO, y sirve para el hueco que deja
 * el Gestor Normativo: entre la publicación y su catalogación pasan días. El
 * Gestor tarda; esto está publicado el mismo día. Medido el 2026-09-28: el
 * diario 53.640, del 27/09/2026, ya estaba listado el 28/09.
 *
 * El portal es JSF + PrimeFaces sobre GlassFish 4.1.1 (Java 8), y la búsqueda
 * es un POST normal al `action` del formulario `frmConDiario`, no un ajax. Hay
 * que enviar el `javax.faces.ViewState` de la página y la cookie `JSESSIONID`,
 * así que cada llamada abre su propia sesión (GET + POST) y no guarda estado
 * entre llamadas: la primera versión reutilizaba el ViewState entre búsquedas y
 * el bean del portal arrastraba los filtros de la consulta anterior dentro de
 * la misma sesión (medido: un filtro por número de diario «contaminaba» las dos
 * búsquedas siguientes).
 *
 * Lo que se midió el 2026-09-28, y por qué el código es como es:
 *
 * - **Solo viaja el botón que se pulsa.** El formulario trae un botón por fila
 *   (`dtbDiariosOficiales:N:j_idt34`, «Ver Diario»). Si se envían todos —como
 *   haría quien copie los campos del formulario— el portal no busca: abre el
 *   detalle de la ÚLTIMA fila enviada. Se comprobó: la respuesta de 15.700 bytes
 *   era el detalle del diario 53.631, no la tabla. Por eso `leerFormulario`
 *   descarta los botones y `buscar` añade exactamente uno.
 * - **Filtran**: el número de diario (`numeroDiarioOf`), el rango de fechas
 *   (`fechaInicial_input`/`fechaFinal_input`, dd/MM/yyyy) y el tipo de norma
 *   JUNTO con el número (`tipoNorma_input` + `numeroNorma`) — es decir, «el
 *   diario que publicó la Ley 2466 de 2025» se resuelve y devuelve el 53.160
 *   (25/06/2025). Medido: LEY son 2.167 diarios, DECRETO 13.848, y
 *   DECRETO+1077 son 49.
 * - **No filtran**: `numeroNorma` sin tipo (medido: 2466 sin tipo devuelve los
 *   mismos 100 de la consulta sin filtro) ni `entidad_input` sin el id que
 *   resuelve su autocompletar (medido: «ZZZZQQQ» devuelve los mismos 100 que la
 *   consulta vacía). Los dos se descartan en vez de ofrecerse y no filtrar.
 * - **Sin filtro la tabla trae los últimos 100 diarios; con filtro busca en todo
 *   el archivo** (de ahí que LEY dé 2.167 filas).
 * - **La tabla es de 10 filas por página** y un POST normal devuelve siempre la
 *   primera (`dtbDiariosOficiales_rppDD` no cambia nada por esa vía, medido).
 *   Las siguientes se piden con el postback ajax del propio paginador, que SÍ
 *   respeta el filtro: la página 2 de LEY trae 53.444…53.254, la continuación
 *   de la página 1 (53.605…53.496).
 * - **El detalle de cada diario no se ofrece aquí.** «Ver Diario» es otro POST
 *   con la sesión, y el PDF del diario va en una URL de contenido dinámico de
 *   PrimeFaces (`dynamiccontent.properties.xhtml?pfdrid=…`) que SIN la cookie
 *   responde 404 (medido): no es un enlace citable, y para bajarlo haría falta
 *   mandar la cookie por `pedirBytes`, que hoy no admite cabeceras. Además pesa:
 *   2,8 MB el del 26/09 y 15 MB el del 23/09 (155 s de descarga, medido).
 *
 * ponytail: se reintenta UNA vez cuando el portal corta la conexión —pasó en ~1
 * de cada 10 peticiones medidas—, porque con dos peticiones por consulta la
 * probabilidad de fallo se dobla. El techo es que corte dos veces seguidas; el
 * salto, si eso importa, es reintentar en `http.ts` para todas las fuentes.
 */
import { CanarioError, cargar, colapsarEspacios } from '../nucleo/parse.ts'
import { pedir } from '../nucleo/http.ts'

export const BASE = 'https://svrpubindc.imprenta.gov.co/diario/index.xhtml'

/**
 * Valores del `<select name="tipoNorma_input">`, leídos del formulario el
 * 2026-09-28. Son los del propio portal y **no** son un catálogo de tipos
 * documentales legibles: «OTROS» es 9999 y «PROYECTO» es 2708.
 */
export const TIPOS = {
  ACTA: '10',
  ACUERDO: '16',
  AUTO: '17',
  AVISO: '15',
  CIRCULAR: '13',
  CONCEPTO: '08',
  CONTRATOS: '33',
  DECRETO: '02',
  DIRECTIVA: '07',
  EDICTO: '05',
  EXTRACTOS: '47',
  LEY: '01',
  'LICITACIÓN': '11',
  'OBJECIÓN': '06',
  OTROS: '9999',
  PROYECTO: '2708',
  'PROYECTO DE ACTO LEGISLATIVO': '39',
  'RESOLUCIÓN': '03',
  'RESOLUCIÓN EJECUTIVA': '04',
} as const
export type TipoNorma = keyof typeof TIPOS

export type Diario = {
  /** «53.640», como lo numera la Imprenta. */
  numero: string
  /** Ordinaria, Extraordinaria, Especial, Oficio o Tributario. */
  tipoEdicion: string
  /** dd/MM/yyyy, tal como lo sirve el portal. */
  fecha: string
}

/** Botones del formulario: se descartan del cuerpo y solo se añade el pulsado. */
const BOTONES = /^(?:btnBuscar|botonCancelarBuscar|dtbDiariosOficiales:\d+:j_idt34)$/

/**
 * Secciones de la rosca de reintento: fallos de conexión, no respuestas.
 * `aborted` es como Node reporta el corte a mitad del cuerpo.
 */
const CORTE = /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|aborted/i

/** Un reintento para los cortes de conexión del portal. */
async function conReintento<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (!(e instanceof Error) || !CORTE.test(e.message)) throw e
    return await fn()
  }
}

/**
 * Campos del formulario y `action` de la página. Lanza canario si el portal
 * dejó de traer el formulario o la tabla: sin ellos no hay consulta posible, y
 * una tabla vacía se leería como «no se publicó nada».
 */
export function leerFormulario(html: string): { action: string; campos: Record<string, string> } {
  const $ = cargar(html)
  const $form = $('form#frmConDiario')
  if (!$form.length) throw new CanarioError('la consulta del Diario Oficial ya no trae el formulario frmConDiario')
  if (!$('#dtbDiariosOficiales').length) {
    throw new CanarioError('la consulta del Diario Oficial ya no trae la tabla dtbDiariosOficiales')
  }

  const campos: Record<string, string> = {}
  $form.find('[name]').each((_, el) => {
    const $el = $(el)
    const nombre = $el.attr('name')
    if (!nombre || BOTONES.test(nombre)) return
    // Un <select> viaja con el valor de su opción marcada, no con el del atributo.
    campos[nombre] =
      el.tagName === 'select'
        ? ($el.find('option[selected]').first().attr('value') ?? $el.find('option').first().attr('value') ?? '')
        : ($el.attr('value') ?? '')
  })
  return { action: $form.attr('action') ?? '', campos }
}

/** El `javax.faces.ViewState` de una respuesta: es lo que ata la petición a la vista. */
export function viewStateDe(html: string): string {
  return cargar(html)('input[name="javax.faces.ViewState"]').first().attr('value') ?? ''
}

/** Las tres columnas de cada fila, leídas por el id de su etiqueta y no por posición. */
function filasDeLaTabla(html: string): Diario[] {
  const $ = cargar(html)
  const items: Diario[] = []
  $('tr[data-ri]').each((_, tr) => {
    const $tr = $(tr)
    const campo = (sufijo: string): string => colapsarEspacios($tr.find(`label[id$=":${sufijo}"]`).first().text())
    const numero = campo('numeroDiario')
    if (!numero) return
    items.push({ numero, tipoEdicion: campo('tipoEdicion'), fecha: campo('fechaDiario') })
  })
  return items
}

/** Total declarado por el paginador («Registro 1 a 10 de 100»), o -1 si no está. */
function totalDeclarado(html: string): number {
  const texto = colapsarEspacios(cargar(html)('[id$="dtbDiariosOficiales_paginator_top"] .ui-paginator-current').first().text())
  const m = texto.match(/de\s+([\d.]+)/)
  return m ? Number(m[1]!.replace(/\./g, '')) : -1
}

/**
 * Página completa de resultados. El canario mira la forma: sin paginador la
 * respuesta no es la página de resultados, y con filas declaradas pero ninguna
 * legible el fallo es del parseo — que es el caso traicionero, porque parece
 * «no hay nada».
 */
export function leerPagina(html: string): { items: Diario[]; total: number } {
  if (!cargar(html)('#dtbDiariosOficiales').length) {
    throw new CanarioError('la respuesta del Diario Oficial ya no trae la tabla dtbDiariosOficiales')
  }
  const total = totalDeclarado(html)
  if (total < 0) throw new CanarioError('la respuesta del Diario Oficial ya no trae el paginador de la tabla')
  const items = filasDeLaTabla(html)
  if (total > 0 && !items.length) {
    throw new CanarioError(
      `el Diario Oficial dice tener ${total} registro(s) pero no se pudo leer ninguna fila (cambiaron las etiquetas de la tabla)`,
    )
  }
  return { items, total }
}

/**
 * Filas de una página siguiente, que llegan dentro del `partial-response` del
 * paginador. No trae paginador propio: el total se conserva del primero.
 */
export function leerParcial(xml: string): Diario[] {
  const m = xml.match(/<update id="dtbDiariosOficiales"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)
  if (!m) throw new CanarioError('el paginador del Diario Oficial ya no devuelve el fragmento de la tabla')
  return filasDeLaTabla(m[1]!)
}

export type Opciones = {
  /** Número de diario, «53.640». Identifica uno solo. */
  numero?: string | undefined
  /** Fecha inicial dd/MM/yyyy. */
  desde?: string | undefined
  /** Fecha final dd/MM/yyyy. */
  hasta?: string | undefined
  /** Tipo de norma; solo filtra si va acompañado de `numeroNorma`. */
  tipo?: TipoNorma | undefined
  /** Número de la norma (sin el año). Con `tipo`, encuentra el diario que la publicó. */
  numeroNorma?: string | undefined
  /** Cuántos diarios devolver; el portal sirve de 10 en 10. */
  limite?: number | undefined
}

export type Resultado = { items: Diario[]; total: number }

/** Filas por página del portal: no se puede pedir otra cosa (medido). */
const POR_PAGINA = 10
/** Tope de filas por llamada: cinco páginas, cinco peticiones extras como mucho. */
export const MAXIMO = 50

/**
 * Envía una fecha como la espera el portal. Acepta `dd/MM/yyyy` y `yyyy-mm-dd`
 * (lo que teclea quien pregunta) y devuelve null si no es ninguna de las dos:
 * mandarle una fecha inventada al portal devolvería un vacío que se leería como
 * «no hay diarios», que es justo el error que este módulo existe para evitar.
 */
export function fechaPortal(s: string): string | null {
  const t = s.trim()
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const dmy = iso ? null : t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!iso && !dmy) return null
  const dia = Number(iso ? iso[3] : dmy![1])
  const mes = Number(iso ? iso[2] : dmy![2])
  const anio = Number(iso ? iso[1] : dmy![3])
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || anio < 1900 || anio > 2200) return null
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`
}

/**
 * Busca diarios publicados. Abre sesión nueva en cada llamada: el ViewState y
 * la cookie valen para esta petición y no se guardan (ver la cabecera).
 *
 * `deps.pedir` es inyectable para probar sin red, como en el resto del repo.
 */
export async function buscar(opts: Opciones, deps: { pedir?: typeof pedir } = {}): Promise<Resultado> {
  const pedirHttp = deps.pedir ?? pedir

  const r0 = await conReintento(() => pedirHttp(BASE, 60_000))
  if (r0.status !== 200) {
    throw new Error(
      `La consulta del Diario Oficial respondió ${r0.status}. ` +
        (r0.status >= 500 ? 'Es el portal de la Imprenta, no la plantilla: vuelve a intentarlo.' : ''),
    )
  }
  const { action, campos } = leerFormulario(r0.cuerpo)
  const url = new URL(action, BASE).toString()

  const filtros: Record<string, string> = {}
  if (opts.numero?.trim()) filtros['numeroDiarioOf'] = opts.numero.trim()
  if (opts.desde) filtros['fechaInicial_input'] = opts.desde
  if (opts.hasta) filtros['fechaFinal_input'] = opts.hasta
  if (opts.tipo) filtros['tipoNorma_input'] = TIPOS[opts.tipo]
  if (opts.numeroNorma?.trim()) filtros['numeroNorma'] = opts.numeroNorma.trim()

  const r1 = await conReintento(() =>
    pedirHttp(
      url,
      60_000,
      'text/html,*/*',
      { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: r0.cookies },
      new URLSearchParams({ ...campos, ...filtros, btnBuscar: '' }).toString(),
    ),
  )
  if (r1.status !== 200) {
    throw new Error(`La búsqueda en el Diario Oficial respondió ${r1.status}.`)
  }
  const { items, total } = leerPagina(r1.cuerpo)

  const limite = Math.min(Math.max(Math.trunc(opts.limite ?? 20), 1), MAXIMO)
  const objetivo = Math.min(limite, total)
  const salida = [...items]
  const viewState = viewStateDe(r1.cuerpo)

  // Páginas siguientes por el postback ajax del paginador, que conserva el
  // filtro. Se pide de 10 en 10 porque es lo que el portal sirve.
  for (let first = POR_PAGINA; salida.length < objetivo && first < total; first += POR_PAGINA) {
    const r = await conReintento(() =>
      pedirHttp(
        url,
        60_000,
        'text/xml,*/*',
        {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Cookie: r0.cookies,
          'Faces-Request': 'partial/ajax',
          'X-Requested-With': 'XMLHttpRequest',
        },
        new URLSearchParams({
          ...campos,
          ...filtros,
          'javax.faces.ViewState': viewState,
          'javax.faces.partial.ajax': 'true',
          'javax.faces.source': 'dtbDiariosOficiales',
          'javax.faces.partial.execute': 'dtbDiariosOficiales',
          'javax.faces.partial.render': 'dtbDiariosOficiales',
          'javax.faces.behavior.event': 'page',
          'javax.faces.partial.event': 'page',
          dtbDiariosOficiales_pagination: 'true',
          dtbDiariosOficiales_first: String(first),
          dtbDiariosOficiales_rows: String(POR_PAGINA),
          dtbDiariosOficiales_skipChildren: 'true',
          dtbDiariosOficiales_encodeFeature: 'true',
          dtbDiariosOficiales: 'dtbDiariosOficiales',
        }).toString(),
      ),
    )
    if (r.status !== 200) throw new Error(`El paginador del Diario Oficial respondió ${r.status}.`)
    const mas = leerParcial(r.cuerpo)
    if (!mas.length) break
    salida.push(...mas)
  }

  return { items: salida, total }
}
