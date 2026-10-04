/**
 * `resolver_cita`: de una cita escrita como la escribe un abogado al documento
 * oficial. Es la puerta exacta del MCP; el buscador por palabras no lo es.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { activa, alcance, avisoApagada, type Uso } from '../nucleo/alcance.ts'
import { citaCorteConstitucional } from '../nucleo/cita_oficial.ts'
import { parsearCita, parsearRadicado } from '../nucleo/citas.ts'
import { codigoDe, equivalencia, referencia as refCodigo } from '../nucleo/codigos.ts'
import { esCompiladora } from '../nucleo/compiladas.ts'
import { validarUrl } from '../nucleo/evidencia.ts'
import { advertenciasVigencia, articulo as extraerArticulo } from '../nucleo/parse.ts'
import { estricto, numeroDeArticulo } from '../nucleo/normalizar.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as suin from '../fuentes/suin.ts'
import { resolverCodigo } from './codigo_senado.ts'
import { resolverRadicado } from './resolver_radicado.ts'
import * as validarCita from './validar_cita.ts'

type OpcionesCita = {
  /** Artículos de la MISMA norma: se resuelve y se descarga una vez, y se extrae cada uno. */
  articulos?: string[] | undefined
  /** Con false se omite el extracto de tema asociado, que es lo más caro de la respuesta. */
  contexto?: boolean | undefined
}

/** Las fuentes que consulta la rama del Gestor, inyectables para probar sin red. */
export type Deps = {
  buscar?: typeof gestor.buscar
  obtenerNorma?: typeof gestor.obtenerNorma
  fichaSuin?: typeof suin.ficha
}

/**
 * Una cita resuelta, antes de darle forma. Cada rama devuelve DATOS y no texto
 * porque la forma depende del resto de la respuesta: en un lote, las citas de
 * la misma norma comparten ficha, y la línea de alcance es una para todas. Con
 * cada rama componiendo su texto, agrupar obligaba a volver a parsear lo que el
 * propio código acababa de escribir.
 */
export type Resuelta = {
  /** La cita tal como llegó: encabeza el bloque cuando la norma se cita una sola vez. */
  cita: string
  /** Identidad de la norma (`gestor:<id>`, `senado:<archivo>`, `corte:<sentencia>`); null si no resolvió. */
  clave: string | null
  /** Título oficial: encabeza el bloque cuando varias citas del lote dan con la misma norma. */
  titulo?: string
  /** Lo que recibe `alcance()`. */
  usos: Uso[]
  /** Lo propio de ESTA cita (equivalencia del código, tipo corregido, artículo ignorado). */
  avisos: string[]
  /** Todo lo que no es artículo: identificación, vigencia, siguiente paso, enlace. */
  ficha: string
  /** Un bloque por artículo pedido, sin la URL de la norma, que ya está en la ficha. */
  articulos: string[]
  /** Advertencias que cierran el bloque, después de los artículos. */
  pie?: string[]
}

/** Una cita sin norma: su bloque propio, con el motivo en la ficha. */
const sinNorma = (cita: string, usos: Uso[], ficha: string, avisos: string[] = []): Resuelta => ({
  cita,
  clave: null,
  usos,
  avisos,
  ficha,
  articulos: [],
})

/**
 * Línea de alcance de toda la respuesta: una fuente consultada para alguna cita
 * cuenta como consultada, porque la línea describe la respuesta entera y no
 * cada cita. El detalle se acumula: tres normas resueltas en el Gestor son
 * «norma resuelta ×3», no tres menciones del Gestor.
 */
function unirUsos(usos: Uso[]): Uso[] {
  const porClave = new Map<string, Map<string, number>>()
  for (const u of usos) {
    const detalles = porClave.get(u.clave) ?? new Map<string, number>()
    detalles.set(u.detalle ?? '', (detalles.get(u.detalle ?? '') ?? 0) + 1)
    porClave.set(u.clave, detalles)
  }
  return [...porClave].map(([clave, detalles]) => {
    const detalle = [...detalles]
      .filter(([d]) => d)
      .map(([d, n]) => (n > 1 ? `${d} ×${n}` : d))
      .join('; ')
    return detalle ? { clave, detalle } : { clave }
  })
}

/**
 * El bloque de una norma. Con una sola cita, el encabezado es la cita, como
 * siempre; con varias, el título oficial y la lista de citas, para que quien
 * pidió «art. 817 del Estatuto Tributario» reconozca la suya bajo «Decreto Ley
 * 624 de 1989». La ficha va una vez y los artículos en el orden pedido.
 */
function bloqueDeNorma(grupo: Resuelta[]): string {
  const p = grupo[0]!
  const cabecera =
    grupo.length === 1 ? `### ${p.cita}` : `### ${p.titulo ?? p.cita}\nCitas: ${grupo.map((g) => g.cita).join('; ')}`
  const unicos = (xs: string[]) => [...new Set(xs.filter(Boolean))]
  const articulos = unicos(grupo.flatMap((g) => g.articulos))
  const pie = unicos(grupo.flatMap((g) => g.pie ?? []))
  return (
    [cabecera, ...unicos(grupo.flatMap((g) => g.avisos)), p.ficha].join('\n') +
    articulos.map((a) => `\n\n${a}`).join('') +
    (pie.length ? `\n\n${pie.join('\n')}` : '')
  )
}

/**
 * El único compositor de `resolver_cita`: la cita suelta y el lote salen por
 * aquí, así que ambas vías dan la misma forma. Primero el alcance, una vez;
 * después un bloque por norma en el orden de su primera cita, y las citas que
 * no resolvieron, cada una en el suyo. `preambulo` son los avisos sobre los
 * parámetros, que se leen antes que los bloques.
 */
export function componer(piezas: Resuelta[], preambulo = ''): string {
  const grupos: Resuelta[][] = []
  const porClave = new Map<string, Resuelta[]>()
  for (const p of piezas) {
    const grupo = p.clave ? porClave.get(p.clave) : undefined
    if (grupo) {
      grupo.push(p)
      continue
    }
    const nuevo = [p]
    grupos.push(nuevo)
    if (p.clave) porClave.set(p.clave, nuevo)
  }
  return `${alcance(unirUsos(piezas.flatMap((p) => p.usos)))}\n\n${preambulo}${grupos.map(bloqueDeNorma).join('\n\n')}`
}

/** La línea de cita judicial ya compuesta, con lo que la relatoría no da declarado (nada se inventa). */
function citaOficial(p: Parameters<typeof citaCorteConstitucional>[0]): string {
  const c = citaCorteConstitucional(p)
  return c ? `Cita oficial: ${c.cita}${c.faltan.length ? ` (no consta: ${c.faltan.join(', ')})` : ''}` : ''
}

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

/**
 * Resuelve UNA cita de `resolver_cita` en datos (la forma la pone `componer`).
 * La ruta individual llama con una sola cita; el lote itera sobre esta misma
 * función, así que ambas vías resuelven igual.
 */
async function resolverUnaCita(cita: string, opciones: OpcionesCita = {}, deps: Deps = {}): Promise<Resuelta> {
  // Un radicado judicial de 23 dígitos no es una cita normativa: se identifica y se enruta a la corte.
  const radicado = parsearRadicado(cita)
  if (radicado) return resolverRadicado(cita, radicado)
  const c = parsearCita(cita)
  if (!c) {
    return sinNorma(
      cita,
      [],
      `No encontré una cita normativa en "${cita}". Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11", o usa buscar_normas.`,
    )
  }

  /**
   * `articulos` manda sobre el artículo escrito en la cita, y se anuncia:
   * callarlo sería contestar a otra pregunta con el mismo aire de certeza.
   */
  const pedidos = opciones.articulos?.length ? opciones.articulos : c.articulo ? [c.articulo] : []
  const articuloIgnorado =
    opciones.articulos?.length && c.articulo
      ? `Se ignoró el "artículo ${c.articulo}" de la cita: manda el parámetro articulos (${opciones.articulos.join(', ')}).`
      : ''

  const cod = codigoDe(c.tipo, c.numero, c.anio)
  // El Código Civil no está en el Gestor: su texto sale de la Secretaría del Senado.
  if (cod?.senado) return resolverCodigo({ cita, c, codigo: cod, pedidos, articuloIgnorado })
  // La equivalencia solo procede si la cita llegó por el nombre del código.
  const porCodigo = c.codigo ? cod : undefined

  // Las sentencias de la Corte se resuelven contra su relatoría, que está al día.
  // Con la Corte apagada no se cae al Gestor —que no publica sentencias— para
  // salir por un «no encontré» que se leería como «no existe».
  if (c.sentencia && !activa('corte')) {
    return sinNorma(
      cita,
      [],
      `${avisoApagada('corte')} Por eso no se puede ni afirmar ni negar que exista la sentencia ${c.sentencia}.`,
    )
  }
  if (c.sentencia) {
    const v = await corte.verificar(c.sentencia)
    if (v.estado === 'existe' && v.providencia) {
      const p = v.providencia
      const titulo = `${p.sentencia} (${p.tipo}) — Corte Constitucional`
      return {
        cita,
        clave: `corte:${p.sentencia}`,
        titulo,
        usos: [{ clave: 'corte', detalle: 'providencia verificada por su número' }],
        avisos: [],
        ficha: [
          titulo,
          `Fecha: ${p.fecha} · Publicación: ${p.publicacion} · Expediente: ${p.expediente}`,
          // El campo de la relatoría es el PONENTE, no la Sala (medido: 238 de 240 aciertos traen un solo nombre).
          p.magistrados.length ? `Ponente${p.magistrados.length > 1 ? 's' : ''} (según la relatoría): ${p.magistrados.join(', ')}` : '',
          citaOficial(p),
          p.tema ? `Tema: ${p.tema}` : '',
          p.sintesis ? `Síntesis: ${p.sintesis}` : '',
          `Texto completo: usa obtener_documento con fuente="corte" y ruta="${p.ruta}"`,
          `URL: ${p.url}`,
        ]
          .filter(Boolean)
          .join('\n'),
        articulos: [],
      }
    }
    /**
     * Negativa firme. Antes, una sentencia que la relatoría no tiene caía a la
     * rama del Gestor —que no publica sentencias— y salía por el "No encontré la
     * cita", que obliga a quien pregunta a decidir entre "no existe" y "no supe
     * buscarla". Con el número sondeado en las dos formas que la relatoría indexa
     * (medido el 2026-09-16: las C y las T casan con guion, las SU solo sin él),
     * la ausencia ya es un dato.
     */
    if (v.estado === 'no-existe') {
      return sinNorma(
        cita,
        [{ clave: 'corte', detalle: `sondeada con ${v.sondeos.map((s) => `«${s}»`).join(' y ')}` }],
        `No existe ninguna providencia con el número ${c.sentencia} en la relatoría de la Corte Constitucional.\n\n` +
          `Se buscó por el NÚMERO, no por el contenido, así que esto no dice nada sobre si hay una sentencia ` +
          `parecida: para eso, buscar_jurisprudencia por materia.`,
      )
    }
    if (v.estado === 'no-medido') {
      return sinNorma(
        cita,
        [{ clave: 'corte', detalle: 'no respondió' }],
        `No pude comprobar la sentencia ${c.sentencia} contra la relatoría de la Corte Constitucional: ` +
          `${v.motivo ?? 'la fuente no respondió'}.\n\n` +
          `Esto NO significa que no exista —significa que no se pudo comprobar—. Vuelve a intentarlo, o búscala ` +
          `por materia con buscar_jurisprudencia.`,
      )
    }
  }

  // La corrección del tipo escrito vive en validar_cita.ts para que el lote con
  // validar=true la aplique también: allí no se hacía, y devolvía "no fue
  // posible validar" para citas que esta ruta resolvía sin problema.
  const { r, tipoOficial, otroTitulo } = await validarCita.buscarCorrigiendoTipo(c, deps.buscar)
  // Solo se corrige el tipo que escribió el usuario. En «art. 817 del Estatuto
  // Tributario» el tipo «decreto» lo puso la tabla de códigos para buscar, y
  // decir «No existe un decreto 624 de 1989» le atribuía un error que no cometió.
  const tipoCorregido =
    tipoOficial && !c.codigo ? `No existe un «${c.tipo} ${c.numero} de ${c.anio}»; el tipo oficial es «${tipoOficial}».` : ''
  const otroTipo = otroTitulo
    ? ` Con ese número y año el Gestor sí tiene «${otroTitulo}», que es de otro tipo: si te referías` +
      ` a esa, pídela con su tipo exacto.`
    : ''
  const fichaSuin = deps.fichaSuin ?? suin.ficha

  if (!r.items.length) {
    // Sin norma resuelta no hay título oficial: la equivalencia sale de la tabla.
    const avisos = [porCodigo ? equivalencia(porCodigo, refCodigo(porCodigo)) : '', articuloIgnorado]
    // Que el Gestor no la tenga no significa que no exista: su corpus no
    // cubre todo el país. Antes de decir "no encontré" —que se lee como "esa
    // norma no existe"— se pregunta a SUIN, que sí la puede registrar.
    const f = c.anio && activa('suin') ? await fichaSuin(c.tipo, c.numero, c.anio) : null
    if (f?.ok) {
      const v = f.ficha
      return sinNorma(
        cita,
        [{ clave: 'gestor', detalle: '0 documentos' }, { clave: 'suin', detalle: 'ficha encontrada' }],
        `${cita} no está en el Gestor Normativo de Función Pública, pero SUIN-Juriscol sí la registra.\n` +
          (v.epigrafe ? `${v.epigrafe}\n` : '') +
          `Estado de vigencia según SUIN-Juriscol (ficha consultada hoy): ${v.estado || 'SUIN no publica el estado de esta norma'}\n` +
          `URL: ${v.url}\n\n` +
          suin.TEXTO_NO_PUBLICO +
          (pedidos.length ? ` Por eso no se puede devolver el artículo ${pedidos.join(', ')}: búscalo en el Diario Oficial.` : ''),
        avisos,
      )
    }
    const suinCayo = f?.ok === false && f.razon === 'ficha-caida'
    return sinNorma(
      cita,
      [
        { clave: 'gestor', detalle: '0 documentos' },
        ...(f ? [{ clave: 'suin', detalle: suinCayo ? 'no respondió' : 'sin ficha' }] : []),
      ],
      `No encontré la cita "${cita}" en las fuentes consultadas.\n\n` +
        ((c.anio ? `Prueba sin el año, o verifica el número.` : `Prueba indicando el año.`) + otroTipo) +
        (f?.ok === false && f.detalle
          ? suinCayo
            ? `\n\nSUIN-Juriscol no respondió (${f.detalle}): no se pudo comprobar si la registra. Vuelve a intentarlo antes de concluir que no existe.`
            : `\n\nSUIN-Juriscol: ${f.detalle}.`
          : '') +
        (c.anio && !activa('suin') ? `\n\n${avisoApagada('suin')} Una norma que el Gestor no tiene solo la podía registrar SUIN.` : ''),
      avisos,
    )
  }
  /**
   * Sin año, el número NO identifica una norma. "Decreto 1072" existe en 2025
   * (tarifas de energía), 2015 (Único Reglamentario del Sector Trabajo), 2004
   * y 1999, y el Gestor devuelve primero el más reciente. Entregar ese como si
   * fuera "el" Decreto 1072 es el error caro de esta herramienta: acierta la
   * forma —es un decreto real con ese número— y falla el fondo, sin que nada
   * en la respuesta invite a sospecharlo. Se devuelven los candidatos y se
   * pide el año, igual que ya se hace cuando el tipo no coincide.
   */
  if (!c.anio) {
    const conAnio = r.items
      .map((i) => ({ i, anio: i.titulo.match(/\bde\s+(\d{4})\b/i)?.[1] ?? '' }))
      .filter((x) => x.anio)
    if (new Set(conAnio.map((x) => x.anio)).size > 1) {
      return sinNorma(
        cita,
        [{ clave: 'gestor', detalle: `${conAnio.length} candidatos` }],
        `La cita "${cita}" es ambigua: el Gestor tiene ${conAnio.length} normas con ese tipo y número, de años ` +
          `distintos. No se elige una por ti.\n\n` +
          conAnio
            .sort((a, b) => Number(b.anio) - Number(a.anio))
            .map(({ i }) => `- ${i.titulo} (id ${i.id})\n  ${i.url}`)
            .join('\n') +
          `\n\nRepite la cita con el año ("${c.tipo} ${c.numero} de ${conAnio[0]!.anio}")` +
          (c.articulo ? `, conservando el artículo ("art. ${c.articulo} de …")` : '') +
          `. Si no sabes cuál es, díselo a quien pregunta en vez de escoger: el número solo no identifica la norma.`,
      )
    }
  }

  const n = r.items[0]!
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

export const TITULO = 'Resolver una cita normativa'

export const DESCRIPCION =
  'Ruta rápida y exacta para citas de leyes, decretos, sentencias, artículos y códigos citados por su nombre ' +
  '("art. 191 del Código de Comercio"). Úsala SIEMPRE que la pregunta mencione una norma concreta: ' +
  'buscar_normas y buscar_por_tema son para cuando no la hay. Devuelve la identificación oficial con su ' +
  'enlace, la vigencia y el texto pedido, y dice contra qué norma resolvió. Solo consulta, no guarda nada. ' +
  'Tres modos: cita sola; citas, un lote que manda sobre cita y se agrupa por norma; o articulos con cita ' +
  'apuntando a UNA norma, que se descarga una vez (con citas, articulos se ignora). validar=true cambia la ' +
  'respuesta a un VEREDICTO sobre la cita (validada, parcialmente validada o no validable), sin texto ni ' +
  'vigencia; url y formato solo valen con validar. Para las reformas de una norma usa historial_norma; para ' +
  'quién cita una sentencia, linea_jurisprudencial.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  cita: z
    .string()
    .optional()
    .describe('Ej.: "Ley 909 de 2004", "C-337/11", "art. 6 de la Ley 1221 de 2008", "art. 191 del Código de Comercio"'),
  citas: z
    .array(z.string())
    .optional()
    .describe('Varias citas a la vez, ej. ["Ley 909 de 2004", "C-337/11"]: cada una se resuelve y se devuelve con su enlace'),
  articulos: z
    .preprocess((v) => (Array.isArray(v) ? v.map(numeroDeArticulo) : v), z.array(z.string()).optional())
    .describe(
      'Varios artículos de la MISMA norma en una sola llamada, ej. ["705", "707", "710"]. Se usa con cita ' +
        'apuntando a la norma ("Decreto Ley 624 de 1989"); la norma se descarga una vez y se extrae cada artículo.'
    ),
  contexto: z
    .boolean()
    .optional()
    .describe(
      'Por defecto true. Con false se omite el extracto de tema asociado y queda solo la identificación, la ' +
        'vigencia y el texto pedido.'
    ),
  validar: z
    .boolean()
    .optional()
    .describe(
      'En vez de la resolución, comprueba que la cita (y el enlace, si se da con url) coincide con lo que ' +
        'devuelve el Gestor: número/año, dominio y artículo. Clasifica en "cita validada", "parcialmente ' +
        'validada" o "no fue posible validar". NUNCA afirma vigencia.'
    ),
  url: z.string().optional().describe('Enlace a comprobar (solo con validar=true)'),
  formato: z
    .enum(['markdown', 'json'])
    .optional()
    .describe(
      'Solo con validar=true: "json" devuelve el resultado como objeto (fecha_consulta, y por cita: resultado, ' +
        'comprobaciones, titulo, url, nota), sin cabecera ni pie, para encadenarlo sin releer texto.'
    ),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir(
  { cita, citas, articulos, contexto, validar, url, formato }: Params,
  deps: Deps = {},
): Promise<string> {
  if (validar) {
    const datos = await validarCita.escribir({
      ...(cita !== undefined ? { cita } : {}),
      ...(citas !== undefined ? { citas } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(formato !== undefined ? { formato } : {}),
    })
    // El modo json y el de texto devuelven el MISMO string: quien envuelve es
    // `registrarHerramienta`, que ya distingue los dos casos igual que hacía
    // este bloque cuando el registro estaba en línea.
    return datos
  }
  // Lote sin validación: cada cita se resuelve por la misma vía que una cita
  // individual, y `componer` agrupa las de la misma norma bajo una ficha. Un
  // fallo de red de una cita se anota en su bloque y no tumba a las demás.
  if (citas?.length) {
    const piezas: Resuelta[] = []
    for (const una of citas) {
      try {
        piezas.push(await resolverUnaCita(una, { contexto }, deps))
      } catch (e) {
        piezas.push(
          sinNorma(
            una,
            [],
            `La fuente no respondió en esta consulta (${(e as Error).message}). ` +
              `Vuelve a intentarlo antes de afirmar nada.\nEnlace: (sin enlace)`,
          ),
        )
      }
    }
    // `articulos` es de UNA norma: con un lote no se sabe a cuál aplicarlo, y
    // dejarlo caer en silencio contestaría a otra pregunta.
    const sobrante = articulos?.length
      ? `articulos (${articulos.join(', ')}) se ignoró: es para varios artículos de UNA norma, no para un lote. ` +
        `Pídelos con cita apuntando a la norma.\n\n`
      : ''
    // Igual con `cita`: el lote manda, pero callarlo dejaría creer que también
    // se resolvió la cita suelta.
    const citaSuelta = cita
      ? `cita ("${cita}") se ignoró: manda el lote citas (${citas.length}). Usa una vía u otra, no las dos.\n\n`
      : ''
    return componer(piezas, citaSuelta + sobrante)
  }
  if (!cita) {
    return vacio(
      'una cita normativa',
      'Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11" (y varias a la vez con citas), o usa buscar_normas.'
    )
  }
  return componer([await resolverUnaCita(cita, { articulos, contexto }, deps)])
}
