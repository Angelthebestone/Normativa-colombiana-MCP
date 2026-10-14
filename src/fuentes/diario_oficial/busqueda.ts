import { pedir } from '../../nucleo/http.ts'
import { leerFormulario, viewStateDe } from './formulario.ts'
import { BASE, MAXIMO, POR_PAGINA, TIPOS, type Opciones, type Resultado } from './portal.ts'
import { leerPagina, leerParcial } from './tabla.ts'

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

  // El portal sirve de 10 en 10: la última página puede pasarse del límite.
  return { items: salida.slice(0, limite), total }
}
