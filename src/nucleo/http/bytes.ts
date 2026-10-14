import { errorDegradado, type Disyuntor } from './disyuntor.ts'
import type { Metricas } from './metricas.ts'
import { pideCalma, type Reintento } from './reintento.ts'
import { crudo, TOPE_BINARIO, TopeExcedido, type Cruda } from './transporte.ts'

/** `pedirBytes` sobre el estado de una instancia de red. */
export function crearPedirBytes({
  disyuntor,
  metricas,
  reintento,
}: {
  disyuntor: Disyuntor
  metricas: Metricas
  reintento: Reintento
}) {
  const { anotarFallo, estadoDe, restablecer } = disyuntor
  const { anotarRed } = metricas
  const { conReintento, errorDeCalma } = reintento

  /**
   * Los mismos bytes, sin decodificar. Existe para los PDF: pasarlos por
   * `decodificar` los destruye —es texto lo que espera— y bajarlos con un `fetch`
   * suelto se salta el ritmo por dominio, los reintentos y la cadena de
   * certificados que este módulo aporta.
   */
  async function pedirBytes(
    url: string,
    timeout = 90_000,
    accept = 'application/pdf,*/*',
  ): Promise<{ status: number; datos: Buffer; contentType: string }> {
    const host = new URL(url).host
    const est = estadoDe(host)
    if (est.degradado) throw errorDegradado(host, est.reintentaEnMs!, est.causa!)
    let r: Cruda
    try {
      r = await conReintento(url, () => crudo(url, timeout, accept, {}, TOPE_BINARIO))
    } catch (e) {
      // Fallo de red (no una respuesta): cuenta para el breaker. Pasar el tope no:
      // el host respondió, solo que mandó demasiado.
      if (!(e instanceof TopeExcedido)) anotarFallo(host, e instanceof Error ? e.message : String(e))
      throw e
    }
    if (pideCalma(r.status)) throw errorDeCalma(host, r.status)
    if (r.status >= 500) anotarFallo(host, `HTTP ${r.status}`)
    else restablecer(host)
    anotarRed(r.datos.length)
    return { status: r.status, datos: r.datos, contentType: r.contentType }
  }

  return pedirBytes
}
