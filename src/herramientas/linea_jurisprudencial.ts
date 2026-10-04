/**
 * `linea_jurisprudencial`: las providencias que la relatoría registra como
 * CITANTES de una sentencia de la Corte Constitucional.
 *
 * La premisa del banco de ideas —«jurisprudencia relacionada» en la ficha— se
 * comprobó leyendo los bundles de Angular del portal (2026-09-28): la página
 * `ficha-sentencia/<prov_id>/…` pide `accion=ver_modal_detalle_providencia` y su
 * respuesta trae el bloque `citaciones` —«La providencia ha sido citada en N
 * providencias», dice su propia interfaz— con sentencia, tipo, fecha, tema y
 * ruta de cada citante. Ese bloque es la vía. El buscador de texto completo NO
 * sirve para esto, medido el mismo día: «C-337/11» devuelve 2 providencias (la
 * propia y una que la escribe con barra) mientras la ficha registra 12, y de los
 * 10 primeros aciertos de «SU-371 de 2021» 9 no la mencionan en su texto (son
 * autos de seguimiento).
 *
 * ponytail: el cliente de esa acción vive aquí y no en `corte.ts` porque este
 * encargo no toca `src/fuentes/**`; si otra herramienta necesita la ficha, el
 * salto es mover `citantesDe` a `corte.ts`, junto a `verificar`.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { pedir as http } from '../nucleo/http.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'

const BASE = 'https://www.corteconstitucional.gov.co/relatoria'
const BUSCADOR = `${BASE}/buscador_new/?`

/** El portal topa su relación de citaciones en 100 (medido: C-055/22, total 100). */
const TOPE_PORTAL = 100

export const TITULO = 'Línea jurisprudencial: quién cita una sentencia'

export const DESCRIPCION =
  'Devuelve las providencias que la relatoría registra como CITANTES de una sentencia de la Corte ' +
  'Constitucional (el bloque "citaciones" de su ficha oficial), con tipo, fecha, tema, la ruta para ' +
  'obtener_documento y el enlace. Son citas, no una línea verificada: mencionar no es reiterar y la relación ' +
  'puede estar incompleta. Se ordenan con las SU y las C en cabeza ANTES de aplicar limite, así que un limite ' +
  'bajo deja fuera primero las T y los autos; el portal no registra más de 100 y no hay paginación. ' +
  'Úsala cuando ya tienes ' +
  'la sentencia y quieres saber quién la cita. Para encontrar sentencias sobre un tema usa ' +
  'buscar_jurisprudencia; para leer o verificar la propia sentencia citada, resolver_cita. Solo cubre la ' +
  'Corte Constitucional.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  sentencia: z.string().describe('Cita de la sentencia, ej. "C-337/11", "T-099/24" o "SU-371/21"'),
  limite: z.coerce.number().int().min(1).max(100).default(20).describe('Cuántas providencias citantes mostrar (hasta 100)'),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export type CitaRelacionada = {
  sentencia: string
  tipo: string
  fecha: string
  tema: string
  /** Ruta de la relatoría, la que acepta obtener_documento con fuente="corte". */
  ruta: string
  url: string
}

export type Citaciones = {
  /** Cuántas registra la relatoría (su conteo; `items` puede no traerlas todas). */
  total: number
  items: CitaRelacionada[]
}

type FuenteCitacion = {
  prov_sentencia?: string
  prov_tipo?: string
  prov_f_sentencia?: string
  prov_tema?: string
  rutahtml?: string
}

type RespuestaFicha = {
  citaciones?: { hits?: { total?: { value?: number }; hits?: { _source?: FuenteCitacion }[] } }
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/** El JSON puede venir precedido de HTML; se extrae el objeto, como en corte.ts. */
function extraerJson(bruto: string): RespuestaFicha | null {
  const inicio = bruto.search(/[{[]/)
  if (inicio === -1) return null
  const final = bruto.lastIndexOf(bruto[inicio] === '{' ? '}' : ']')
  if (final <= inicio) return null
  try {
    return JSON.parse(bruto.slice(inicio, final + 1)) as RespuestaFicha
  } catch {
    return null
  }
}

/**
 * El bloque `citaciones` de la ficha: quién cita esta providencia, según la
 * relación que mantiene la relatoría. Un `prov_id` inexistente no da 404:
 * devuelve una alerta HTML, así que la ausencia del bloque se declara como
 * «no se pudo leer», nunca como «no la citan».
 */
export async function citantesDe(provId: string): Promise<Citaciones> {
  const url = `${BUSCADOR}&prov_id=${encodeURIComponent(provId)}&buscar_por=&searchOption=&accion=ver_modal_detalle_providencia&tipo=json`
  let res: Awaited<ReturnType<typeof http>>
  try {
    res = await http(url, 40_000, 'application/json,text/html,*/*')
  } catch (e) {
    throw new Error(`No se pudo contactar la relatoría de la Corte Constitucional (${(e as Error).message}).`)
  }
  if (res.status !== 200) throw new Error(`La relatoría de la Corte respondió ${res.status}.`)
  const bloque = extraerJson(res.cuerpo)?.citaciones?.hits
  if (!bloque) {
    throw new Error(
      `La relatoría no devolvió la relación de citaciones de la providencia ${provId} (respuesta sin el bloque ` +
        `esperado). No se puede afirmar que nadie la cite.`,
    )
  }
  const items = (bloque.hits ?? []).map((h) => {
    const s = h._source ?? {}
    const ruta = texto(s.rutahtml)
    return {
      sentencia: texto(s.prov_sentencia),
      tipo: texto(s.prov_tipo),
      fecha: texto(s.prov_f_sentencia),
      tema: texto(s.prov_tema),
      ruta,
      url: ruta ? `${BASE}/${ruta}` : '',
    }
  })
  return { total: typeof bloque.total?.value === 'number' ? bloque.total.value : items.length, items }
}

/**
 * SU y C en cabeza; dentro de cada grupo, la más reciente primero. Es solo
 * orden de presentación: no dice nada sobre lo que cada providencia hizo.
 */
export function ordenarCitantes(items: CitaRelacionada[]): CitaRelacionada[] {
  const rango = (s: string): number => (/^SU/i.test(s) ? 0 : /^C/i.test(s) ? 1 : 2)
  return [...items].sort(
    (a, b) => rango(a.sentencia) - rango(b.sentencia) || b.fecha.localeCompare(a.fecha) || a.sentencia.localeCompare(b.sentencia),
  )
}

/**
 * Las advertencias que la respuesta lleva SIEMPRE. Sin ellas la lista se lee
 * como una línea jurisprudencial verificada, y no lo es: es una relación de
 * citas.
 */
const ADVERTENCIAS =
  'Advertencias (siempre, léelas antes de concluir):\n' +
  '- Que una providencia la mencione o la cite NO es que la reitere ni que la respete: se cita también para ' +
  'apartarse de ella, criticarla o distinguirla, y esta lista no dice qué hizo ninguna.\n' +
  '- La relación es la que mantiene la propia relatoría en su ficha; puede estar incompleta y no incluye todo lo ' +
  'que menciona la sentencia.\n' +
  '- Que una SU posterior sobre la misma materia la haya reiterado o superado NO se puede deducir de esta lista: ' +
  'hay que leer la providencia.'

/** Formatea la identificación de la sentencia base, tal como la da la relatoría. */
function identificacion(base: corte.Providencia): string {
  return [
    `${base.sentencia} — ${base.tipo || '(sin tipo)'}, ${base.fecha || '(sin fecha)'}`,
    `Ponente(s): ${base.magistrados.length ? base.magistrados.join('; ') : '(la relatoría no los lista en la ficha)'}`,
    base.tema ? `Tema: ${base.tema.slice(0, 220)}${base.tema.length > 220 ? '…' : ''}` : '',
    base.ruta ? `ruta: ${base.ruta}` : '',
    base.url,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Formatea la respuesta. Exportada para probarla sin red con fixtures. */
export function formatearLinea(base: corte.Providencia, cit: Citaciones, limite: number): string {
  const cab = identificacion(base)
  if (!cit.items.length) {
    return (
      `${cab}\n\n` +
      `La relatoría no registra providencias que la citen: su relación de citaciones está vacía (conteo del ` +
      `portal: ${cit.total}). Eso no prueba que nadie la haya mencionado, solo que su relación no lo registra.\n\n` +
      ADVERTENCIAS
    )
  }

  const mostradas = ordenarCitantes(cit.items).slice(0, limite)
  const faltan = Math.max(0, cit.total - mostradas.length)
  const recorte = faltan > 0 ? ` Quedan ${faltan}: repite con limite=${Math.min(cit.total, TOPE_PORTAL)}.` : ''
  const tope =
    cit.total >= TOPE_PORTAL ? ` El portal topa su relación en ${TOPE_PORTAL}: puede haber más citantes que no se listan.` : ''
  const recuento =
    `La relatoría registra ${cit.total} providencia(s) que la citan; se muestran ${mostradas.length}, con las SU y ` +
    `las C en cabeza y, dentro de cada grupo, la más reciente primero.${recorte}${tope}`

  const lista = mostradas
    .map((c) => {
      const tema = c.tema ? `\n  ${c.tema.slice(0, 220)}${c.tema.length > 220 ? '…' : ''}` : ''
      return `- ${c.sentencia} (${c.tipo || 'sin tipo'}, ${c.fecha || 'sin fecha'})${tema}\n  ruta: ${c.ruta || '(sin ruta en la ficha)'}\n  ${c.url}`
    })
    .join('\n')

  return (
    `${cab}\n\n${recuento}\n\n${lista}\n\n${ADVERTENCIAS}\n\n` +
    `Para leer cualquiera de ellas usa obtener_documento con fuente="corte" y su ruta.`
  )
}

/**
 * Dependencias inyectables para probar sin red: el servidor llama sin ellas.
 */
export type Deps = {
  /** Identificación de la sentencia (por defecto: `corte.verificar`, que ya sondea las tres formas del número). */
  identificar?: (sentencia: string) => Promise<corte.VerificacionSentencia>
  citantes?: (provId: string) => Promise<Citaciones>
}

export async function escribir({ sentencia, limite }: Params, deps: Deps = {}): Promise<string> {
  const v = await (deps.identificar ?? corte.verificar)(sentencia)
  if (v.estado === 'no-medido') {
    // El motivo viene del error de la fuente y ya trae su punto; se normaliza
    // para que el mensaje no dependa de eso.
    const motivo = (v.motivo ?? 'la fuente no respondió').trim()
    return (
      `${alcance([{ clave: 'corte', detalle: 'falló' }])}\n\n` +
      `No pude medir si «${sentencia}» está en la relatoría: ${motivo.endsWith('.') ? motivo : `${motivo}.`} ` +
      `Es un FALLO de la fuente, no una negativa: vuelve a intentarlo.`
    )
  }
  if (v.estado === 'no-existe' || !v.providencia) {
    return (
      `${alcance([{ clave: 'corte', detalle: `${v.sondeos.length} sondeo(s)` }])}\n\n` +
      `No encontré «${sentencia}» en la relatoría (probé: ${v.sondeos.join(', ')}). No significa que no exista: ` +
      `puede estar sin indexar o citarse de otra forma; búscala con buscar_jurisprudencia.`
    )
  }
  const base = v.providencia
  const cit = await (deps.citantes ?? citantesDe)(base.id)
  return `${alcance([{ clave: 'corte', detalle: `${cit.total} citante(s)` }])}\n\n${formatearLinea(base, cit, limite)}`
}
