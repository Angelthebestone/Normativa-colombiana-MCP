/**
 * `historial_norma`: la cadena de reformas que el Gestor anota sobre una norma,
 * estructurada como lista navegable (acción → norma → artículo afectado → nota
 * literal citable) y ORDENADA por el año de la norma que introduce cada cambio.
 *
 * El orden es una lectura, no una afirmación de vigencia: el portal anota las
 * notas en el orden del documento y no dice cuál rige. Ordenarlas por año y
 * señalar la más reciente es lo máximo que se puede decir sin inventar; las
 * notas sin año no se pueden fechar y van aparte, al final. La vigencia se
 * consulta con resolver_cita.
 *
 * Reutiliza `historial()` de parse.ts (que ya parsea las tres formas de nota) y
 * la resolución de citas de comparar_articulos (parsearCita → gestor.buscar →
 * obtenerNorma). No reimplementa nada.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { articulo as extraerArticulo, indiceArticulos } from '../nucleo/parse/articulos.ts'
import { historial } from '../nucleo/parse/historial.ts'
import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas/index.ts'
import { estricto, numeroDeArticulo } from '../nucleo/normalizar.ts'

import * as gestor from '../fuentes/gestor/index.ts'
import { alcance } from '../nucleo/alcance.ts'
import { formatearHistorial } from './historial_norma/cambios.ts'
import { datosDe, sinDatos } from './historial_norma/datos.ts'

export const TITULO = 'Historial de reformas de una norma'

export const DESCRIPCION =
  'Devuelve la cadena de reformas que el Gestor anota sobre una norma: qué norma la modificó, adicionó, ' +
  'derogó, sustituyó... y qué artículo afectó cada cambio, con la nota literal citable. Las ordena por el año ' +
  'de la norma que introduce cada cambio (las notas sin año van al final, sin ordenar) y señala la última ' +
  'reforma ANOTADA, que no es necesariamente la que rige: el portal no siempre anota todas. articulo filtra ' +
  'primero; desde y limite recortan después esa lista ya ordenada, y la última reforma se calcula sobre todo ' +
  'lo filtrado, no sobre el tramo mostrado. Para la vigencia usa resolver_cita; para los cambios de varias ' +
  'normas a partir de un año, cambios_desde; para comparar el texto antes y después, comparar_articulos. ' +
  'Con formato="json" el objeto trae titulo, url, total, cambios, ultima_reforma y avisos.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  cita: z.string().describe('Cita de la norma, ej. "Ley 100 de 1993"'),
  articulo: z
    .preprocess(numeroDeArticulo, z.string().optional())
    .describe('Filtra a las notas de reforma de ese artículo de la norma (ej. "6"); sin él se devuelven todas'),
  desde: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Cuántos cambios saltarse antes de empezar (los demás no caben en la respuesta)'),
  limite: z.coerce.number().int().min(1).max(100).default(20).describe('Cuántos cambios mostrar (hasta 100)'),
  formato: z
    .enum(['markdown', 'json'])
    .default('markdown')
    .describe('Salida: "markdown" (texto legible, por defecto) o "json" (solo el objeto de datos, sin cabecera ni pie)'),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

/** Inyectables para probar sin red (patrón de validar_cita.ts). */
type Deps = { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma }
/** Aviso único de los caminos que no llegan a resolver la norma. */
const SIN_FUENTE = 'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).'

export async function escribir(
  { cita, articulo, desde, limite, formato }: Params,
  deps: Deps = {},
): Promise<string> {
  const json = formato === 'json'
  const buscar = deps.buscar ?? gestor.buscar
  const obtenerNorma = deps.obtenerNorma ?? gestor.obtenerNorma

  const c = parsearCita(cita)
  // Una cita ilegible no llega a consultar nada: se dice en lugar de declarar
  // el Gestor como consultado.
  if (!c) {
    const aviso = `No reconocí «${cita}» como una cita del Gestor Normativo. Escríbela como "Ley 100 de 1993" o "Decreto 1072 de 2015".`
    return json ? JSON.stringify(sinDatos(SIN_FUENTE, aviso)) : `${SIN_FUENTE}\n\n${aviso}`
  }
  const r = await buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      const linea = alcance(['gestor'])
      const aviso = `La cita «${cita}» es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años distintos. Repite con el año, por ejemplo «${ambiguos[0]!.titulo}».`
      return json ? JSON.stringify(sinDatos(linea, aviso)) : `${linea}\n\n${aviso}`
    }
  }
  const primero = r.items[0]
  if (!primero) {
    const linea = alcance(['gestor'])
    const aviso = `No encontré la norma «${cita}» en el Gestor Normativo. Prueba con resolver_cita.`
    return json ? JSON.stringify(sinDatos(linea, aviso)) : `${linea}\n\n${aviso}`
  }
  const n = await obtenerNorma(primero.id)
  // Como obtener_documento y comparar_articulos: las notas del artículo se leen
  // en SU texto. `Cambio.articulo` es el de la norma modificadora, no este.
  const ambito = articulo ? extraerArticulo(n.texto, articulo) : n.texto
  if (articulo && !ambito) {
    const linea = alcance(['gestor'])
    const aviso = `No encontré el artículo ${articulo}. Artículos detectados: ${indiceArticulos(n.texto).join(', ') || '(ninguno)'}`
    return json
      ? JSON.stringify({ ...datosDe([], n.titulo, n.url, linea, {}), avisos: [aviso] })
      : `${linea}\n\n${n.titulo} (${n.url})\n\n${aviso}`
  }
  const cambios = historial(ambito!)
  const linea = alcance([{ clave: 'gestor', detalle: `${cambios.length} cambio(s)` }])
  if (json) return JSON.stringify(datosDe(cambios, n.titulo, n.url, linea, { articulo, desde, limite }))
  return `${linea}\n\n${formatearHistorial(cambios, n.titulo, n.url, { articulo, desde, limite })}`
}
