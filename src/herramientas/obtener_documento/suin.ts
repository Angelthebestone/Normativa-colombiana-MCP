/** `obtener_documento` con fuente="suin": articulado de SUIN-Juriscol con sus resúmenes de modificaciones y jurisprudencia. */
import { articulo as extraerArticulo, indiceArticulos } from '../../nucleo/parse/articulos.ts'
import { trocear } from '../../nucleo/parse/fragmentos.ts'
import * as suin from '../../fuentes/suin/index.ts'
import type { DepsLectura, Resueltas } from './esquema.ts'
import { cuerpo, pasajes, sinTexto } from './formato.ts'

/** Las afectaciones del resumen de SUIN como líneas; con artículo, solo las suyas y las de la norma entera. */
function lineasAfectaciones(titulo: string, xs: suin.Afectacion[], articulo: string | undefined, max: number): string {
  const propias = articulo
    ? xs.filter((a) => a.articulo.replace(/^Art[ií]culo\s+/i, '').trim() === articulo || !/^Art[ií]culo/i.test(a.articulo))
    : xs
  if (!propias.length) return ''
  const lineas = propias.slice(0, max).map((a) => `  - ${a.articulo}: ${a.accion}`)
  const resto = propias.length - lineas.length
  return `\n${titulo} (${propias.length}):\n${lineas.join('\n')}${resto > 0 ? `\n  … y ${resto} más (pide articulo= para ver las de uno).` : ''}`
}

/**
 * SUIN: el articulado del documento con lo que su visor muestra plegado —el
 * estado de vigencia, las notas de la norma entera, el resumen de
 * modificaciones por artículo y el de jurisprudencia—, copiado sin interpretar.
 */
export async function suinDocumento(p: Resueltas, tope: number, deps: DepsLectura = {}): Promise<string> {
  if (!p.id) throw new Error('Para fuente="suin" hace falta id.')
  const d = await (deps.documentoSuin ?? suin.documento)(p.id)
  if (!d) return `SUIN-Juriscol no tiene un documento con id ${p.id}. Búscalo con buscar_en_suin o resolver_cita.`

  const max = tope < 2000 ? 5 : 15
  const cab =
    [
      d.titulo || `Documento ${d.id} de SUIN-Juriscol`,
      d.epigrafe,
      d.entidad ? `Entidad: ${d.entidad}` : '',
      d.estado ? `Estado de vigencia (ficha SUIN, copiado tal cual): ${d.estado}` : '',
      ...Object.entries(d.fechas).map(([k, v]) => `${k}: ${v}`),
      ...(d.notasVigencia.length ? ['Notas de vigencia de la norma entera:', ...d.notasVigencia.slice(0, max).map((n) => `  - ${n}`)] : []),
      `URL: ${d.url}`,
    ]
      .filter(Boolean)
      .join('\n') +
    lineasAfectaciones('Resumen de modificaciones de SUIN', d.modificaciones, p.articulo, max) +
    lineasAfectaciones('Resumen de jurisprudencia de SUIN', d.jurisprudencia, p.articulo, max)

  if (d.texto.length < 200) return `${cab}\n\n${sinTexto(d.texto.length, d.url)}`

  let art: string | null = null
  if (p.articulo) {
    art = extraerArticulo(d.texto, p.articulo)
    if (!art) {
      const arts = indiceArticulos(d.texto)
      return (
        `${cab}\n\nNo encontré el artículo ${p.articulo}. ` +
        (arts.length ? `Artículos detectados: ${arts.join(', ')}. Repite con articulo= y uno de esos.` : 'No se detectó ningún artículo en el texto.')
      )
    }
  }
  if (p.buscar_en_texto && !art) return pasajes(d.texto, p.buscar_en_texto, p.max_pasajes, tope, d.url, `${cab}\n\n`)
  return `${cab}\n\n${cuerpo(trocear(art ?? d.texto, p.desde, tope), d.url, p)}`
}
