import * as cheerio from 'cheerio/slim'

/** Basura que Word deja incrustada en los documentos viejos (ver Ley 114 de 1913). */
const LINEA_BASURA =
  /mso-|MsoNormal|X-NONE|Style Definitions|^\s*\d{4}-\d{2}-\d{2}T[\d:]{8}Z|^\s*<!\[endif\]|^(Clean|false|true|Normal|ES-CO|MicrosoftInternetExplorer\d*)$|^[\d.,]+( pto)?$|^[a-z-]+:[^;]{0,60};$/i

/**
 * Los documentos viejos abren con el bloque de propiedades de Word (autor,
 * revisiones, "Hewlett-Packard", CSS): el portal guardó el HTML de Word quitando
 * las etiquetas pero dejando los valores, así que no queda marca estructural.
 * Se descarta el preámbulo de líneas cortas hasta la primera línea sustantiva.
 *
 * ponytail: heurística acotada a las primeras 80 líneas y solo mientras las
 * líneas sean cortas; si aparece un documento que empiece con muchas líneas
 * cortas legítimas, hay que acotar por selector en vez de por contenido.
 *
 * Ese documento apareció: las providencias de la Corte Suprema abren con siete
 * líneas cortas —"CORTE SUPREMA DE JUSTICIA", "Radicación n.° 46498", el
 * ponente, "SL3772-2018"— y se descartaban enteras, con el radicado dentro, que
 * es la clave con la que se cita. Se resolvió por donde estaba previsto, con
 * INICIO_REAL: basta que la PRIMERA línea sea un comienzo reconocible para que
 * no se descarte nada. El preámbulo de Word nunca empieza por CORTE, SALA ni
 * RADICACIÓN: son "Clean", "false", "mso-…" o cifras sueltas.
 */
const INICIO_REAL =
  /^(LEY|DECRETO|RESOLUCI[ÓO]N|CIRCULAR|ACUERDO|SENTENCIA|CONCEPTO|AUTO|DIRECTIVA|CONSTITUCI[ÓO]N|ACTO|ART[ÍI]CULO|CORTE|SALA|RADICACI[ÓO]N|EL |LA |LOS |POR |REP[ÚU]BLICA|MINISTERIO|DEPARTAMENTO)/i

function quitarPreambuloWord(lineas: string[]): string[] {
  let i = 0
  let descartadas = 0
  while (i < lineas.length && descartadas < 40) {
    const l = lineas[i]!
    if (l === '') {
      i++ // los renglones en blanco no gastan el presupuesto de descarte
      continue
    }
    if (INICIO_REAL.test(l) || l.length >= 40) break
    descartadas++
    i++
  }
  return descartadas > 0 && i < lineas.length ? lineas.slice(i) : lineas
}

const DESCARGO = /Los datos publicados tienen prop[óo]sitos exclusivamente informativos[^.]*\./i

function limpiarTexto(bruto: string): string {
  const lineas = bruto
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => !LINEA_BASURA.test(l))

  const utiles = quitarPreambuloWord(lineas)

  let t = utiles.join('\n').replace(/\n{3,}/g, '\n\n').trim()

  // El descargo del propio portal lo emitimos aparte, una vez, no dentro del articulado.
  const m = t.match(DESCARGO)
  if (m && t.indexOf(m[0]) < 400) t = t.slice(t.indexOf(m[0]) + m[0].length).trim()

  return t
}

const BLOQUES = 'p,div,br,tr,li,h1,h2,h3,h4,h5,h6,table,blockquote'

/** Carga HTML quitando de raíz lo que ensucia el texto (scripts, estilos, XML de Word). */
export function cargar(html: string): cheerio.CheerioAPI {
  const limpio = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|xml|o:p)\b[\s\S]*?<\/\1>/gi, ' ')
  const $ = cheerio.load(limpio)
  // Los iconos de la interfaz («developer_guide», «search»…) son texto para cheerio.
  $('.material-symbols-outlined').remove()
  return $
}

export function textoDe($: cheerio.CheerioAPI, selector: string): string {
  const $c = $(selector).first()
  if (!$c.length) return ''
  $c.find(BLOQUES).after('\n')
  return limpiarTexto($c.text())
}
