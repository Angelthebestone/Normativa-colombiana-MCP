/** `obtener_documento` con las tres cortes: una providencia con estructura, sección y pasajes rotulados. */
import { etiquetaEn, ENCABEZADO_PROVIDENCIA, mapaDeSecciones, seccion as seccionDe, seccionesPresentes } from '../../nucleo/parse/secciones.ts'
import { trocear } from '../../nucleo/parse/fragmentos.ts'
import * as corte from '../../fuentes/jurisprudencia/corte/index.ts'
import * as suprema from '../../fuentes/jurisprudencia/cortesuprema.ts'
import * as consejo from '../../fuentes/jurisprudencia/consejoestado/index.ts'
import type { Resueltas } from './esquema.ts'
import { conOrigen, cuerpo, pasajes, reanudar, sinTexto } from './formato.ts'

export async function corteDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.ruta) throw new Error('Para fuente="corte" hace falta ruta.')
  let doc: Awaited<ReturnType<typeof corte.obtenerTexto>>
  try {
    doc = await corte.obtenerTexto(p.ruta)
  } catch (e) {
    if (e instanceof corte.NoExisteProvidencia) return `No existe una providencia en la ruta "${p.ruta}". Verifícala con buscar_jurisprudencia.`
    throw e
  }
  if (doc.texto.length < 200) return `Providencia ${p.ruta}\n\n${sinTexto(doc.texto.length, doc.url)}`
  return leerProvidencia(doc.texto, doc.url, `Providencia ${p.ruta}`, p, tope)
}

/**
 * Una providencia de cualquiera de las tres cortes: estructura en la cabecera,
 * la sección pedida y cada pasaje de buscar_en_texto rotulado con la parte de
 * la que sale. Un solo camino para las tres, porque el error que evita —citar
 * un voto particular como doctrina de la Sala— es el mismo en las tres, y sus
 * encabezados también (medido sobre doce providencias de la Suprema y del
 * Consejo el 2026-09-24; ver SECCIONES en parse.ts).
 *
 * `encabezado` rotula lo que va antes del primer encabezado: en la Corte
 * Constitucional lo pone su relatoría; en las otras dos es la identificación
 * del proceso.
 */
function leerProvidencia(
  texto: string,
  url: string,
  cab: string,
  p: Resueltas,
  tope: number,
  encabezado?: string,
  pie = '',
): string {
  // El mapa se calcula una vez: rotula la estructura en la cabecera, acota la
  // sección pedida y etiqueta cada pasaje de buscar_en_texto.
  const mapa = mapaDeSecciones(texto, encabezado)
  const estructura = mapa.map((t) => `${t.etiqueta} (${t.hasta - t.desde} car.)`).join(' · ')

  if (p.seccion) {
    const cuerpoSeccion = seccionDe(texto, p.seccion, encabezado)
    if (!cuerpoSeccion) {
      const hay = seccionesPresentes(texto)
      return (
        `${cab}\nNo encontré la sección "${p.seccion}".` +
        (hay.length ? ` Esta providencia trae: ${hay.join(', ')}.` : ' No se reconoció ninguna sección con encabezado propio.')
      )
    }
    const t = trocear(cuerpoSeccion, p.desde, tope)
    return (
      `${cab} — sección "${p.seccion}" (${t.total} caracteres de ${texto.length} del documento).\n` +
      `Estructura: ${estructura}.` +
      (t.omitido > 0
        ? ` Se muestran ${t.texto.length} desde ${t.desde}; quedan ${t.omitido} sin mostrar.\n${reanudar(p, t.desde + t.texto.length)}.`
        : '') +
      `\n\n${conOrigen(t.texto, url)}`
    )
  }

  if (p.buscar_en_texto) {
    return pasajes(texto, p.buscar_en_texto, p.max_pasajes, tope, url, `${cab}\nEstructura: ${estructura}.\n`, (pos) =>
      etiquetaEn(mapa, pos),
    )
  }
  return `${cab}\nEstructura: ${estructura}.\n${pie}${cuerpo(trocear(texto, p.desde, tope), url, p)}`
}

export async function supremaDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.ruta || !p.sala) throw new Error('Para fuente="suprema" hacen falta ruta y sala.')
  const doc = await suprema.obtenerTexto(p.ruta, p.sala as (typeof suprema.SALAS)[number])
  if (!doc) {
    return (
      `No encontré una providencia en la ruta "${p.ruta}" dentro de la sala ${p.sala}. ` +
      `Comprueba que la ruta salga de buscar_jurisprudencia_suprema y que la sala sea la misma con la que apareció.`
    )
  }
  const cab = `Corte Suprema de Justicia, sala ${p.sala}\nRuta: ${p.ruta}`
  if (doc.texto.length < 200) return `${cab}\n\n${sinTexto(doc.texto.length, p.ruta)}`
  return leerProvidencia(doc.texto, p.ruta, cab, p, tope, ENCABEZADO_PROVIDENCIA)
}

export async function consejoDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.token) throw new Error('Para fuente="consejo" hace falta token.')
  const doc = await consejo.obtenerTexto(p.token)
  if (!doc) {
    return (
      'No encontré una providencia para ese token. ' +
      'Los tokens caducan en una hora: repite buscar_jurisprudencia_consejo_estado y usa el que venga ahora.'
    )
  }
  const cab = `Consejo de Estado${doc.fichero ? ` — ${doc.fichero}` : ''}\nVisor: ${doc.urlVisor}`
  if (!doc.texto) {
    return (
      `${cab}\n\nEsta actuación no se sirve como PDF (viene comprimida o en otro formato), así que aquí no hay ` +
      `texto que extraer. Ábrela en el visor de arriba. Que no haya texto NO dice nada sobre su contenido.`
    )
  }
  return leerProvidencia(doc.texto, doc.urlVisor, cab, p, tope, ENCABEZADO_PROVIDENCIA, `${doc.paginas} página(s). `)
}
