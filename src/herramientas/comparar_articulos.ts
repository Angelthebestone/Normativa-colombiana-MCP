/**
 * Compara el texto de un artículo entre dos normas: quién lo añadió, quién lo
 * eliminó, y una clasificación por patrones de cada diferencia.
 *
 * Con `con_reforma=true` responde otra pregunta en una sola llamada: qué cambió
 * el artículo N con su última reforma anotada. Localiza la reforma más reciente
 * que el portal anota sobre el artículo, descarga la norma modificadora y
 * contrasta SU artículo con el texto vigente.
 *
 * Medido el 2026-09-28 contra el Gestor (Ley 909 arts. 2 y 31, CST arts. 23 y 64,
 * Ley 1437 art. 20): la página de una norma CONSOLIDA —publica el texto vigente
 * del artículo, no la redacción anterior—, así que la comparación no es «antes
 * contra después» sino «lo que dispuso la reforma contra lo que la página
 * publica hoy». El texto que trae la norma modificadora puede ser completo
 * (Ley 50 de 1990 art. 1 sobre el CST art. 23) o solo de la parte que toca
 * (Ley 1960 de 2019 art. 6: «el numeral 4»), y de esa distinción depende que el
 * diff sea legible o engañoso; el modo lo declara en cada caso.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { agruparEditoriales, clasificarDiferencia, diffArticulos } from './diff.ts'
import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import {
  articulo as extraerArticulo,
  historial,
  limpiarArticulo,
  type Norma,
} from '../nucleo/parse.ts'
import { estricto, numeroDeArticulo } from '../nucleo/normalizar.ts'

import * as gestor from '../fuentes/gestor.ts'
import { alcance } from '../nucleo/alcance.ts'

export const TITULO = 'Comparar dos artículos de normas distintas'

export const DESCRIPCION =
  'Compara el texto de un artículo entre dos normas y marca lo añadido y lo eliminado. Clasifica cada ' +
  'diferencia por patrones de texto (plazo, sanción, excepción, sujeto obligado, prohibición u obligación) y ' +
  'detecta cambios editoriales por similitud léxica (Dice bigramas, ≥0,92); lo que no encaja se marca ' +
  '«revisar manualmente». Sin modelo semántico. Con con_reforma=true no hace falta la segunda norma: busca la ' +
  'última reforma que el portal anota al artículo, extrae el artículo de la norma modificadora y lo contrasta ' +
  'con el texto vigente, porque la página consolida y no publica la redacción anterior. Para ver todas las ' +
  'reformas de la norma usa historial_norma; para reunir evidencia de un conflicto entre dos normas enteras, ' +
  'analizar_conflicto.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  norma_a: z.string().describe('Cita de la norma base, ej. "Ley 909 de 2004"'),
  articulo_a: z.preprocess(numeroDeArticulo, z.string()).describe('Número del artículo de la norma base, ej. "31"'),
  norma_b: z
    .string()
    .optional()
    .describe('Cita de la segunda norma, ej. "Decreto 1083 de 2015"; no se usa con con_reforma=true'),
  articulo_b: z.preprocess(numeroDeArticulo, z.string().optional()).describe('Número de artículo de la segunda norma; no se usa con con_reforma=true'),
  con_reforma: z
    .boolean()
    .default(false)
    .describe('true: compara el artículo contra la última reforma que el portal le anota (no pidas norma_b)'),
})

/** Shape plano que consume el SDK; los parámetros se infieren del objeto completo. */
export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

/** Inyectables para probar sin red (patrón de validar_cita.ts). */
type Deps = { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma }

type Articulo = { texto: string | null; url: string; titulo: string }

const CIERRE =
  'Los cambios «editorial» son léxicos (Dice ≥0,92, sin modelo semántico): «multa»→«sanción pecuniaria» no se detecta como tal y queda en «no clasificado» para revisión manual. Igual con la sinonimia de cumplimiento: «queda prohibido»→«se prohíbe» puede no reconocerse si la redacción no casa con los patrones.'

/**
 * Trae una norma citada del Gestor. Los errores se devuelven, no se lanzan:
 * cada camino de `con_reforma` tiene que poder decir qué le faltó.
 */
async function resolverNorma(cita: string, deps: Deps): Promise<{ norma: Norma } | { error: string }> {
  const c = parsearCita(cita)
  if (!c) return { error: `No reconocí la cita «${cita}» como una norma del Gestor Normativo.` }
  const buscar = deps.buscar ?? gestor.buscar
  const r = await buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return {
        error: `La cita «${cita}» es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años distintos. Repite con el año, por ejemplo «${ambiguos[0]!.titulo}».`,
      }
    }
  }
  const primero = r.items[0]
  if (!primero) return { error: `No encontré la norma «${cita}» en el Gestor Normativo.` }
  return { norma: await (deps.obtenerNorma ?? gestor.obtenerNorma)(primero.id) }
}

/**
 * Trae el texto de un artículo de una norma citada. Si la cita o el artículo
 * no se encuentran, devuelve el lado con texto null y una nota clara.
 */
async function articuloDe(cita: string, numero: string, deps: Deps = {}): Promise<{ articulo: Articulo; nota: string }> {
  const res = await resolverNorma(cita, deps)
  if ('error' in res) return { articulo: { texto: null, url: '', titulo: '' }, nota: res.error }
  const n = res.norma
  const texto = extraerArticulo(n.texto, numero)
  if (texto === null) {
    return {
      articulo: { texto: null, url: n.url, titulo: n.titulo },
      nota: `No encontré el artículo ${numero} en «${n.titulo}» (${n.url}).`,
    }
  }
  // Se compara el texto sustantivo, sin las notas entre paréntesis que el
  // portal incrusta (reformas, "Ver sentencia"): son ruido editorial, no contenido.
  return { articulo: { texto: limpiarArticulo(texto), url: n.url, titulo: n.titulo }, nota: '' }
}

/**
 * Formatea el resultado de una comparación: empareja cambios editoriales por
 * similitud léxica y lista el resto como añadido/eliminado con su patrón.
 */
export function formatear(
  comparacion: { anadidos: string[]; eliminados: string[] },
  a: { titulo: string; url: string },
  b: { titulo: string; url: string },
): string {
  const { editoriales, anadidos, eliminados } = agruparEditoriales(comparacion.anadidos, comparacion.eliminados)
  const lineas: string[] = []
  for (const e of editoriales)
    lineas.push(`EDITORIAL — «${e.de}» → «${e.a}» (sim. ${e.sim.toFixed(2)}, cambio menor)`)
  for (const f of anadidos) lineas.push(`AÑADIDO en ${b.titulo} — ${clasificarDiferencia(f)}: «${f}»`)
  for (const f of eliminados) lineas.push(`ELIMINADO de ${a.titulo} — ${clasificarDiferencia(f)}: «${f}»`)
  if (!lineas.length && !editoriales.length) lineas.push('Los dos artículos son textualmente iguales.')
  lineas.push('', `- ${a.titulo}: ${a.url}`, `- ${b.titulo}: ${b.url}`)
  lineas.push('', CIERRE)
  return lineas.join('\n')
}

// --- con_reforma: el artículo contra la última reforma que el portal le anota --

/** Solo las normas se pueden comparar; «Sentencia C-337» no trae articulado. */
const PREFIJO_NORMA = /^(Ley|Decreto|Resolución|Resolucion|Acuerdo|Circular|Acto)\b/i
/**
 * La reforma toca una PARTE (numeral, inciso, literal, parágrafo) o sustituye
 * el artículo entero. Medido el 2026-09-28: la Ley 1960 de 2019 modifica «el
 * numeral 4» del art. 31 de la Ley 909, la Ley 2418 de 2024 «el numeral 1» del
 * art. 2 y la Ley 2466 de 2025 el «literal b)» del art. 23 del CST (parciales);
 * la Ley 50 de 1990 subroga el art. 23 del CST entero y la Ley 789 de 2002 el
 * 64 (completas). De la distinción depende el diff: un texto parcial contra el
 * artículo entero marcaría como «solo en el vigente» lo que la reforma
 * simplemente no toca, y eso se lee como derogación.
 */
const PARTE = /\b(?:numeral(?:es)?|inciso(?:s)?|literal(?:es)?|par[áa]grafo(?:s)?|ordinal(?:es)?)\b/i
const VERBO_REFORMA = /(quedar[áa]n? as[íi]|modif[íi]quese|sustit[úu]yase|subr[óo]guese|adici[óo]nese|der[óo]guese|adiciona[rn]?\b)/i
/**
 * El extractor devolvió solo el anuncio («…el cual quedará así.») y se dejó la
 * transcripción, que es el texto que de verdad importa. Medido con la Ley 2418
 * de 2024 art. 3: el portal escribe «quedará así.» —punto, no dos puntos— y el
 * corte por encabezado del artículo transcrito se lo come.
 */
const SOLO_ANUNCIO = /(?:quedar[áa]n? as[íi]|modif[íi]quese[^.\n]{0,120}|sustit[úu]yase[^.\n]{0,120}|subr[óo]guese[^.\n]{0,120})[.:]?\s*$/i

/**
 * La transcripción dentro del artículo modificador: lo que sigue al anuncio
 * («…el cual quedará así:», «…quedara asi:»). Sin recortarlo, el diff cargaría
 * las cláusulas propias de la reforma («Modifíquese…», encabezados) como si
 * fueran texto que la página no publica, y en una sustitución completa lo que
 * se quiere contrastar es solo la redacción transcrita. Se toma el ÚLTIMO
 * anuncio: es el que introduce el bloque transcrito.
 */
function transcripcion(texto: string): string {
  const m = [...texto.matchAll(/quedar[áa]n?\s+as[íi]\s*[.:]?\s*/gi)].at(-1)
  const cola = m && m.index !== undefined ? texto.slice(m.index + m[0].length).trim() : ''
  // Vacía o corta no es una transcripción: se devuelve el artículo entero y el
  // resto del camino (formaDeLaReforma) decide si se puede comparar.
  return cola.length >= 40 ? cola : texto
}

/** Cómo se puede leer el artículo de la norma modificadora. */
export type FormaReforma = 'sin-articulo' | 'ajeno' | 'solo-anuncio' | 'sin-transcripcion' | 'parcial' | 'completa'

/**
 * Clasifica el texto extraído de la norma modificadora. Los cuatro primeros
 * valores son «no se puede comparar», y cada uno se declara en vez de devolver
 * un diff silenciosamente equivocado:
 * - `sin-articulo`: no se extrajo nada.
 * - `ajeno`: lo extraído no menciona el artículo N ni trae lenguaje de reforma.
 *   Medido: `articulo()` sobre la Ley 789 de 2002 devolvía para «28» el
 *   artículo 28 de la Ley 21 de 1982 citado dentro del art. 3 (corregido en
 *   parse.ts el 2026-09-28; el valor queda para cualquier extracción que no
 *   corresponda).
 * - `solo-anuncio`: el extractor cortó en el anuncio y se comió la transcripción.
 * - `sin-transcripcion`: tras el anuncio viene el encabezado de OTRO artículo
 *   (el siguiente de la propia norma modificadora, porque el portal no
 *   transcribió): el texto que seguiría no es la redacción del artículo base.
 * - `parcial` | `completa`: el texto se puede leer, y `parcial` avisa de que
 *   cubre solo la parte que la reforma toca.
 */
export function formaDeLaReforma(textoReforma: string | null, articuloBase: string): FormaReforma {
  if (textoReforma === null) return 'sin-articulo'
  const esc = articuloBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const menciona = new RegExp(String.raw`\bart[íi]culos?\s+${esc}(?![\d.\-A-Za-z])`, 'i').test(textoReforma)
  if (!menciona && !VERBO_REFORMA.test(textoReforma)) return 'ajeno'
  const limpio = limpiarArticulo(textoReforma)
  if (limpio.length < 400 && SOLO_ANUNCIO.test(limpio)) return 'solo-anuncio'
  const anuncios = [...textoReforma.matchAll(/quedar[áa]n?\s+as[íi]\s*[.:]?/gi)]
  const ultimo = anuncios.at(-1)
  if (ultimo && ultimo.index !== undefined) {
    const cola = textoReforma.slice(ultimo.index + ultimo[0].length).trim()
    const enc = cola.match(/^(?:ART[IÍ]CULO|Art[ií]culo)\s+([\d][\w.-]*)/)
    if (enc && enc[1]!.replace(/\.$/, '') !== articuloBase.replace(/\.$/, '')) return 'sin-transcripcion'
  }
  // La «parte» solo cuenta en el enunciado (lo que va antes del anuncio). El
  // cuerpo transcrito menciona sus propios numerales («…del numeral 1…») y
  // mirarlo entero marcaba como parcial la sustitución completa del artículo 64
  // del CST por la Ley 789 de 2002 (medido el 2026-09-28 contra el portal).
  const enunciado = ultimo && ultimo.index !== undefined ? textoReforma.slice(0, ultimo.index + ultimo[0].length) : textoReforma
  return PARTE.test(enunciado) && VERBO_REFORMA.test(enunciado) ? 'parcial' : 'completa'
}

/** Los datos de la reforma elegida, para el formateador y para las pruebas. */
export type Reforma = {
  titulo: string
  url: string
  articulo: string
  accion: string
  norma: string
  anio: string
  literal: string
}

/**
 * La respuesta de `con_reforma`. Exportada para probarla sin red. Declara en
 * cada caso de qué lado está cada texto: el portal consolida el artículo (su
 * página publica el texto vigente), así que el «antes» de la reforma NO está
 * en estas páginas y lo único que se puede contrastar es lo que dispuso la
 * norma modificadora contra el texto vivo.
 */
export function formatearConReforma(d: {
  base: { titulo: string; url: string; articulo: string }
  reforma: Reforma
  modo: 'completa' | 'parcial' | 'sin-texto'
  textoReforma?: string | undefined
  comparacion?: { anadidos: string[]; eliminados: string[] } | undefined
  motivo?: string | undefined
}): string {
  const { base, reforma, modo } = d
  const partes: string[] = [
    `Artículo ${base.articulo} de «${base.titulo}» (${base.url}).`,
    `Reforma más reciente anotada por el portal: ${reforma.accion.toUpperCase()} por ${reforma.norma} de ${reforma.anio}, ` +
      `artículo ${reforma.articulo} — nota literal: «${reforma.literal}».`,
    `Norma modificadora: «${reforma.titulo}»${reforma.url ? ` (${reforma.url})` : ' (no la encontré en el Gestor)'}, artículo ${reforma.articulo}.`,
    '',
    'Cómo leer esto: la página de la norma publica el texto VIGENTE del artículo (el portal consolida, no archiva), ' +
      'así que la redacción ANTERIOR a la reforma no está en estas páginas. Lo que se contrasta es lo que dispuso la ' +
      'norma modificadora contra el texto que la página publica hoy: no es el «antes» contra el «después».',
  ]
  if (modo === 'sin-texto') {
    partes.push(
      '',
      `No se hace la comparación: ${d.motivo ?? 'no se pudo extraer el artículo de la norma modificadora'}. El diff no sería fiable.`,
    )
  } else if (modo === 'parcial') {
    partes.push(
      '',
      'La reforma modifica solo una PARTE del artículo (numeral, inciso, literal…): el texto de la norma ' +
        'modificadora cubre únicamente esa parte, y contrastarlo con el artículo entero marcaría como «solo en el ' +
        'vigente» todo lo que la reforma no toca — se leería como derogación. No se hace el diff, que aquí no sería fiable.',
      '',
      'Texto que la reforma dispone para esa parte (transcrito por la norma modificadora):',
      '',
      d.textoReforma ?? '',
    )
  } else {
    const { editoriales, anadidos, eliminados } = agruparEditoriales(d.comparacion!.anadidos, d.comparacion!.eliminados)
    if (!anadidos.length && !eliminados.length) {
      partes.push(
        '',
        editoriales.length
          ? 'El texto vigente coincide con lo que dispuso la reforma, salvo diferencias editoriales (léxicas: tildes, erratas del portal):'
          : 'El texto vigente coincide con lo que dispuso la reforma: la página ya publica su redacción.',
      )
    } else {
      partes.push('', 'Diferencias entre lo que dispuso la reforma y el texto que la página publica hoy:')
    }
    for (const e of editoriales) partes.push(`EDITORIAL — «${e.de}» → «${e.a}» (sim. ${e.sim.toFixed(2)}, cambio menor)`)
    for (const f of anadidos)
      partes.push(`SOLO EN EL VIGENTE (la reforma no lo transcribe) — ${clasificarDiferencia(f)}: «${f}»`)
    for (const f of eliminados)
      partes.push(`SOLO EN LA REFORMA (no está tal cual en el texto vigente) — ${clasificarDiferencia(f)}: «${f}»`)
  }
  partes.push('', 'Esto compara textos del portal y no deduce vigencia: el estado del artículo se consulta con resolver_cita.')
  return partes.join('\n')
}

/**
 * El modo `con_reforma`. Nunca lanza por datos ausentes: cada callejón sin
 * salida sale con las referencias y el motivo.
 */
async function conReforma(normaA: string, articuloA: string, deps: Deps): Promise<string> {
  if (!parsearCita(normaA)) {
    return (
      'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).\n\n' +
      `No reconocí «${normaA}» como una cita del Gestor Normativo. Escríbela como "Ley 909 de 2004" o "Decreto 1072 de 2015".`
    )
  }
  const una = alcance([{ clave: 'gestor', detalle: '1 cita(s)' }])
  const base = await resolverNorma(normaA, deps)
  if ('error' in base) return `${una}\n\n${base.error}`
  const n = base.norma
  const raw = extraerArticulo(n.texto, articuloA)
  if (raw === null) {
    return (
      `${una}\n\nNo encontré el artículo ${articuloA} en «${n.titulo}» (${n.url}). Sin ese texto no hay nada que ` +
      `comparar; el índice de artículos se pide con obtener_documento.`
    )
  }
  const notas = historial(raw)
  // Solo se pueden comparar reformas normativas que citen su artículo: una
  // sentencia no trae articulado y una nota sin artículo no dice dónde mirar.
  const comparables = notas.filter((c) => c.anio && c.articulo && PREFIJO_NORMA.test(c.norma))
  const ordenadas = [...comparables].sort((a, b) => Number(a.anio) - Number(b.anio))
  const reforma = ordenadas.at(-1)
  if (!reforma) {
    const otras = notas.length - comparables.length
    return (
      `${una}\n\nEl Gestor no anota ninguna reforma normativa sobre el artículo ${articuloA} de «${n.titulo}» ` +
      `(${n.url})${otras ? `, solo ${otras} nota(s) sin artículo reformador (control constitucional, reglamentación…)` : ''}. ` +
      `No hay norma modificadora que comparar; el estado actual se consulta con resolver_cita.`
    )
  }
  const cabecera = alcance([{ clave: 'gestor', detalle: '2 cita(s)' }])
  const datos = {
    base: { titulo: n.titulo, url: n.url, articulo: articuloA },
    reforma: {
      titulo: `${reforma.norma} de ${reforma.anio}`,
      url: '',
      articulo: reforma.articulo,
      accion: reforma.accion,
      norma: reforma.norma,
      anio: reforma.anio,
      literal: reforma.literal,
    },
  }
  const modRes = await resolverNorma(`${reforma.norma} de ${reforma.anio}`, deps)
  if ('error' in modRes) {
    return `${cabecera}\n\n${formatearConReforma({ ...datos, modo: 'sin-texto', motivo: `la norma modificadora anotada no se pudo resolver (${modRes.error})` })}`
  }
  const mod = modRes.norma
  const conTitulo = { ...datos, reforma: { ...datos.reforma, titulo: mod.titulo, url: mod.url } }
  const artMod = extraerArticulo(mod.texto, reforma.articulo)
  const forma = formaDeLaReforma(artMod, articuloA)
  if (forma === 'sin-articulo' || forma === 'ajeno' || forma === 'solo-anuncio' || forma === 'sin-transcripcion') {
    const motivo =
      forma === 'sin-articulo'
        ? `no se pudo extraer el artículo ${reforma.articulo} de «${mod.titulo}»`
        : forma === 'ajeno'
          ? `el artículo ${reforma.articulo} de «${mod.titulo}» no menciona el artículo ${articuloA} ni trae lenguaje de reforma: la extracción no corresponde a esta reforma`
          : forma === 'solo-anuncio'
            ? `el texto extraído de «${mod.titulo}» corta en el anuncio («…quedará así»), sin la transcripción que el portal publica después`
            : `tras el anuncio de «${mod.titulo}» no viene la transcripción del artículo ${articuloA}, sino otro articulado: no hay redacción que comparar`
    return `${cabecera}\n\n${formatearConReforma({ ...conTitulo, modo: 'sin-texto', motivo })}`
  }
  if (forma === 'parcial') {
    // Se muestra sin limpiar: los marcadores «(…)» con los que el portal omite
    // los apartes no tocados son parte de lo que la reforma dice, y limpiarlos
    // los dejaría como numerales vacíos.
    return `${cabecera}\n\n${formatearConReforma({ ...conTitulo, modo: 'parcial', textoReforma: artMod! })}`
  }
  // En la sustitución completa se contrasta la transcripción (el bloque que
  // sigue al anuncio), no las cláusulas de la reforma: eso es lo comparable.
  const comparacion = diffArticulos(limpiarArticulo(transcripcion(artMod!)), limpiarArticulo(raw))
  return `${cabecera}\n\n${formatearConReforma({ ...conTitulo, modo: 'completa', comparacion })}`
}

/**
 * Compara el texto de un artículo entre dos normas citadas y devuelve las
 * diferencias. Si un lado no se encuentra, se nota y se continúa con el otro.
 * Con `con_reforma=true`, compara contra la última reforma anotada del artículo.
 */
export async function escribir(params: Params, deps: Deps = {}): Promise<string> {
  const { norma_a, articulo_a, norma_b, articulo_b, con_reforma } = params
  if (con_reforma) {
    if (norma_b || articulo_b) {
      return (
        'Con con_reforma=true sobran norma_b y articulo_b: la norma modificadora sale de las notas que el portal ' +
        'anota sobre el artículo. Quítalos para comparar contra la última reforma, o pon con_reforma=false para ' +
        'comparar dos normas distintas.'
      )
    }
    return conReforma(norma_a, articulo_a, deps)
  }
  if (!norma_b || !articulo_b) {
    return (
      'Para comparar dos artículos hacen falta norma_b y articulo_b, por ejemplo "Decreto 1083 de 2015" y "12". ' +
      'Para comparar el artículo con la última reforma que el portal le anota, usa con_reforma=true sin norma_b.'
    )
  }
  const A = await articuloDe(norma_a, articulo_a, deps)
  const B = await articuloDe(norma_b, articulo_b, deps)
  // Solo se consulta el Gestor, y solo por las citas interpretables: dos citas
  // ilegibles no llegan a tocar la red y por eso no se declaran.
  const citas = [norma_a, norma_b].filter((c) => parsearCita(c)).length
  const cabecera = citas
    ? alcance([{ clave: 'gestor', detalle: `${citas} cita(s)` }])
    : 'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).'
  const notas = [A.nota, B.nota].filter(Boolean)
  if (A.articulo.texto === null || B.articulo.texto === null) {
    const lineas = [...notas]
    if (A.articulo.url) lineas.push(`- ${A.articulo.titulo}: ${A.articulo.url}`)
    if (B.articulo.url) lineas.push(`- ${B.articulo.titulo}: ${B.articulo.url}`)
    lineas.push('', CIERRE)
    return `${cabecera}\n\n${lineas.join('\n')}`
  }
  return `${cabecera}\n\n${[...notas, formatear(diffArticulos(A.articulo.texto, B.articulo.texto), A.articulo, B.articulo)].join('\n')}`
}
