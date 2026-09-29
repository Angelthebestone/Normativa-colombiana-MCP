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
import { z } from 'zod'

import { historial, type Cambio } from '../nucleo/parse.ts'
import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import * as gestor from '../fuentes/gestor.ts'
import { alcance } from '../nucleo/alcance.ts'

export const TITULO = 'Historial de reformas de una norma'

export const DESCRIPCION =
  'Devuelve la cadena de reformas que el Gestor anota sobre una norma: qué norma la modificó, adicionó, ' +
  'derogó, sustituyó... y qué artículo afectó cada cambio, con la nota literal citable. Las ordena por el año ' +
  'de la norma que introduce cada cambio (las notas sin año van al final, sin ordenar) y señala la última ' +
  'reforma ANOTADA, que no es necesariamente la que rige: el portal no siempre anota todas las reformas. La ' +
  'vigencia se consulta con resolver_cita. Con formato="json" devuelve {fecha_consulta, alcance, titulo, url, ' +
  'total, cambios, ultima_reforma, avisos}, solo el objeto.'

const esquema = z.object({
  cita: z.string().describe('Cita de la norma, ej. "Ley 100 de 1993"'),
  articulo: z
    .string()
    .optional()
    .describe('Filtra a los cambios que afectaron ese artículo (ej. "6"); sin él se devuelven todos'),
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

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

/** Inyectables para probar sin red (patrón de validar_cita.ts). */
type Deps = { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma }

/** Fecha de la consulta en AAAA-MM-DD: la que el envoltorio ya no añade en modo json. */
const hoy = () => new Date().toISOString().slice(0, 10)

const ficha = (c: Cambio): string =>
  `${c.accion.toUpperCase()}${c.norma ? ` por ${c.norma}${c.anio ? ` de ${c.anio}` : ''}` : ''}${c.articulo ? `, artículo ${c.articulo}` : ''}`

/**
 * Ordena la cadena por el año de la norma modificadora; los cambios sin año no
 * se pueden fechar, así que van al final en el orden del documento y marcados.
 *
 * `Array.sort` es estable (ES2019), así que los empates de año conservan el
 * orden del documento, que es como `historial()` entrega las notas y lo único
 * que el portal permite afirmar entre dos reformas del mismo año.
 */
export function ordenarCambios(cambios: Cambio[]): Cambio[] {
  const conAnio = cambios.filter((c) => c.anio)
  const sinAnio = cambios.filter((c) => !c.anio)
  return [...conAnio.sort((a, b) => Number(a.anio) - Number(b.anio)), ...sinAnio]
}

/**
 * La reforma más reciente ANOTADA: la última con año de la lista ya ordenada.
 * Una nota sin año no se puede fechar, así que no compite por «más reciente»;
 * sin ninguna con año devuelve null, que es lo único cierto que se puede decir.
 */
export function ultimaReforma(ordenados: Cambio[]): Cambio | null {
  let ultima: Cambio | null = null
  for (const c of ordenados) if (c.anio) ultima = c
  return ultima
}

/**
 * El filtro por artículo y la página, en un solo sitio: el texto y el json
 * tienen que contar, ordenar y recortar igual, o dejarían de ser la misma
 * respuesta con otro traje.
 */
function acotar(
  cambios: Cambio[],
  opts: { articulo?: string | undefined; desde?: number | undefined; limite?: number | undefined },
) {
  const porArticulo = opts.articulo
    ? cambios.filter((c) => c.articulo.replace(/\.$/, '') === opts.articulo!.replace(/\.$/, ''))
    : cambios
  const ordenados = ordenarCambios(porArticulo)
  const desde = Math.max(0, opts.desde ?? 0)
  const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  return { porArticulo, ordenados, desde, limite, tramo: ordenados.slice(desde, desde + limite) }
}

/**
 * La reforma más reciente, dicha como lo que es. NUNCA «la que rige»: el portal
 * anota lo que anota —medido el 2026-09-28, la reforma de la Ley 2466 de 2025
 * al literal b) del artículo 23 del CST no está anotada en su página y la del
 * artículo 4 sí—, así que la única frase defendible es «la última anotada».
 */
function conclusion(ultima: Cambio | null, articulo?: string | undefined): string {
  if (!ultima) return '\n\nNinguna nota trae año: no se puede señalar cuál es la reforma más reciente.'
  const sobre = articulo ? ` sobre el artículo ${articulo}` : ' sobre esta norma'
  return (
    `\n\nReforma más reciente anotada por el portal${sobre}: ${ficha(ultima)} — nota literal: «${ultima.literal}».` +
    (ultima.accion === 'derogado'
      ? `\nATENCIÓN: la última reforma que el portal anota es una DEROGATORIA; no la leas como vigente sin comprobarla.`
      : '') +
    `\nEs la última que el portal ANOTA, no la que rige: el portal no siempre anota todas las reformas, y la ` +
    `vigencia se consulta con resolver_cita.`
  )
}

/**
 * Formatea la cadena de reformas. Exportada para testearla sin red con fixtures
 * del texto del Gestor.
 */
export function formatearHistorial(
  cambios: Cambio[],
  titulo: string,
  url: string,
  opts: { articulo?: string | undefined; desde?: number | undefined; limite?: number | undefined } = {},
): string {
  const { porArticulo, ordenados, desde, tramo } = acotar(cambios, opts)
  if (opts.articulo && !porArticulo.length) {
    return (
      `${titulo} (${url})\n\nEl Gestor anota ${cambios.length} cambio(s) sobre esta norma, pero ninguno sobre el ` +
      `artículo ${opts.articulo}. Eso NO equivale a que siga intacto: el portal no siempre anota las reformas; ` +
      `la vigencia se consulta con resolver_cita.`
    )
  }
  if (!porArticulo.length) {
    return (
      `${titulo} (${url})\n\nEl Gestor no anota reformas sobre esta norma. Eso NO equivale a que esté intacta: ` +
      `el portal no siempre anota las reformas; la vigencia se consulta con resolver_cita.`
    )
  }
  const fin = desde + tramo.length
  if (!tramo.length) {
    return (
      `${titulo} (${url})\n\nEl filtro reúne ${porArticulo.length} cambio(s)` +
      `${opts.articulo ? ` sobre el artículo ${opts.articulo}` : ''}, pero "desde" (${desde}) está más allá del final. ` +
      `Pide un "desde" menor.`
    )
  }
  const ambito = opts.articulo ? ` sobre el artículo ${opts.articulo}` : ''
  const lineas: string[] = []
  let separadas = false
  for (const c of tramo) {
    if (!c.anio && !separadas) {
      lineas.push('', 'Sin año en la nota (no se pueden ordenar por fecha; van al final):')
      separadas = true
    }
    lineas.push(`- ${ficha(c)}${c.anio ? '' : ' — sin año en la nota'}\n  Nota literal: «${c.literal}»`)
  }
  return (
    `${titulo} (${url})\n\n${porArticulo.length} cambio(s) anotado(s) en el texto del portal${ambito}; ` +
    `se muestran ${desde + 1}–${fin}:\n\n` +
    lineas.join('\n') +
    (fin < ordenados.length ? `\n\nQuedan ${ordenados.length - fin}: repite con desde=${fin}.` : '') +
    conclusion(ultimaReforma(ordenados), opts.articulo) +
    `\n\nSon las notas literales del portal, ordenadas por el año de la norma que las introduce (los empates ` +
    `conservan el orden del documento). No se deduce cuál rige hoy: para el estado actual usa resolver_cita.`
  )
}

/** Los datos del modo json, con la misma forma que promete la descripción. */
export type DatosHistorial = {
  fecha_consulta: string
  /** La línea de alcance, la misma que el modo markdown pone delante. */
  alcance: string
  titulo: string
  url: string
  /** Cambios anotados que cumplen el filtro, antes de paginar. */
  total: number
  /** La página: los cambios ya ordenados que caben entre `desde` y `limite`. */
  cambios: Cambio[]
  ultima_reforma: Cambio | null
  avisos: string[]
}

/** Los avisos del json: lo mismo que el texto dice al lector, en frases sueltas. */
function avisosDe(
  d: { porArticulo: Cambio[]; ordenados: Cambio[]; tramo: Cambio[]; desde: number; totalNorma: number },
  articulo?: string | undefined,
): string[] {
  const avisos = [
    'Son las notas literales del portal, ordenadas por el año de la norma que las introduce; los cambios sin año ' +
      'van al final, sin ordenar. No se deduce vigencia: el estado actual se consulta con resolver_cita.',
  ]
  if (!d.porArticulo.length) {
    avisos.push(
      articulo
        ? `El Gestor anota ${d.totalNorma} cambio(s) sobre esta norma, pero ninguno sobre el artículo ${articulo}; eso no equivale a que siga intacto.`
        : 'El Gestor no anota reformas sobre esta norma; eso no equivale a que esté intacta.',
    )
    return avisos
  }
  const ultima = ultimaReforma(d.ordenados)
  if (ultima) {
    avisos.push(
      `La reforma más reciente anotada por el portal es ${ficha(ultima)}: es la última anotada, no necesariamente la que rige.`,
    )
    if (ultima.accion === 'derogado') avisos.push('La última reforma anotada es una DEROGATORIA.')
  } else {
    avisos.push('Ninguna nota trae año: no se puede señalar cuál es la reforma más reciente.')
  }
  const sinAnio = d.ordenados.filter((c) => !c.anio).length
  if (sinAnio) avisos.push(`${sinAnio} cambio(s) no traen año en la nota y van al final, sin ordenar.`)
  const fin = d.desde + d.tramo.length
  if (!d.tramo.length) {
    avisos.push(`"desde" (${d.desde}) está más allá del final: el filtro reúne ${d.porArticulo.length} cambio(s).`)
  } else if (fin < d.ordenados.length) {
    avisos.push(`Quedan ${d.ordenados.length - fin}: repite con desde=${fin}.`)
  }
  return avisos
}

/** El objeto vacío de los caminos sin norma resuelta: la misma forma, en cero. */
const sinDatos = (alcanceLinea: string, aviso: string): DatosHistorial => ({
  fecha_consulta: hoy(),
  alcance: alcanceLinea,
  titulo: '',
  url: '',
  total: 0,
  cambios: [],
  ultima_reforma: null,
  avisos: [aviso],
})

/**
 * Los datos de una norma ya resuelta. Exportada para poder probar el json sin
 * red; el texto sale de `formatearHistorial` sobre el mismo `acotar`.
 */
export function datosDe(
  cambios: Cambio[],
  titulo: string,
  url: string,
  alcanceLinea: string,
  opts: { articulo?: string | undefined; desde?: number | undefined; limite?: number | undefined } = {},
): DatosHistorial {
  const { porArticulo, ordenados, desde, tramo } = acotar(cambios, opts)
  return {
    fecha_consulta: hoy(),
    alcance: alcanceLinea,
    titulo,
    url,
    total: porArticulo.length,
    cambios: tramo,
    ultima_reforma: ultimaReforma(ordenados),
    avisos: avisosDe({ porArticulo, ordenados, tramo, desde, totalNorma: cambios.length }, opts.articulo),
  }
}

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
  const cambios = historial(n.texto)
  const linea = alcance([{ clave: 'gestor', detalle: `${cambios.length} cambio(s)` }])
  if (json) return JSON.stringify(datosDe(cambios, n.titulo, n.url, linea, { articulo, desde, limite }))
  return `${linea}\n\n${formatearHistorial(cambios, n.titulo, n.url, { articulo, desde, limite })}`
}
