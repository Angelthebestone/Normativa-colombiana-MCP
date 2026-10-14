import {
  cabecerasCondicionales,
  esDescargaCacheable,
  identidadDeNorma,
  ttlDeNorma,
  type Copia,
} from '../cache.ts'
import type { Copias } from '../cache/copias.ts'
import { diagnosticarRespuesta, rotuloCopia } from '../portal-roto.ts'
import { fechaBogota } from '../fecha.ts'
import { decodificar } from './decodificar.ts'
import { errorDegradado, type Disyuntor } from './disyuntor.ts'
import type { Metricas } from './metricas.ts'
import { pideCalma, type Reintento } from './reintento.ts'
import type { OpcionesPedir, Respuesta } from './tipos.ts'
import { crudo, TOPE_TEXTO, type Cruda } from './transporte.ts'

export type DepsPedir = { copias: Copias; disyuntor: Disyuntor; metricas: Metricas; reintento: Reintento }

/** TTL de la copia: el de la clase de norma, salvo que se fije por opción o seam. */
function ttlDe(url: string, texto: string, fecha: number, explicito?: number): number {
  if (explicito !== undefined) return explicito
  const bruto = process.env['TTL_COPIA_MS']
  const forzado = bruto === undefined ? Number.NaN : Number(bruto)
  if (Number.isFinite(forzado)) return forzado
  const ident = identidadDeNorma(url, texto.slice(0, 8000))
  return ttlDeNorma(ident.tipo, ident.anio, fecha)
}

/**
 * `pedir` y `pedirJson` sobre el estado de una instancia de red. Las peticiones
 * idénticas en vuelo se fusionan dentro de la instancia: dos instancias no se
 * fusionan entre sí.
 */
export function crearPedir({ copias, disyuntor, metricas, reintento }: DepsPedir) {
  const { guardarCopia, obtenerCopia, refrescarCopia } = copias
  const { anotarFallo, estadoDe, restablecer } = disyuntor
  const { anotarCopia, anotarRed, anotarUrl } = metricas
  const { conReintento, errorDeCalma } = reintento

  async function pedirUna(
    url: string,
    timeout = 60_000,
    accept = 'text/html,*/*',
    /** Cabeceras extra; hoy solo la `api-key` que exige el buscador de SUIN. */
    extra: Record<string, string> = {},
    /** Si viene, la petición es POST con este cuerpo JSON. */
    cuerpo?: string,
    opciones: OpcionesPedir = {},
  ): Promise<Respuesta> {
    const host = new URL(url).host
    const esGet = cuerpo === undefined
    anotarUrl(url)

    // La copia se mira antes que el breaker: si el texto ya está y sigue fresco,
    // no hay motivo para hablar con nadie.
    const copia = esGet ? obtenerCopia(url) : null
    const desdeCopia = (c: Copia, degradada: boolean, revalidada: boolean): Respuesta => {
      anotarCopia()
      return {
        status: c.status,
        cuerpo: c.cuerpo,
        cookies: '',
        cabeceras: c.cabeceras,
        deCache: true,
        ...(degradada ? { degradada: true } : {}),
        ...(revalidada ? { revalidada: true } : {}),
        fechaCopia: c.fecha,
        avisoCopia: degradada
          ? rotuloCopia(host, c.fecha)
          : `(servido de una copia consultada el ${fechaBogota(new Date(c.fecha))}, sin volver a la fuente)`,
      }
    }

    if (copia && Date.now() < copia.vence) return desdeCopia(copia, false, false)

    // Degradar es opt-in: el que sirve la copia es quien tiene que rotularla, y
    // `pedir` no puede saber si su llamador lo hará.
    const degradarO = (): Respuesta | null =>
      copia && opciones.degradarDesdeCopia ? desdeCopia(copia, true, false) : null

    // Fuente degradada: no se pega a la red, se declara el estado y cuándo
    // reintentar. Las excepciones del breaker no entran en el circuito de
    // reintentos por 429/503, que solo se alimenta de respuestas reales.
    const est = estadoDe(host)
    if (est.degradado) {
      const d = degradarO()
      if (d) return d
      throw errorDegradado(host, est.reintentaEnMs!, est.causa!)
    }

    const condicionales = copia ? cabecerasCondicionales(copia) : {}
    let r: Cruda
    try {
      r = await conReintento(
        url,
        () => crudo(url, timeout, accept, { ...extra, ...condicionales }, TOPE_TEXTO, cuerpo),
        Boolean(copia),
      )
    } catch (e) {
      const d = degradarO()
      if (d) return d
      throw e
    }

    // 304: la copia sigue vigente, y eso está comprobado, no supuesto. Se le
    // pone la fecha de hoy porque es la que el usuario va a leer; el cuerpo es
    // el mismo y por eso la respuesta no cambia.
    if (r.status === 304 && copia) {
      restablecer(host)
      anotarRed(0)
      const fecha = Date.now()
      refrescarCopia(url, fecha, fecha + ttlDe(url, copia.cuerpo, fecha, opciones.ttlMs))
      return desdeCopia({ ...copia, fecha }, false, true)
    }

    if (pideCalma(r.status)) {
      const e = errorDeCalma(host, r.status)
      const d = degradarO()
      if (d) return d
      throw e
    }

    const texto = decodificar(r.datos, r.contentType)
    // Un portal que se apunta a sí mismo (el 301 de SUIN) o que sirve su página
    // de mantenimiento no está respondiendo, aunque el código HTTP no lo diga:
    // cuenta para el breaker igual que un 5xx. La respuesta se devuelve tal cual
    // —la fuente decide qué hacer con un 301— pero el host queda marcado.
    const diag = diagnosticarRespuesta(url, r.status, r.cabeceras, texto)
    if (r.status >= 500 || diag.roto) {
      anotarFallo(host, r.status >= 500 ? `HTTP ${r.status}` : (diag.motivo ?? 'respuesta rota del portal'))
    } else {
      restablecer(host)
    }
    if (r.status >= 500) {
      const d = degradarO()
      if (d) return d
      throw new Error(`El portal respondió ${r.status}.`)
    }

    anotarRed(r.datos.length)
    const resp: Respuesta = { status: r.status, cuerpo: texto, cookies: r.cookies, cabeceras: r.cabeceras }

    // Solo se guardan documentos: congelar una búsqueda escondería lo que se
    // publique después.
    if (esGet && esDescargaCacheable(url, 'GET', r.contentType)) {
      const fecha = Date.now()
      if (copia && copia.cuerpo !== texto) resp.cambio = true
      guardarCopia(url, {
        cuerpo: texto,
        status: r.status,
        cabeceras: r.cabeceras,
        fecha,
        vence: fecha + ttlDe(url, texto, fecha, opciones.ttlMs),
      })
    }
    return resp
  }

  /**
   * Peticiones idénticas en vuelo: una sola sirve a todos los que la esperan.
   *
   * Un cliente que lanza dos llamadas a herramientas en paralelo sobre la misma
   * norma hacía que las dos miraran la copia —vacía, porque la primera aún no ha
   * vuelto— y se pusieran en cola detrás una de otra: el portal recibía la misma
   * descarga completa dos veces, la segunda un segundo más tarde por el ritmo del
   * host. Medido contra un servidor local: dos GET simultáneos a la misma URL = 2
   * golpes; tres = 3 golpes y 3 s. Con la fusión, 1 golpe.
   *
   * La clave es la llamada ENTERA (url, timeout, accept, cabeceras y opciones), no
   * solo la URL: dos llamadores con timeouts o con `degradarDesdeCopia` distintos
   * no piden lo mismo. Los POST no se fusionan, porque pueden cambiar algo al otro
   * lado. La entrada se borra al terminar, con éxito o con error, así que un fallo
   * no se queda pegado: la siguiente llamada vuelve a intentarlo.
   *
   * ponytail: solo GET de `pedir`; `pedirBytes` (los PDF) baja aparte y no se
   * fusiona. Si algún día se pone un techo de tiempo por llamada, la clave tiene
   * que incluirlo: no puede heredarse el del llamador que llegó primero.
   */
  const enVuelo = new Map<string, Promise<Respuesta>>()

  function pedir(
    url: string,
    timeout = 60_000,
    accept = 'text/html,*/*',
    extra: Record<string, string> = {},
    cuerpo?: string,
    opciones: OpcionesPedir = {},
  ): Promise<Respuesta> {
    if (cuerpo !== undefined) return pedirUna(url, timeout, accept, extra, cuerpo, opciones)
    const clave = JSON.stringify([url, timeout, accept, extra, opciones])
    const enCurso = enVuelo.get(clave)
    if (enCurso) return enCurso
    const p = pedirUna(url, timeout, accept, extra, cuerpo, opciones).finally(() => enVuelo.delete(clave))
    enVuelo.set(clave, p)
    return p
  }

  /**
   * POST de JSON y respuesta JSON, para las fuentes que hablan GraphQL. Comparte
   * el ritmo, la serialización por dominio y la cadena TLS de `pedir`.
   */
  async function pedirJson<T>(url: string, cuerpo: unknown, timeout = 40_000): Promise<T> {
    const r = await pedir(url, timeout, 'application/json', {}, JSON.stringify(cuerpo))
    // Un backend que responde 200 con una página de mantenimiento es real: la
    // Corte Suprema lo hace. Por eso se valida que sea JSON, no el código HTTP.
    try {
      return JSON.parse(r.cuerpo) as T
    } catch {
      throw new Error(`${new URL(url).host} respondió algo que no es JSON (estado ${r.status}).`)
    }
  }

  return { pedir, pedirJson }
}

export type Pedidor = ReturnType<typeof crearPedir>
