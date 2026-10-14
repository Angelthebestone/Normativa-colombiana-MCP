/** Piezas de salida compartidas por todas las fuentes: troceo, pasajes, origen y menciones. */
import { advertenciasVigencia } from '../../nucleo/parse/vigencia.ts'
import { avisoSinTexto } from '../../nucleo/parse/pdf.ts'
import { fragmentos } from '../../nucleo/parse/fragmentos.ts'
import { parsearCita } from '../../nucleo/citas/index.ts'
import type { Resueltas } from './esquema.ts'

/**
 * Detalle de la línea de alcance: el identificador con el que se pidió el
 * documento (lo único que se puede declarar de él antes de leerlo). El switch
 * cubre todas las fuentes, así que es total.
 */
export function pedidoDe(r: Resueltas): string {
  switch (r.fuente) {
    case 'gestor':
    case 'suin':
      return `id ${r.id}`
    case 'corte':
    case 'suprema':
    case 'creg':
      return `ruta ${r.ruta}`
    case 'consejo':
      return 'por token'
    case 'dian':
      return `link ${r.link}`
    case 'sectorial':
      return `entidad ${r.entidad}`
  }
}

/** Avisa del escaneo o del texto ausente, con el enlace. */
export function sinTexto(caracteres: number, url: string, escaneo = false): string {
  return avisoSinTexto(caracteres, url, escaneo)
}

/**
 * La llamada literal que trae el trozo siguiente, con el `desde` ya calculado.
 * Antes la respuesta decía cuántos caracteres quedaban y dejaba la aritmética
 * al cliente; el encargo lo pidió al revés: devolver el asa.
 */
export function reanudar(p: Resueltas, desde: number): string {
  const a = [`fuente="${p.fuente}"`]
  for (const k of ['id', 'ruta', 'sala', 'token', 'link', 'entidad', 'url', 'seccion', 'articulo'] as const) {
    if (p[k] !== undefined) a.push(`${k}="${String(p[k])}"`)
  }
  return `Trozo siguiente: obtener_documento con ${a.join(', ')}, desde=${desde}`
}

/**
 * Pega el origen en CADA bloque de texto: el troceo y la búsqueda parten el
 * documento en párrafos, y un párrafo citable sin su URL en el mismo bloque se
 * cita como si fuera de otro documento.
 */
export const conOrigen = (texto: string, url: string): string =>
  texto
    .split(/\n{2,}/)
    .map((bloque) => `${bloque}\nURL: ${url}`)
    .join('\n\n')

/** Texto troceado con sus avisos — formato idéntico al de los handlers previos. */
export function cuerpo(t: { texto: string; total: number; desde: number; omitido: number }, url: string, p: Resueltas): string {
  const avisos = advertenciasVigencia(t.texto).join('\n')
  return (
    `Texto total: ${t.total} caracteres; se muestran ${t.texto.length} desde ${t.desde}` +
    (t.omitido > 0 ? `; quedan ${t.omitido} sin mostrar.\n${reanudar(p, t.desde + t.texto.length)}.` : '.') +
    (avisos ? `\n${avisos}` : '') +
    `\n\n${conOrigen(t.texto, url)}${mencionesDe(t.texto)}`
  )
}

/** Busca dentro del texto con los pasajes agrupados — formato idéntico al previo. */
/**
 * `etiquetar` rotula cada pasaje con la parte del documento de la que sale. Lo
 * pasan las tres cortes, donde un pasaje de un voto particular no es doctrina
 * de la Sala; en una norma no hay nada análogo que rotular.
 */
export function pasajes(
  texto: string,
  termino: string,
  maxPasajes: number | undefined,
  tope: number,
  url: string,
  cabecera = '',
  etiquetar?: (pos: number) => string,
): string {
  const f = fragmentos(texto, termino, 400, maxPasajes ?? 10, tope)
  if (!f.total) {
    return `${cabecera}El término "${termino}" no aparece en el documento (${texto.length} caracteres revisados).\nURL: ${url}`
  }
  const etiquetas = etiquetar ? f.inicios.map(etiquetar) : []
  const mostrado = f.trozos
    .map((t, i) => (etiquetas[i] ? `[${etiquetas[i]}]\n${t}` : t))
    .join('\n\n---\n\n')
  // Que los pasajes salgan de partes distintas es justo lo que hay que decir
  // arriba: es donde se comete el error de atribuir a la mayoría un voto suelto.
  const distintas = [...new Set(etiquetas)]
  const aviso =
    distintas.length > 1
      ? `\nATENCIÓN: los pasajes salen de partes distintas de la providencia (${distintas.join('; ')}). ` +
        'Cada uno va rotulado con la suya. Solo las consideraciones de la mayoría son doctrina de la Sala.'
      : ''
  return (
    `${cabecera}${f.total} aparición(es) de "${termino}", agrupadas en ${f.pasajes} pasaje(s); se muestran ${f.mostrados}` +
    (f.mostrados < f.pasajes ? ` (los demás no caben en ${tope} caracteres: sube limite_caracteres o afina el término).` : '.') +
    `${aviso}\n${advertenciasVigencia(mostrado).join('\n')}\n\n${conOrigen(mostrado, url)}${mencionesDe(mostrado)}`
  )
}

/**
 * Citas a otras normas detectadas en un texto, en forma canónica y sin
 * repetir. Se devuelve la línea final lista para pegar, o '' si no hay nada.
 */
export function mencionesDe(texto: string): string {
  const vistos = new Set<string>()
  const anadir = (trozo: string) => {
    const c = parsearCita(trozo)
    if (!c) return
    vistos.add(c.sentencia ?? `${c.tipo.charAt(0).toUpperCase()}${c.tipo.slice(1)} ${c.numero}${c.anio ? ` de ${c.anio}` : ''}`)
  }
  // Normas con su tipo: "Ley 100 de 1993", "Decreto 1072 de 2015", "art. 6 de
  // la Ley 1221". El trozo se ciñe al patrón tipo+número(+año) para que una
  // sentencia incrustada en la misma frase no se trague la cita de la norma.
  const RE_TIPO =
    /\b(?:acto legislativo|circular conjunta|circular externa|circular unificada|constituci[oó]n pol[ií]tica|concepto marco|criterio unificado|decreto ley|documento conpes|acuerdo|auto|circular|concepto|decreto|directiva|estatutos|ley|reglamento|resoluci[oó]n|sentencia)\b\s*(?:n[ºo°.]?\s*)?\d+(?:\s*(?:de|del|\/)\s*\d{2,4})?/gi
  for (const m of texto.matchAll(RE_TIPO)) anadir(m[0])
  // Las sentencias también se citan en corto, sin la palabra "sentencia":
  // "C-337/11", "T-099/24". La aduana de parsearCita descarta los falsos.
  for (const m of texto.matchAll(/\b(?:C|T|SU|A)[\s.-]*\d{1,4}(?:\s*(?:[/-]|\s+de\s+)\s*\d{2,4})?/gi)) anadir(m[0])
  if (!vistos.size) return ''
  return `\n\nEste documento menciona: ${[...vistos].join('; ')} (resuélvelas con resolver_cita).`
}

/** Añade la línea de menciones cuando el texto citado las tiene. */
export const conMenciones = (s: string, texto: string): string => s + mencionesDe(texto)
