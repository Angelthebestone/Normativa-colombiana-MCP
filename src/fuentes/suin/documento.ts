import { CanarioError } from '../../nucleo/parse/errores.ts'
import { cargar, textoDe } from '../../nucleo/parse/limpieza.ts'
import { colapsarEspacios as plano } from '../../nucleo/parse/texto.ts'
import { pedir } from '../../nucleo/http.ts'
import { LEXIS, enlaceSuin } from './enlace.ts'

const DOCUMENTOS = `${LEXIS}/suin-search/api/documentos/`

/** Una afectación del resumen de SUIN: qué artículo, qué le pasó y por qué norma o sentencia. */
export type Afectacion = { articulo: string; accion: string; por: string }

/**
 * Un documento de SUIN leído de su API. `texto` es el articulado (o el cuerpo
 * de la providencia); los resúmenes son los que el visor muestra plegados: las
 * modificaciones por artículo, la jurisprudencia que lo afectó y las notas de
 * vigencia de la norma entera. Son datos del portal, copiados sin interpretar.
 */
export type DocumentoSuin = {
  id: string
  titulo: string
  epigrafe: string
  estado: string
  entidad: string
  url: string
  texto: string
  modificaciones: Afectacion[]
  jurisprudencia: Afectacion[]
  notasVigencia: string[]
  fechas: Record<string, string>
}

type RespuestaDocumento = {
  success?: boolean
  data?: {
    id?: number | string
    textoHtml?: string | null
    vigencia?: string | null
    epigrafe?: string | null
    entidadEmisora?: string | null
  } | null
}

/**
 * El documento a partir de la respuesta del API, sin red. Sin `textoHtml` es el
 * portal cambiado: canario. El articulado de una norma es el último `div` del
 * cuerpo (el resto es la barra del visor, el carrusel de cursos y las tablas
 * plegadas); una providencia no tiene esa estructura y se lee el cuerpo sin la
 * barra. Los rótulos de artículo salen pegados al texto ("Artículo 10.Régimen"):
 * se les devuelve el espacio para que el índice de artículos los reconozca.
 */
export function documentoDe(json: RespuestaDocumento | null | undefined, id: string): DocumentoSuin {
  const d = json?.data
  if (!d || typeof d.textoHtml !== 'string') throw new CanarioError('el documento de SUIN no trae data.textoHtml')
  const $ = cargar(d.textoHtml)

  const afectaciones = (sel: string): Afectacion[] =>
    $(sel)
      .find('li.resumenvigencias')
      .toArray()
      .flatMap((li) => {
        const articulo = plano($(li).children('b').first().text()).replace(/:$/, '')
        return $(li)
          .find('li.referencia')
          .toArray()
          .map((ref) => {
            const por = plano($(ref).find('a').last().text())
            return { articulo, accion: plano(plano($(ref).text()).replace(por, '')), por }
          })
      })
  const modificaciones = afectaciones('[id$=ResumenNotasVigencia]')
  const jurisprudencia = afectaciones('[id$=ResumenAfectacionesJurisp]')
  const notasVigencia = $('#tablita > ul.resumenvigencias > li.referencia')
    .toArray()
    .map((li) => plano($(li).text()))
    .filter(Boolean)

  // Las fechas van en parejas de párrafos (rótulo, valor) en la tabla del estado de vigencia.
  const fechas: Record<string, string> = {}
  const parrafos = $('table#toc p')
    .toArray()
    .map((p) => plano($(p).text()))
  parrafos.forEach((p, i) => {
    const valor = parrafos[i + 1] ?? ''
    if (/^Fecha de /i.test(p) && /^\d{2}\/\d{2}\/\d{4}$/.test(valor)) fechas[p] = valor
  })

  const titulo = plano($('#titulotipo').text())
  let texto: string
  if (titulo) {
    texto = textoDe(cargar(`<main>${$.html($('body').children('div').last())}</main>`), 'main')
  } else {
    $('header, #toolPanel, #toolFab, .slider, table#toc, [style*="display: none"]').remove()
    texto = textoDe($, 'body')
  }
  texto = texto.replace(/(\b(?:ART[IÍ]CULO|Art[ií]culo)\s+\d+[A-Za-z]?\s*[°ºo]?\.)(?=[^\s\d])/g, '$1 ')

  return {
    id,
    titulo,
    // En las providencias el API manda el texto literal "null" en todos estos campos (medido el 2026-10-14).
    epigrafe: d.epigrafe === 'null' ? '' : plano(d.epigrafe ?? ''),
    estado: d.vigencia === 'null' ? '' : plano(d.vigencia ?? ''),
    entidad: d.entidadEmisora === 'null' ? '' : plano(d.entidadEmisora ?? ''),
    url: enlaceSuin(id),
    texto,
    modificaciones,
    jurisprudencia,
    notasVigencia,
    fechas,
  }
}

/**
 * El documento de SUIN por su id clásico (el de `visualizacion` y de los
 * enlaces). `null` si el portal no lo tiene: su API responde 204 sin cuerpo.
 */
export async function documento(
  id: string,
  deps: { pedir?: typeof pedir } = {},
): Promise<DocumentoSuin | null> {
  if (!/^\d+$/.test(id)) throw new Error(`Id de SUIN inválido: "${id}". Es numérico, el de buscar_en_suin o resolver_cita.`)
  const r = await (deps.pedir ?? pedir)(`${DOCUMENTOS}${id}`, 60_000, 'application/json')
  if (r.status === 204 || (r.status === 200 && !r.cuerpo.trim())) return null
  if (r.status !== 200) throw new Error(`SUIN-Juriscol respondió ${r.status} al pedir el documento ${id}.`)
  let json: RespuestaDocumento
  try {
    json = JSON.parse(r.cuerpo) as RespuestaDocumento
  } catch {
    throw new CanarioError('el documento de SUIN no llegó como JSON')
  }
  return documentoDe(json, id)
}
