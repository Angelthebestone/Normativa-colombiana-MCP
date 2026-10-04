/**
 * `listar_normativa_ambiental_anla`: la clasificación temática de la normativa
 * ambiental que mantiene la ANLA en «Eureka». Aporta el mapa, no los documentos:
 * casi todo lo que lista son leyes y decretos que resolver_cita ya resuelve
 * mejor, así que aquí solo se descubre qué normas aplican a un tema.
 *
 * Reutiliza `listar` de `fuentes/anla.ts`, que es quien habla con Eureka. Aquí
 * solo va el esquema y el texto de la respuesta.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as anla from '../fuentes/anla.ts'

export const TITULO = 'Normativa ambiental clasificada por la ANLA'

export const DESCRIPCION =
  'La ANLA mantiene en su sistema "Eureka" una CURADURÍA de la normativa nacional que aplica al licenciamiento ' +
  'ambiental, agrupada por tema. Lo que aporta es la CLASIFICACIÓN, no documentos nuevos: casi todo lo que ' +
  'lista son leyes y decretos que resolver_cita ya resuelve mejor, con texto completo y con vigencia. ' +
  'Devuelve título, resumen y enlace de cada entrada, y avisa cuando el número del título no cuadra con el ' +
  'resumen. seccion elige el tema (por defecto, "leyes"); texto filtra SOLO la página que trae desde, no ' +
  'la sección entera, así que un vacío no es definitivo: repite sin texto para ver la página y el desde ' +
  'siguiente. Úsala para descubrir QUÉ normas aplican a un tema ambiental y resuelve cada una con ' +
  'resolver_cita; para filtrar de una vez la primera página de todas las secciones, consultar_perfil con ' +
  'perfil="ambiental".'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  seccion: z.enum(Object.keys(anla.SECCIONES) as [anla.SeccionAnla, ...anla.SeccionAnla[]]).default('leyes'),
  texto: z.string().optional().describe('Filtra las entradas de esa sección por título o resumen'),
  desde: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Eureka pagina sola y con distinto tamaño según la sección: no lo calcules, usa el que dice la respuesta'),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ seccion, texto, desde }: Params): Promise<string> {
  const r = await anla.listar(seccion, desde)
  const items = texto ? anla.filtrar(r.items, texto) : r.items
  if (!items.length) {
    return vacio(
      `entradas en la sección "${seccion}" de Eureka${texto ? ` que mencionen "${texto}"` : ''}`,
      r.items.length
        ? `La página trae ${r.items.length} entradas pero ninguna coincide: Eureka no tiene buscador propio y el filtro se aplica aquí, solo sobre esta página.`
        : 'Prueba con desde=0 o con otra sección.',
    )
  }
  return (
    `${alcance([{ clave: 'anla', detalle: `${items.length} entrada(s)` }])}\n\n` +
    `${items.length} entrada(s) en "${seccion}" (Eureka, ANLA), desde la posición ${r.desde}.\n\n` +
    items
      .map(
        (x) =>
          `- ${x.titulo}\n` +
          // El número del título es el que escribió Eureka, y a veces no es el
          // de la norma. Cuando el propio resumen lo desmiente, decirlo aquí
          // vale más que la cita: es la diferencia entre citar mal una ley de
          // deforestación y saber que hay que comprobar cuál de las dos es.
          (x.desmentida
            ? `  OJO, EL NÚMERO NO CUADRA: el título dice "${x.cita}" y el resumen de la propia ANLA cita ` +
              `"${x.desmentida}". Comprueba las dos con resolver_cita antes de citar ninguna.\n`
            : x.cita
              ? `  Cita leída del título, sin comprobar: pásala por resolver_cita — ${x.cita}\n`
              : '') +
          (x.resumen ? `  ${x.resumen.slice(0, 220)}\n` : '') +
          `  ${x.url}`,
      )
      .join('\n') +
    (r.siguiente !== null ? `\n\nHay más: repite con desde=${r.siguiente}.` : '') +
    `\n\nEsto es la clasificación temática de la ANLA, no su normativa propia. Para el texto y la vigencia de ` +
    `cada norma, pásala por resolver_cita.`
  )
}
