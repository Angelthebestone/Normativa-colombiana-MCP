import { activa, avisoApagada } from '../../nucleo/alcance.ts'
import type { Cita } from '../../nucleo/citas.ts'
import { equivalencia, type Codigo } from '../../nucleo/codigos.ts'
import { esCompiladora } from '../../nucleo/compiladas.ts'
import { validarUrl } from '../../nucleo/evidencia.ts'
import type { Resultado } from '../../nucleo/parse/gestor.ts'
import { articulo as extraerArticulo } from '../../nucleo/parse/articulos.ts'
import { advertenciasVigencia } from '../../nucleo/parse/vigencia.ts'
import * as gestor from '../../fuentes/gestor/index.ts'
import type * as suin from '../../fuentes/suin/index.ts'
import type { Deps, OpcionesCita, Resuelta } from './resuelta.ts'

/**
 * Bloque de UN artículo con sus advertencias de vigencia, o el aviso de que no
 * aparece. La ruta de artículo único y la de `articulos` comparten esta función
 * porque el formato tiene que ser idéntico, y porque un artículo que falte se
 * marca en su propio bloque sin abortar los demás.
 */
function bloqueArticulo(texto: string, numero: string): string {
  const art = extraerArticulo(texto, numero)
  return art
    ? [`--- Artículo ${numero} ---`, art, ...advertenciasVigencia(art)].join('\n')
    : `No encontré un "artículo ${numero}" en el texto. Usa obtener_documento con fuente="gestor" y buscar_en_texto.`
}

export type EntradaNormaGestor = {
  cita: string
  c: Cita
  n: Resultado
  porCodigo: Codigo | undefined
  articuloIgnorado: string
  tipoCorregido: string
  pedidos: string[]
  opciones: OpcionesCita
  deps: Deps
  fichaSuin: typeof suin.ficha
}

/** La norma que el Gestor sí resolvió: ficha, vigencia según SUIN y los artículos pedidos. */
export async function resolverNormaGestor(e: EntradaNormaGestor): Promise<Resuelta> {
  const { cita, c, n, porCodigo, articuloIgnorado, tipoCorregido, pedidos, opciones, deps, fichaSuin } = e
  // Idea 11 — el dominio del enlace se comprueba siempre (falla blanda): si
  // no coincide con el esperado, se avisa en vez de devolver un enlace a ciegas.
  const dominioOk = validarUrl(n.url, 'funcionpublica.gov.co')
  const avisoDominio = dominioOk
    ? ''
    : `\nAVISO: el enlace devuelto no pertenece al dominio esperado (funcionpublica.gov.co): ${n.url}. Verifícalo antes de citarlo.`

  // La vigencia solo la publica SUIN, y solo si el índice empaquetado tiene
  // esta norma. Que falte no es un fallo: se calla y sigue mandando la regla
  // de no afirmar vigencia.
  // Si la cita vino sin año ("Decreto 1083"), se toma el del título que
  // resolvió el Gestor: sin esto la vigencia se perdía justo en las citas
  // cómodas, que son las que la gente escribe.
  // SUIN no tiene ficha de la Constitución (medido: «no consta… constitucion
  // politica 1 de 1991»), así que no se le pregunta.
  const anio = c.tipo === 'constitucion politica' ? undefined : (c.anio ?? n.titulo.match(/\bde\s+(\d{4})\b/i)?.[1])
  const conVigencia = anio && activa('suin')
  let vig = anio && !conVigencia ? `\nEstado de vigencia: ${avisoApagada('suin')}` : ''
  let detalleSuin = ''
  if (conVigencia) {
    // Dos silencios distintos que antes se veían iguales: que la fuente no
    // responda y que no tenga la norma. El primero es un estado del sistema, no
    // una respuesta sobre la norma, y presentarlo como ausencia de dato induce a
    // concluir de más. Por eso va con el motivo literal: quince consultas
    // seguidas devolvieron "no respondió" sin decir si era el corte del cliente,
    // un HTTP de error o el portal caído, que es justo lo que hay que comprobar.
    const f = await fichaSuin(c.tipo, c.numero, anio)
    if (f.ok) {
      detalleSuin = 'estado consultado'
      vig =
        `\nEstado de vigencia según SUIN-Juriscol (ficha consultada hoy): ` +
        `${f.ficha.estado || 'SUIN no publica el estado de esta norma'}\n  ${f.ficha.url}`
    } else if (f.razon === 'no-consta') {
      detalleSuin = 'sin ficha'
      vig =
        `\nEstado de vigencia: no consta. SUIN-Juriscol no tiene una ficha de ${c.tipo} ${c.numero} de ${anio}` +
        `${f.detalle ? ` (${f.detalle})` : ''}. No concluyas ni que está vigente ni que está derogada: revísalo en el enlace.`
    } else {
      detalleSuin = 'no respondió'
      vig =
        `\nEstado de vigencia: la ficha de SUIN-Juriscol no respondió en esta consulta (${f.detalle}). Vuelve a ` +
        `intentarlo antes de afirmar nada; no es que esta norma carezca de estado.`
    }
  }

  // La norma se descarga UNA vez, cualesquiera que sean los artículos pedidos:
  // seis llamadas separadas bajaban seis veces el mismo documento y repetían
  // seis veces la ficha y el bloque de vigencia.
  let articulos: string[] = []
  if (pedidos.length) {
    const norma = await (deps.obtenerNorma ?? gestor.obtenerNorma)(n.id)
    articulos = pedidos.map((num) => bloqueArticulo(norma.texto, num))
  }
  // No es un resumen de la norma: el Gestor no publica uno. Es el extracto de
  // UN tema al que está asociada, y en normas compiladoras como el Decreto 1083
  // describe una porción mínima del contenido. Sale una vez por norma y por
  // respuesta porque `componer` emite una sola ficha por norma. Con
  // contexto=false se omite sin nota: quien llama ya pidió omitirlo.
  const contextoTema =
    n.resumen && opciones.contexto !== false
      ? `Extracto de un tema asociado (NO resume la norma; usa obtener_documento con fuente="gestor" para su objeto y articulado): ${n.resumen}\n`
      : ''
  const conSuin = conVigencia ? [{ clave: 'suin', detalle: detalleSuin }] : []
  /**
   * La llamada siguiente, escrita para poder copiarla. El id ya está en la
   * respuesta, pero convertirlo en la llamada siguiente obliga a recordar que la
   * fuente se llama "gestor" y que el parámetro se llama "id"; quien lee esto a
   * las once de la noche no debería tener que recordarlo.
   */
  const siguiente = pedidos.length
    ? `Siguiente paso: la norma completa está con obtener_documento con fuente="gestor", id="${n.id}".`
    : `Siguiente paso: el articulado, con obtener_documento con fuente="gestor", id="${n.id}"` +
      ` (o pide un artículo concreto en la cita: "art. 3 de ${cita}").`
  // El título sin el emisor: «Decreto Ley 624 de 1989 Presidencia…» → «Decreto Ley 624 de 1989».
  const titulo = n.titulo.match(/^.*?\bde\s+\d{4}\b/i)?.[0] ?? n.titulo
  return {
    cita,
    clave: `gestor:${n.id}`,
    titulo,
    usos: [{ clave: 'gestor', detalle: 'norma resuelta' }, ...conSuin],
    // La equivalencia se compone DESPUÉS de resolver, con el título que publica
    // el Gestor: la tabla de códigos guarda el tipo con que se busca («decreto»
    // para el Estatuto Tributario), no el oficial («Decreto Ley»).
    avisos: [porCodigo ? equivalencia(porCodigo, titulo) : '', articuloIgnorado, tipoCorregido],
    ficha:
      `${n.titulo}\nid: ${n.id}\n` +
      contextoTema +
      (esCompiladora(n.titulo, 0) ? '\nAVISO: esta es una norma compilada que incorpora reformas; para un tema concreto usa obtener_documento con fuente="gestor" y buscar_en_texto.\n' : '') +
      `${siguiente}\n` +
      `URL: ${n.url}${avisoDominio}${vig}`,
    articulos,
  }
}
