import { agruparEditoriales, clasificarDiferencia, diffArticulos } from '../diff.ts'
import { parsearCita } from '../../nucleo/citas.ts'
import { articulo as extraerArticulo, historial, limpiarArticulo } from '../../nucleo/parse.ts'
import { alcance } from '../../nucleo/alcance.ts'
import { resolverNorma, type Deps } from './norma.ts'

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
export async function conReforma(normaA: string, articuloA: string, deps: Deps): Promise<string> {
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
