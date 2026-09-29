/** Buscador general del Gestor Normativo: el de palabras del portal, con sus filtros. */
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { conPrefijo, idOnombre } from '../nucleo/catalogos.ts'
import { NO_EN_GESTOR, normalizarEntidad } from '../nucleo/entidades.ts'
import { temaDelIndice } from '../nucleo/indice.ts'
import { normalizarRotulo, sinTildes } from '../nucleo/parse.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Buscar normas en el Gestor Normativo'

export const DESCRIPCION =
  'Busca leyes, decretos, resoluciones, conceptos y sentencias del sector público colombiano. ' +
  'IMPORTANTE: el buscador del portal indexa solo los resúmenes temáticos, NO el articulado completo, ' +
  'y une los términos con OR. Usa pocas palabras y muy distintivas. Para buscar dentro del texto de una ' +
  'norma concreta, usa obtener_documento con fuente="gestor" y buscar_en_texto. Para una cita exacta, usa resolver_cita.'

const esquema = z.object({
  palabras: z.string().optional().describe('Términos distintivos; evita frases largas'),
  tipo_documento: z
    .string()
    .optional()
    .describe('Nombre o id del catálogo de tipos del Gestor: "Ley", "Decreto", "Resolución", "Concepto". Uno que no esté se rechaza con la lista, sin buscar'),
  numero: z.coerce.string().regex(/^\d+$/).optional().describe('Número de la norma, como texto. Ej.: "909"'),
  anio: z.coerce.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos, como texto. Ej.: "2004"'),
  entidad: z.string().optional().describe('Nombre o id: "Corte Constitucional", "Congreso de la República"'),
  tema: z.string().optional().describe('Nombre del tema, o su id de listar_catalogos con prefijo: "tema-24457"'),
  subtema: z.coerce
    .string()
    .optional()
    .describe('id de listar_catalogos con catalogo="subtemas" y prefijo ("sub-38968"), o su nombre si además indicas tema. El "ts-" de buscar_por_tema no vale aquí.'),
  limite: z.coerce.number().int().min(1).max(100).default(20),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ palabras, tipo_documento, numero, anio, entidad, tema: temaCrudo, subtema: subtemaCrudo, limite }: Params): Promise<string> {
  // Nombre o id: el id llega con prefijo, y uno pelado o de otro catálogo se
  // rechaza en vez de resolverse contra el tema equivocado.
  const tema = idOnombre('tema', temaCrudo)
  const subtema = idOnombre('sub', subtemaCrudo)
  // Idea 6 — normalización de entidades: un alias se resuelve al nombre que
  // el catálogo del Gestor entiende ("Mintrabajo" → "Ministerio del Trabajo").
  // Los que el Gestor NO cataloga ("dian") no se resuelven ni se inyectan: el
  // propio Gestor avisa "No reconocí entidad"; aquí solo se orienta hacia la
  // herramienta que sí cubre esa entidad.
  const ent = entidad ? normalizarEntidad(entidad) : null
  const claveEntidad = entidad ? sinTildes(entidad.trim().toLowerCase()) : ''
  const fueraDelGestor = NO_EN_GESTOR.has(claveEntidad)

  /**
   * El tipo no se cierra en un enum porque la lista la sirve el portal en vivo
   * (29 tipos, medido el 2026-09-16) y un enum la haría envejecer. Pero un tipo
   * que no está tampoco se puede ignorar, que era lo que pasaba: el portal
   * buscaba SIN el filtro y devolvía normas de todos los tipos con el aire de
   * estar filtradas, y el aviso quedaba en una nota. Se valida contra el mismo
   * catálogo que usa la búsqueda (cacheado: no cuesta una petición más) y se
   * rechaza antes de buscar, con la lista viva.
   */
  if (tipo_documento?.trim()) {
    const { tipos } = await gestor.catalogos()
    const id = await gestor.resolver(tipo_documento, 'tipos')
    if (!id || !tipos.some((t) => t.id === id)) {
      return (
        `${alcance([{ clave: 'gestor', detalle: 'solo su catálogo de tipos; no se buscó' }])}\n\n` +
          `El Gestor Normativo no tiene el tipo de documento "${tipo_documento}", así que no se buscó: ignorar el ` +
          `filtro devolvería normas de todos los tipos como si estuvieran filtradas. Los ${tipos.length} tipos que ` +
          `publica hoy: ${tipos.map((t) => t.nombre).join(', ')}.`
      )
    }
  }
  const r = await gestor.buscar({ palabras, tipo: tipo_documento, numero, anio, entidad: ent && !fueraDelGestor ? ent.oficial : entidad, tema, subtema })
  const notas = r.nota ? [r.nota] : []
  if (ent?.aliasUsado && !fueraDelGestor) {
    notas.push(`Entidad normalizada: «${ent.aliasUsado}» → «${ent.oficial}».`)
  } else if (fueraDelGestor) {
    notas.push(`Para normativa de «${entidad}» usa buscar_normativa_tributaria (no es un filtro del Gestor).`)
  }

  // El índice de palabras del portal es pobrísimo: "teletrabajo" solo casa con
  // 3 documentos en todo el corpus, y con ninguno de los 43 conceptos que sí
  // están clasificados bajo ese subtema. Cuando la búsqueda por palabras rinde
  // poco, se reintenta por la vía temática, que es la que de verdad encuentra.
  // El aviso sale SIEMPRE que se use la vía temática, aunque no añada
  // documentos nuevos: la lista final mezcla dos catálogos del portal.
  if (palabras && r.items.length < 5 && !subtema) {
    const par = temaDelIndice(palabras)
    if (par) {
      try {
        const sub = await gestor.subtemaPorNombre(par.t, par.s)
        if (sub) {
          const via = await gestor.buscar({ tipo: tipo_documento, numero, anio, entidad, subtema: sub })
          const vistos = new Set(r.items.map((i) => i.id))
          const extra = via.items.filter((i) => !vistos.has(i.id))
          if (via.items.length) {
            r.items.push(...extra)
            notas.push(
              `La búsqueda por palabras solo halló ${r.total}. Se reconsultó con el subtema "${normalizarRotulo(par.s)}" ` +
                `(id ${conPrefijo('sub', sub)}) del catálogo de búsqueda${extra.length ? ` y se añadieron ${extra.length} documentos` : ', que ya estaban entre los de palabras'}. Ese catálogo y el de ` +
                `buscar_por_tema son taxonomías distintas del portal, así que allí estos documentos pueden aparecer ` +
                `bajo otro tema.`
            )
          }
        }
      } catch {
        /* la vía temática es un refuerzo: si falla, quedan los de palabras */
      }
    }
  }

  if (!r.items.length) {
    // El filtro de entidad se resuelve bien y aun así devuelve cero, porque el
    // Gestor no cataloga por emisor: "Ley"+1993+"Congreso de la República"
    // (id 48) da 0, y el mismo par con "Nivel Nacional" (id 7) da 39, con la
    // Ley 100 de 1993 entre ellas. Un "no existe esa combinación" a secas
    // manda a dudar de la norma cuando el equivocado era el filtro.
    const porEntidad =
      entidad && !/nivel\s+nacional/i.test(entidad)
        ? ` AVISO SOBRE LA ENTIDAD: el Gestor clasifica la mayoría de la normativa nacional bajo la entidad` +
          ` "Nivel Nacional", no bajo quien la expidió; las leyes del Congreso aparecen así. Repite con` +
          ` entidad="Nivel Nacional" o sin entidad antes de concluir que la norma no existe.`
        : ''
    return vacio(
      'normas con esos filtros',
      `Filtros aplicados: ${r.aplicados.join(', ') || '(ninguno)'}.` +
        (r.nota ? ` ${r.nota}` : '') +
        porEntidad +
        ' Si los filtros se resolvieron bien, es que no existe esa combinación en el Gestor: prueba quitando el año' +
        ' o la entidad. Si buscaste por palabras, recuerda que el portal solo indexa los resúmenes temáticos:' +
        ' usa buscar_por_tema.',
      alcance([{ clave: 'gestor', detalle: '0 documentos' }])
    )
  }
  const mostrados = r.items.slice(0, limite)
  // El portal une los términos con OR: un resultado puede venir por un solo
  // término y leerse como igual de pertinente que otro que los trae todos.
  // Se marca por fila qué términos aparecen de verdad en su extracto.
  const pertinencia = palabras ? gestor.pertinenciaDe(mostrados, palabras) : undefined
  const lista = mostrados
    .map((i) => {
      const p = pertinencia?.get(i.id)
      const marca =
        p && p.omite.length && p.menciona.length
          ? `\n  Pertinencia: menciona ${p.menciona.map((t) => `"${t}"`).join(', ')}; NO menciona ${p.omite.map((t) => `"${t}"`).join(', ')} en su extracto (el portal une con OR).`
          : ''
      return `- ${i.titulo} (id ${i.id})\n  Extracto temático: ${i.resumen || '(ninguno)'}${marca}\n  ${i.url}`
    })
    .join('\n')
  const mas = r.items.length > limite ? `\n\nSe muestran ${limite} de ${r.items.length} reunidos.` : ''
  return (
    `${alcance([{ clave: 'gestor', detalle: `${r.items.length} documento(s)` }])}\n\n` +
      `${r.items.length} documento(s) reunido(s).${notas.length ? `\n${notas.join(' ')}` : ''}\n\n${lista}${mas}`
  )
}
