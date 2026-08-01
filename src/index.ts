import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { idTipo, parsearCita } from './citas.ts'
import {
  advertenciasVigencia,
  avisoSinTexto,
  cargar,
  textoDe,
  normalizarRotulo,
  articulo as extraerArticulo,
  fragmentos,
  indiceArticulos,
  historial,
  seccion as seccionDe,
  seccionesPresentes,
  trocear,
  sinTildes,
} from './parse.ts'
import { NoExisteError } from './parse.ts'
import { VERSION, pedir as pedirHttp } from './http.ts'
import { avisoVersion } from './actualizacion.ts'
import * as gestor from './fuentes/gestor.ts'
import * as corte from './fuentes/corte.ts'
import * as suin from './fuentes/suin.ts'
import * as dian from './fuentes/normograma.ts'
import * as suprema from './fuentes/cortesuprema.ts'
import * as consejo from './fuentes/consejoestado.ts'


const DESCARGO =
  'Fuente oficial; los datos se publican con propósitos informativos. Verifica siempre en el enlace antes de tomar una decisión.'

const hoy = () => new Date().toISOString().slice(0, 10)

/** Toda respuesta sale fechada y con el descargo: es la fuente lo que la hace útil. */
const txt = (s: string) => ({
  content: [{ type: 'text' as const, text: `${s}\n\nConsulta del ${hoy()}. ${DESCARGO}${avisoVersion()}` }],
})

/** Nunca se devuelve una lista vacía a secas: el vacío se explica. */
const vacio = (que: string, sugerencia: string) =>
  txt(`No encontré ${que} en las fuentes consultadas.\n\n${sugerencia}`)

// --- índice temático empaquetado -----------------------------------------

// El título solo viene en las ocho primeras normas de cada fila; ver
// scripts/generar-indice.ts. Los ids están todos.
type Indice = { generado: string; filas: { t: string; s: string; ts: string; n: [string, string?][] }[] }
let indice: Indice | null | undefined

function cargarIndice(): Indice | null {
  if (indice !== undefined) return indice
  try {
    // El bundle vive en server/index.js y el índice en datos/, junto al manifiesto.
    indice = JSON.parse(readFileSync(new URL('../datos/indice-tematico.json', import.meta.url), 'utf8')) as Indice
  } catch {
    indice = null // sin índice se consulta el portal; no es un fallo fatal
  }
  return indice
}

/**
 * Par tema/subtema del índice que mejor case con el término. Entre varios se
 * prefiere el que agrupa más normas: "teletrabajo" existe como tema propio con
 * 1 documento y como subtema de EMPLEO con 55, y el útil es el segundo.
 */
function temaDelIndice(termino: string): { t: string; s: string } | null {
  const idx = cargarIndice()
  const q = sinTildes(termino).toLowerCase().trim()
  if (!idx || !q) return null
  const candidatas = idx.filas.filter((f) => sinTildes(f.s).toLowerCase().includes(q))
  if (!candidatas.length) return null
  const exacta = candidatas.filter((f) => sinTildes(f.s).toLowerCase() === q)
  return (exacta.length ? exacta : candidatas).sort((a, b) => b.n.length - a.n.length)[0] ?? null
}

function frescura(generado: string): string {
  const meses = (Date.now() - Date.parse(generado)) / (30 * 24 * 3600 * 1000)
  return meses > 3
    ? `\n\nAVISO: el índice temático empaquetado se generó el ${generado} (hace ~${Math.round(meses)} meses). Puede faltar normativa reciente; actualiza la extensión.`
    : ''
}

// --- servidor ------------------------------------------------------------

/**
 * Instrucciones de uso que viajan con el servidor: el cliente MCP las recibe en
 * el `initialize` y las pone en contexto. Es el único mecanismo que corrige lo
 * que ninguna prueba puede verificar —que se elija la herramienta correcta—,
 * así que aquí van las reglas de enrutamiento y las trampas del portal, no una
 * descripción del producto. Conviene que sea corto: ocupa contexto siempre.
 */
const INSTRUCCIONES = `Fuentes oficiales de normativa colombiana: Gestor Normativo de Función Pública, Corte Constitucional, Corte Suprema, Consejo de Estado, SUIN-Juriscol (MinJusticia) y normograma de la DIAN.

Qué herramienta usar:
- La pregunta menciona una norma concreta ("Ley 909 de 2004", "Decreto 1083", "C-337/11", "el art. 6 de la Ley 1221") → resolver_cita. Es exacta; el buscador por palabras no.
- La pregunta es por materia ("¿qué normas hay sobre teletrabajo?") → buscar_por_tema. El buscador por palabras del portal solo indexa resúmenes y encuentra poquísimo: "teletrabajo" casa con 3 documentos cuando el subtema oficial tiene 55.
- Hay que saber qué dice una norma sobre algo → obtener_norma con buscar_en_texto. Esa es la verdadera búsqueda de texto completo; el portal no la ofrece.
- Sentencias y autos → buscar_jurisprudencia (Corte Constitucional, al día). El Gestor casi no tiene jurisprudencia reciente.
- Normativa que el Gestor no tiene, o exploración por materia/sector del corpus histórico (desde 1844) → buscar_en_suin. NUNCA la uses para saber si algo está vigente: su campo de vigencia es del índice de búsqueda y contradice la ficha. La vigencia sale de resolver_cita.
- Impuestos, aduanas o cambios (retención, IVA, renta, importación) → buscar_normativa_tributaria y obtener_documento_dian. Ninguna otra herramienta cubre esa materia.
- Jurisprudencia de la Corte SUPREMA (casación civil, laboral, penal y sus tutelas) → buscar_jurisprudencia_suprema. Es un tribunal DISTINTO de la Corte Constitucional: no las mezcles. Exige indicar sala, y cada resultado trae las normas que cita, que puedes resolver con resolver_cita.
- Qué le pasó a una norma o a un artículo (quién lo modificó, adicionó o derogó) → obtener_norma con historial=true. Devuelve las notas literales del portal, sin ordenarlas ni deducir cuál rige hoy.
- El fallo de una sentencia, sin leerla entera → obtener_sentencia con seccion="decision": trae el RESUELVE. La T-099/24 pasa de 140.162 a 39.906 caracteres.
- Jurisprudencia del CONSEJO DE ESTADO (contencioso administrativo: nulidad y restablecimiento, contratación estatal, nulidad electoral, reparación directa) → buscar_jurisprudencia_consejo_estado. Tercer tribunal distinto de los otros dos; cada resultado trae el problema jurídico y su respuesta.
- Por qué una norma aplica a un tema → explicar_relacion_tema con el temsubid y el normid de la MISMA fila de buscar_por_tema.

Reglas al responder:
- Cita siempre el enlace y la fecha de consulta que devuelven las herramientas. Una afirmación normativa sin fuente verificable no sirve.
- NUNCA afirmes por tu cuenta que una norma o un artículo está vigente. El Gestor y la relatoría no publican la vigencia: solo hay marcas de "Derogado" y "Modificado por" dentro del texto. Traslada esas advertencias y di con claridad que no se puede confirmar.
- La vigencia solo existe para LEYES: el índice de SUIN cubre 11.585 leyes y casi ningún decreto, porque los sitemaps de decretos del portal devuelven 404. Que no aparezca para un decreto NO significa que esté derogado ni vigente: significa que no consta.
- La ÚNICA excepción: si resolver_cita devuelve un "Estado de vigencia según SUIN-Juriscol", cítalo con su fecha y su enlace, tal cual, sin traducirlo a un sí o un no ("Vigencia en Estudio" no es "vigente"). Si esa línea no aparece, es que no consta: vuelve a la regla anterior.
- Que una norma no esté en el Gestor NO significa que no exista: su corpus no cubre todo el país. Si resolver_cita responde que la norma está en SUIN-Juriscol y no en el Gestor, esa es una respuesta completa, no un fallo; para un artículo concreto vuelve a preguntar citándolo ("art. 3 de la Ley 1541 de 2012").
- El "extracto temático" que acompaña a cada resultado NO resume la norma: es el apunte de un tema al que está asociada. Para el objeto real usa obtener_norma.
- Si una herramienta devuelve vacío, es que no se encontró; no completes con conocimiento propio.
- Un documento sin texto NO es un documento que no diga nada. Si la respuesta avisa de que es un escaneo o de que el portal no publicó el texto, dilo así y remite al enlace; no concluyas nada sobre su contenido.
- Nunca inventes números de norma, artículos ni sentencias. Si no aparecen en una respuesta, no existen para efectos de esta conversación.
- Tres numeraciones distintas y no intercambiables: temsubid (solo de buscar_por_tema), subtemaid (de listar_subtemas, va en buscar_normas) y tema (de listar_catalogos).

Esto no es asesoría jurídica.`

const server = new McpServer({ name: 'normativa-colombia', version: VERSION }, { instructions: INSTRUCCIONES })

server.registerTool(
  'resolver_cita',
  {
    title: 'Resolver una cita normativa',
    description:
      'Ruta rápida y exacta para citas como "Ley 909 de 2004", "Decreto 1083", "C-337/11", "T-099/24" o ' +
      '"artículo 6 de la Ley 1221 de 2008". Úsala SIEMPRE que la pregunta mencione una norma concreta: ' +
      'evita el buscador por palabras, que es impreciso.',
    inputSchema: { cita: z.string().describe('Ej.: "Ley 909 de 2004", "C-337/11", "art. 6 de la Ley 1221 de 2008"') },
  },
  async ({ cita }) => {
    const c = parsearCita(cita)
    if (!c) return vacio(`una cita normativa en "${cita}"`, 'Escríbela como "Ley 909 de 2004" o "C-337/11", o usa buscar_normas.')

    // Las sentencias de la Corte se resuelven contra su relatoría, que está al día.
    if (c.sentencia) {
      const p = await corte.porSentencia(c.sentencia)
      if (p) {
        return txt(
          [
            `${p.sentencia} (${p.tipo}) — Corte Constitucional`,
            `Fecha: ${p.fecha} · Publicación: ${p.publicacion} · Expediente: ${p.expediente}`,
            p.magistrados.length ? `Magistrados: ${p.magistrados.join(', ')}` : '',
            p.tema ? `Tema: ${p.tema}` : '',
            p.sintesis ? `Síntesis: ${p.sintesis}` : '',
            `Texto completo: usa obtener_sentencia con ruta="${p.ruta}"`,
            `URL: ${p.url}`,
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }
    }

    let r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })

    /**
     * El tipo escrito casi nunca es el tipo oficial: "Decreto 1567 de 1998" no
     * existe, pero "Decreto Ley 1567 de 1998" sí. Se reintenta sin filtrar por
     * tipo, PERO solo se acepta si el tipo oficial contiene al escrito: número y
     * año no identifican una norma —existen a la vez la Ley 1541 de 2012 y el
     * Decreto 1541 de 2012—, y devolver el otro sería peor que no encontrar
     * nada, porque nadie sospecharía del cambio.
     */
    let tipoCorregido = ''
    let otroTipo = ''
    if (!r.items.length && c.anio) {
      const sinTipo = await gestor.buscar({ numero: c.numero, anio: c.anio })
      const real = sinTipo.items[0]?.titulo.match(/^(.+?)\s+\d/)?.[1]?.trim()
      const escrito = sinTildes(c.tipo).toLowerCase()
      if (real && new RegExp(`\\b${escrito}\\b`, 'i').test(sinTildes(real).toLowerCase())) {
        r = sinTipo
        tipoCorregido = `\nNo existe un «${c.tipo} ${c.numero} de ${c.anio}»; el tipo oficial es «${real}».\n`
      } else if (real) {
        // No se corta aquí: la norma puede existir en SUIN aunque el Gestor solo
        // tenga la homónima de otro tipo. La pista se guarda para el vacío.
        otroTipo =
          ` Con ese número y año el Gestor sí tiene «${sinTipo.items[0]!.titulo}», que es de otro tipo: si te referías` +
          ` a esa, pídela con su tipo exacto.`
      }
    }

    if (!r.items.length) {
      // Que el Gestor no la tenga no significa que no exista: su corpus no
      // cubre todo el país. Antes de decir "no encontré" —que se lee como "esa
      // norma no existe"— se pregunta a SUIN, que sí la puede registrar.
      const v = c.anio ? await suin.vigencia(c.tipo, c.numero, c.anio).catch(() => null) : null
      if (v) {
        const arts = indiceArticulos(v.texto)
        const art = c.articulo ? extraerArticulo(v.texto, c.articulo) : null
        return txt(
          `${cita} no está en el Gestor Normativo de Función Pública, pero SUIN-Juriscol sí la publica.\n` +
            (v.epigrafe ? `${v.epigrafe}\n` : '') +
            `Estado de vigencia según SUIN (índice del ${v.generado}): ` +
            `${v.estado || 'SUIN no publica el estado de esta norma'}\n` +
            `URL: ${v.url}\n` +
            `Texto: ${v.texto.length} caracteres${arts.length ? `; artículos ${arts.join(', ')}` : ''}.` +
            (art
              ? `\n\n--- Artículo ${c.articulo} ---\n${art}\n${advertenciasVigencia(art).join('\n')}`
              : `\n\nEl articulado no se devuelve entero: pide el artículo que necesitas en la cita ("art. 3 de ${cita}") o abre el enlace.`),
        )
      }
      return vacio(
        `la cita "${cita}"`,
        (c.anio ? `Prueba sin el año, o verifica el número.` : `Prueba indicando el año.`) + otroTipo,
      )
    }
    const n = r.items[0]!

    // La vigencia solo la publica SUIN, y solo si el índice empaquetado tiene
    // esta norma. Que falte no es un fallo: se calla y sigue mandando la regla
    // de no afirmar vigencia.
    // Si la cita vino sin año ("Decreto 1083"), se toma el del título que
    // resolvió el Gestor: sin esto la vigencia se perdía justo en las citas
    // cómodas, que son las que la gente escribe.
    const anio = c.anio ?? n.titulo.match(/\bde\s+(\d{4})\b/i)?.[1]
    let vig = ''
    if (anio) {
      try {
        const v = await suin.vigencia(c.tipo, c.numero, anio)
        if (v) {
          vig =
            `\nEstado de vigencia según SUIN-Juriscol (índice del ${v.generado}): ` +
            `${v.estado || 'SUIN no publica el estado de esta norma'}\n  ${v.url}`
        }
      } catch {
        /* SUIN es un complemento: si no responde, la cita se resuelve igual */
      }
    }

    let extra = ''
    if (c.articulo) {
      const norma = await gestor.obtenerNorma(n.id)
      const art = extraerArticulo(norma.texto, c.articulo)
      extra = art
        ? `\n\n--- Artículo ${c.articulo} ---\n${art}\n${advertenciasVigencia(art).join('\n')}`
        : `\n\nNo encontré un "artículo ${c.articulo}" en el texto. Usa obtener_norma con buscar_en_texto.`
    }
    return txt(
      `${n.titulo}\n${tipoCorregido}id: ${n.id}\n` +
        // No es un resumen de la norma: el Gestor no publica uno. Es el extracto
        // de UN tema al que está asociada, y en normas compiladoras como el
        // Decreto 1083 describe una porción mínima del contenido.
        (n.resumen
          ? `Extracto de un tema asociado (NO resume la norma; usa obtener_norma para su objeto y articulado): ${n.resumen}\n`
          : '') +
        `URL: ${n.url}${vig}${extra}`,
    )
  },
)

server.registerTool(
  'buscar_normas',
  {
    title: 'Buscar normas en el Gestor Normativo',
    description:
      'Busca leyes, decretos, resoluciones, conceptos y sentencias del sector público colombiano. ' +
      'IMPORTANTE: el buscador del portal indexa solo los resúmenes temáticos, NO el articulado completo, ' +
      'y une los términos con OR. Usa pocas palabras y muy distintivas. Para buscar dentro del texto de una ' +
      'norma concreta, usa obtener_norma con buscar_en_texto. Para una cita exacta, usa resolver_cita.',
    inputSchema: {
      palabras: z.string().optional().describe('Términos distintivos; evita frases largas'),
      tipo_documento: z.string().optional().describe('Nombre o id: "Ley", "Decreto", "Sentencia", "Concepto"'),
      numero: z.coerce.string().regex(/^\d+$/).optional().describe('Número de la norma, como texto. Ej.: "909"'),
      anio: z.coerce.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos, como texto. Ej.: "2004"'),
      entidad: z.string().optional().describe('Nombre o id: "Corte Constitucional", "Congreso de la República"'),
      tema: z.string().optional().describe('Nombre o id de tema del catálogo'),
      subtema: z.coerce
        .string()
        .optional()
        .describe('subtemaid de listar_subtemas, o su nombre si además indicas tema. NO sirve el temsubid de buscar_por_tema.'),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    },
  },
  async ({ palabras, tipo_documento, numero, anio, entidad, tema, subtema, limite }) => {
    const r = await gestor.buscar({ palabras, tipo: tipo_documento, numero, anio, entidad, tema, subtema })
    const notas = r.nota ? [r.nota] : []

    // El índice de palabras del portal es pobrísimo: "teletrabajo" solo casa con
    // 3 documentos en todo el corpus, y con ninguno de los 43 conceptos que sí
    // están clasificados bajo ese subtema. Cuando la búsqueda por palabras rinde
    // poco, se reintenta por la vía temática, que es la que de verdad encuentra.
    if (palabras && r.items.length < 5 && !subtema) {
      const par = temaDelIndice(palabras)
      if (par) {
        try {
          const sub = await gestor.subtemaPorNombre(par.t, par.s)
          if (sub) {
            const via = await gestor.buscar({ tipo: tipo_documento, numero, anio, entidad, subtema: sub })
            const vistos = new Set(r.items.map((i) => i.id))
            const extra = via.items.filter((i) => !vistos.has(i.id))
            if (extra.length) {
              r.items.push(...extra)
              notas.push(
                `La búsqueda por palabras solo halló ${r.total}. Se reconsultó con el subtema "${normalizarRotulo(par.s)}" ` +
                  `(id ${sub}) del catálogo de búsqueda y se añadieron ${extra.length} documentos. Ese catálogo y el de ` +
                  `buscar_por_tema son taxonomías distintas del portal, así que allí estos documentos pueden aparecer ` +
                  `bajo otro tema.`,
              )
            }
          }
        } catch {
          /* la vía temática es un refuerzo: si falla, quedan los de palabras */
        }
      }
    }

    if (!r.items.length) {
      return vacio(
        'normas con esos filtros',
        `Filtros aplicados: ${r.aplicados.join(', ') || '(ninguno)'}.` +
          (r.nota ? ` ${r.nota}` : '') +
          ' Si los filtros se resolvieron bien, es que no existe esa combinación en el Gestor: prueba quitando el año' +
          ' o la entidad. Si buscaste por palabras, recuerda que el portal solo indexa los resúmenes temáticos:' +
          ' usa buscar_por_tema.',
      )
    }
    const lista = r.items
      .slice(0, limite)
      .map((i) => `- ${i.titulo} (id ${i.id})\n  Extracto temático: ${i.resumen || '(ninguno)'}\n  ${i.url}`)
      .join('\n')
    const mas = r.items.length > limite ? `\n\nSe muestran ${limite} de ${r.items.length} reunidos.` : ''
    return txt(
      `${r.items.length} documento(s) reunido(s).${notas.length ? `\n${notas.join(' ')}` : ''}\n\n${lista}${mas}`,
    )
  },
)

server.registerTool(
  'buscar_por_tema',
  {
    title: 'Buscar por tema y subtema',
    description:
      'Consulta temática oficial: devuelve tema, subtema y las normas, sentencias y conceptos asociados. ' +
      'Resuelve contra un índice empaquetado (instantáneo, funciona aunque el portal esté caído). ' +
      'Cada resultado trae temsubid y normid para pedir después explicar_relacion_tema. ' +
      'OJO con los identificadores: el temsubid que devuelve esta herramienta SOLO sirve en ' +
      'explicar_relacion_tema. NO es el mismo número que el subtema de listar_subtemas (que va en el ' +
      'parámetro subtema de buscar_normas) ni que el tema de listar_catalogos. Son tres numeraciones distintas ' +
      'del portal y mezclarlas devuelve resultados equivocados.',
    inputSchema: {
      texto: z.string().describe('Tema a buscar, ej. "teletrabajo", "encargo", "prima de servicios"'),
      limite: z.coerce.number().int().min(1).max(50).default(15),
    },
  },
  async ({ texto, limite }) => {
    const idx = cargarIndice()
    const q = sinTildes(texto).toLowerCase().trim()

    if (idx) {
      const filas = idx.filas.filter(
        (f) => sinTildes(f.t).toLowerCase().includes(q) || sinTildes(f.s).toLowerCase().includes(q),
      )
      if (filas.length) {
        const salida = filas
          .slice(0, limite)
          .map(
            (f) =>
              `- ${normalizarRotulo(f.t)} / ${normalizarRotulo(f.s)} (temsubid ${f.ts})\n` +
              f.n.slice(0, 8).map(([id, tit]) => `    · ${tit} (normid ${id})`).join('\n') +
              (f.n.length > 8 ? `\n    … y ${f.n.length - 8} más` : ''),
          )
          .join('\n')
        return txt(
          `${filas.length} tema(s)/subtema(s) coinciden con "${texto}".\n\n${salida}` +
            (filas.length > limite ? `\n\nSe muestran ${limite} de ${filas.length}.` : '') +
            frescura(idx.generado) +
            `\n\nÍndice generado el ${idx.generado}. ${DESCARGO}`,
        )
      }
    }

    const filas = await gestor.tematica(texto)
    if (!filas.length) return vacio(`temas relacionados con "${texto}"`, 'Prueba un término más general o usa buscar_normas.')
    const salida = filas
      .slice(0, limite)
      .map(
        (f) =>
          `- ${normalizarRotulo(f.tema)} / ${normalizarRotulo(f.subtema)} (temsubid ${f.temsubid})\n` +
          f.documentos.slice(0, 8).map((d) => `    · ${d.titulo} (normid ${d.normid})`).join('\n'),
      )
      .join('\n')
    return txt(`${filas.length} resultado(s) para "${texto}".\n\n${salida}`)
  },
)

server.registerTool(
  'obtener_norma',
  {
    title: 'Obtener el texto de una norma',
    description:
      'Trae metadatos y texto de una norma por su id. NUNCA devuelve el documento entero por defecto: ' +
      'el Decreto 1083 de 2015 tiene 925.000 caracteres. Usa buscar_en_texto para encontrar un tema dentro ' +
      'del articulado (esta es la verdadera búsqueda de texto completo), o articulo para un artículo puntual.',
    inputSchema: {
      id: z.coerce.string().regex(/^\d+$/).describe('id numérico de la norma, como texto. Ej.: "31431"'),
      buscar_en_texto: z.string().optional().describe('Devuelve solo los fragmentos que mencionan este término'),
      articulo: z.string().optional().describe('Número de artículo, ej. "6" o "2.2.5.1.5"'),
      historial: z
        .boolean()
        .default(false)
        .describe(
          'En vez del texto, devuelve qué normas modificaron, adicionaron o derogaron la norma —o el artículo, si ' +
            'se indica— reconstruido de las notas del propio portal. El Decreto 1083 trae 99 cambios distintos.',
        ),
      desde: z.coerce.number().int().min(0).default(0),
      max_pasajes: z.coerce.number().int().positive().optional().describe('Máximo de pasajes con buscar_en_texto (por defecto 10)'),
      limite_caracteres: z.coerce
        .number()
        .int()
        .positive()
        .default(8000)
        .describe('Tope de caracteres del TEXTO devuelto; se aplica también con buscar_en_texto. La respuesta añade encabezado y temas asociados. Se ajusta al rango 200–40.000.'),
    },
  },
  async ({ id, buscar_en_texto, articulo, historial: pedirHistorial, desde, limite_caracteres, max_pasajes }) => {
    const tope = Math.min(Math.max(limite_caracteres, 200), 40_000)
    let n: Awaited<ReturnType<typeof gestor.obtenerNorma>>
    try {
      n = await gestor.obtenerNorma(id)
    } catch (e) {
      if (e instanceof NoExisteError) return vacio(`una norma con id ${id}`, 'Verifica el id con buscar_normas o resolver_cita.')
      throw e
    }
    const cab = [
      n.titulo,
      ...Object.entries(n.fechas).map(([k, v]) => `${k}: ${v}`),
      `URL: ${n.url}`,
      `PDF: ${n.urlPdf}`,
    ].join('\n')

    if (n.texto.length < 200) {
      return txt(`${cab}\n\n${avisoSinTexto(n.texto.length, n.urlPdf, await gestor.pdfEscaneado(n.id))}`)
    }

    if (pedirHistorial) {
      const ambito = articulo ? extraerArticulo(n.texto, articulo) : n.texto
      if (articulo && !ambito) {
        return txt(`${cab}\n\nNo encontré el artículo ${articulo}. Artículos detectados: ${indiceArticulos(n.texto).join(', ') || '(ninguno)'}`)
      }
      const cambios = historial(ambito!)
      const donde = articulo ? `el artículo ${articulo}` : 'esta norma'
      if (!cambios.length) {
        return txt(
          `${cab}\n\nLas notas del Gestor no registran cambios sobre ${donde}. Eso NO equivale a que siga intacto: ` +
            `el portal no siempre anota las reformas, y la vigencia se consulta con resolver_cita.`,
        )
      }
      return txt(
        `${cab}\n\n${cambios.length} cambio(s) anotados sobre ${donde}, en el orden en que aparecen en el documento:\n\n` +
          cambios
            .map(
              (c) =>
                `- ${c.accion.toUpperCase()}${c.norma ? ` por ${c.norma} de ${c.anio}` : ''}` +
                `${c.articulo ? `, artículo ${c.articulo}` : ''}\n  Nota literal: «${c.literal}»`,
            )
            .join('\n') +
          `\n\nSon las notas que el propio portal incrusta en el texto, citadas tal cual. No están ordenadas por ` +
          `fecha ni se deduce cuál rige hoy: para eso hay que leer el artículo y comprobar la vigencia.`,
      )
    }

    let cuerpo: string
    let avisoTexto = ''

    if (articulo) {
      const art = extraerArticulo(n.texto, articulo)
      if (!art) {
        return txt(
          `${cab}\n\nNo encontré el artículo ${articulo}. Artículos detectados: ${indiceArticulos(n.texto).join(', ') || '(ninguno)'}`,
        )
      }
      cuerpo = art
    } else if (buscar_en_texto) {
      const f = fragmentos(n.texto, buscar_en_texto, 400, max_pasajes ?? 10, tope)
      if (!f.total) {
        return txt(
          `${cab}\n\nEl término "${buscar_en_texto}" no aparece en el texto de esta norma ` +
            `(${n.texto.length} caracteres revisados).`,
        )
      }
      cuerpo = f.trozos.join('\n\n---\n\n')
      avisoTexto =
        `${f.total} aparición(es) de "${buscar_en_texto}", agrupadas en ${f.pasajes} pasaje(s); se muestran ${f.mostrados}` +
        (f.mostrados < f.pasajes ? ` (los demás no caben en ${tope} caracteres: sube limite_caracteres o afina el término).` : '.')
    } else {
      const t = trocear(n.texto, desde, tope)
      cuerpo = t.texto
      const arts = indiceArticulos(n.texto)
      avisoTexto =
        `Texto total: ${t.total} caracteres. Se muestran ${t.texto.length} desde la posición ${t.desde}` +
        (t.omitido > 0 ? `; quedan ${t.omitido} sin mostrar (usa desde/limite_caracteres o buscar_en_texto).` : '.') +
        (arts.length ? `\nArtículos detectados: ${arts.join(', ')}` : '')
    }

    const avisos = advertenciasVigencia(cuerpo)
    // Los temas venían en el orden del portal, así que al buscar "teletrabajo"
    // en el Decreto 1083 salían diez de bienestar social. Se suben los que
    // mencionan lo buscado y se dice cuántos hay en total.
    const aguja = sinTildes(buscar_en_texto ?? articulo ?? '').toLowerCase().trim()
    const pertinente = (t: (typeof n.temas)[number]) =>
      Number(sinTildes(`${t.tema} ${t.subtema} ${t.restrictor}`).toLowerCase().includes(aguja))
    const ordenados = aguja ? [...n.temas].sort((a, b) => pertinente(b) - pertinente(a)) : n.temas
    // Con un presupuesto corto no tiene sentido gastar la mitad en temas.
    const cuantosTemas = tope < 2000 ? 3 : 10

    const temas = ordenados.length
      ? `\n\nTemas asociados (${Math.min(10, ordenados.length)} de ${ordenados.length}` +
        `${aguja ? ', primero los que mencionan lo buscado' : ', sin ordenar por relevancia'}):\n` +
        ordenados
          .slice(0, cuantosTemas)
          .map((t) => `- ${normalizarRotulo(t.tema)} / ${normalizarRotulo(t.subtema)}: ${t.restrictor}`)
          .join('\n')
      : ''

    return txt(
      `${cab}\n${avisoTexto ? `\n${avisoTexto}\n` : ''}${avisos.length ? `\n${avisos.join('\n')}\n` : ''}` +
        `\n--- Texto ---\n${cuerpo}${temas}`,
    )
  },
)

server.registerTool(
  'listar_catalogos',
  {
    title: 'Listar catálogos de búsqueda',
    description:
      'Valores válidos para los filtros de buscar_normas: tipos de documento (29), años, entidades (89) y temas (2.509). ' +
      'En temas el filtro es obligatorio por volumen.',
    inputSchema: {
      catalogo: z.enum(['tipos', 'anios', 'entidades', 'temas']),
      filtro: z.string().optional().describe('Texto para filtrar; obligatorio en "temas"'),
      limite: z.coerce.number().int().min(1).max(200).default(50),
    },
  },
  async ({ catalogo, filtro, limite }) => {
    if (catalogo === 'temas' && !filtro) {
      return txt('El catálogo de temas tiene 2.509 entradas: indica un filtro de texto para acotarlo.')
    }
    const c = await gestor.catalogos()
    const q = filtro ? sinTildes(filtro).toLowerCase() : ''
    const lista = c[catalogo].filter((o) => !q || sinTildes(o.nombre).toLowerCase().includes(q))
    if (!lista.length) return vacio(`entradas de "${catalogo}" que coincidan con "${filtro}"`, 'Prueba un filtro más corto.')
    return txt(
      `${lista.length} entrada(s) en ${catalogo}:\n` +
        lista.slice(0, limite).map((o) => `- ${o.nombre} (id ${o.id})`).join('\n') +
        (lista.length > limite ? `\n… y ${lista.length - limite} más.` : ''),
    )
  },
)

server.registerTool(
  'buscar_jurisprudencia',
  {
    title: 'Buscar jurisprudencia de la Corte Constitucional',
    description:
      'Busca en la relatoría de la Corte Constitucional (49.409 providencias, actualizada a diario). ' +
      'Úsala para sentencias y autos: el Gestor Normativo tiene muy poca jurisprudencia reciente.',
    inputSchema: {
      termino: z.string().describe('Obligatorio. Términos a buscar en la relatoría, ej. "teletrabajo"'),
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha inicial AAAA-MM-DD (por defecto 1992-01-01)'),
      hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha final AAAA-MM-DD'),
      tipos: z
        .array(z.enum(['C', 'T', 'SU', 'A']))
        .optional()
        .describe(
          'Tipos a incluir. Por defecto C, T y SU (doctrina). Los autos (A) son mayoría por volumen y suelen ' +
            'ser trámite, así que hay que pedirlos explícitamente: ["A"] o ["C","T","SU","A"].',
        ),
      limite: z.coerce.number().int().min(1).max(100).default(10),
    },
  },
  async ({ termino, desde, hasta, tipos, limite }) => {
    const porDefecto: ('C' | 'T' | 'SU')[] = ['C', 'T', 'SU']
    const r = await corte.buscar({ termino, desde, hasta, tipos: tipos ?? porDefecto, limite })
    if (!r.items.length) return vacio(`providencias sobre "${termino}"`, 'Prueba un término más general o revisa el rango de fechas.')
    // Al acotar por fechas, el buscador de la relatoría devuelve providencias
    // que no mencionan el término. Se señalan en vez de presentarlas como
    // pertinentes: quien pregunta por teletrabajo no espera un impedimento.
    const aguja = sinTildes(termino).toLowerCase()
    const menciona = (p: (typeof r.items)[number]) =>
      sinTildes(`${p.tema} ${p.sintesis} ${p.sentencia}`).toLowerCase().includes(aguja)
    const flojas = r.items.filter((p) => !menciona(p)).map((p) => p.sentencia)
    const lista = r.items
      .map(
        (p) =>
          `- ${p.sentencia} (${p.tipo}, ${p.fecha})${menciona(p) ? '' : '  ⚠ no menciona el término'}\n  ${p.tema || '(sin tema)'}\n` +
          (p.sintesis ? `  Síntesis: ${p.sintesis.slice(0, 300)}${p.sintesis.length > 300 ? '…' : ''}\n` : '') +
          `  ruta: ${p.ruta}\n  ${p.url}`,
      )
      .join('\n')
    // La causa que se sugiere tiene que corresponder a lo que realmente se pidió:
    // culpar al filtro de fechas cuando no se envió ninguno manda a quien
    // consulta a quitar algo que no puso.
    const porFechas = Boolean(desde || hasta)
    const aviso = flojas.length
      ? `\n\nAtención: ${flojas.join(', ')} no mencionan "${termino}" en su tema ni en su síntesis. ` +
        (porFechas
          ? `El buscador de la relatoría pierde precisión al acotar por fechas: prueba sin desde/hasta.`
          : `El buscador de la relatoría indexa el texto completo, así que devuelve providencias donde el término ` +
            `aparece de pasada. Prueba un término más específico${tipos?.length === 1 && tipos[0] === 'A' ? ', o sin restringir a autos, que suelen ser de trámite' : ''}.`)
      : ''
    return txt(
      `${r.total} providencia(s) coinciden; se muestran ${r.items.length}.\n\n${lista}${aviso}\n\n` +
        `Para el texto completo usa obtener_sentencia con la ruta.`,
    )
  },
)

server.registerTool(
  'obtener_sentencia',
  {
    title: 'Obtener el texto de una providencia',
    description:
      'Texto completo de una sentencia o auto de la Corte Constitucional. Acepta tanto la ruta que devuelve ' +
      'buscar_jurisprudencia ("2024/T-099-24.htm") como la cita corta ("T-099/24"). Igual que las normas, no se ' +
      'devuelve entero por defecto (la T-099/24 son 153.000 caracteres): usa buscar_en_texto o desde/limite_caracteres.',
    inputSchema: {
      ruta: z
        .string()
        .describe('Ruta de la providencia ("2024/T-099-24.htm") o su cita corta ("T-099/24"): ambas valen'),
      seccion: z
        .enum(['antecedentes', 'consideraciones', 'decision'])
        .optional()
        .describe(
          'Devuelve solo esa parte. "decision" trae el RESUELVE, que es lo que casi siempre se busca: en la ' +
            'T-099/24 son 39.906 caracteres en vez de 140.162.',
        ),
      buscar_en_texto: z.string().optional(),
      desde: z.coerce.number().int().min(0).default(0),
      max_pasajes: z.coerce.number().int().positive().optional().describe('Máximo de pasajes con buscar_en_texto (por defecto 10)'),
      limite_caracteres: z.coerce
        .number()
        .int()
        .positive()
        .default(8000)
        .describe('Tope de caracteres del TEXTO devuelto; se aplica también con buscar_en_texto. La respuesta añade encabezado y temas asociados. Se ajusta al rango 200–40.000.'),
    },
  },
  async ({ ruta, seccion: cual, buscar_en_texto, desde, limite_caracteres, max_pasajes }) => {
    const tope = Math.min(Math.max(limite_caracteres, 200), 40_000)
    let doc: Awaited<ReturnType<typeof corte.obtenerTexto>>
    try {
      doc = await corte.obtenerTexto(ruta)
    } catch (e) {
      // Que la ruta no exista no es un fallo de la herramienta: se informa como texto.
      if (e instanceof corte.NoExisteProvidencia) return vacio(`la providencia "${ruta}"`, e.message)
      throw e
    }
    if (doc.texto.length < 200) {
      return txt(`Providencia ${ruta}\n\n${avisoSinTexto(doc.texto.length, doc.url)}`)
    }

    // El texto de la sección se trocea igual que el resto: la decisión de una
    // tutela de revisión puede pasar de 39.000 caracteres.
    const cuerpo = cual ? seccionDe(doc.texto, cual) : null
    if (cual) {
      const hay = seccionesPresentes(doc.texto)
      if (!cuerpo) {
        return vacio(
          `la sección "${cual}" en ${ruta}`,
          hay.length
            ? `Esta providencia trae: ${hay.join(', ')}. Las providencias no siguen todas la misma estructura.`
            : 'No se reconoció ninguna sección con encabezado propio; pide el texto completo o usa buscar_en_texto.',
        )
      }
      const t = trocear(cuerpo, desde, tope)
      return txt(
        `Providencia ${ruta} — sección "${cual}" (${t.total} caracteres de ${doc.texto.length} del documento).\n` +
          `Secciones disponibles: ${hay.join(', ')}.` +
          (t.omitido > 0 ? ` Se muestran ${t.texto.length} desde ${t.desde}; quedan ${t.omitido}.` : '') +
          `\n\n--- ${cual} ---\n${t.texto}\n\nURL: ${doc.url}`,
      )
    }

    if (buscar_en_texto) {
      const f = fragmentos(doc.texto, buscar_en_texto, 400, max_pasajes ?? 10, tope)
      if (!f.total) {
        return txt(`El término "${buscar_en_texto}" no aparece en ${ruta} (${doc.texto.length} caracteres revisados).\nURL: ${doc.url}`)
      }
      return txt(
        `${f.total} aparición(es) de "${buscar_en_texto}" en ${ruta}, agrupadas en ${f.pasajes} pasaje(s); ` +
          `se muestran ${f.trozos.length}.\n\n${f.trozos.join('\n\n---\n\n')}\n\nURL: ${doc.url}`,
      )
    }
    const t = trocear(doc.texto, desde, tope)
    return txt(
      `Providencia ${ruta}\nTexto total: ${t.total} caracteres; se muestran ${t.texto.length} desde ${t.desde}` +
        (t.omitido > 0 ? `; quedan ${t.omitido}.` : '.') +
        `\n\n--- Texto ---\n${t.texto}\n\nURL: ${doc.url}`,
    )
  },
)

server.registerTool(
  'buscar_normativa_tributaria',
  {
    title: 'Buscar normativa tributaria, aduanera y cambiaria (DIAN)',
    description:
      'Busca en el normograma de la DIAN: decretos, resoluciones, conceptos y circulares en materia tributaria, ' +
      'aduanera y cambiaria. Es lo que ninguna otra herramienta de este MCP cubre. Devuelve el extracto donde ' +
      'aparece el término y el enlace al texto completo. Para leer el documento usa obtener_documento_dian. ' +
      'AVISO: la primera búsqueda de cada término tarda ~20 s porque el portal devuelve el resultado completo y no ' +
      'admite tope; las páginas siguientes del MISMO término son instantáneas, así que pagina con desde en vez de ' +
      'lanzar búsquedas nuevas.',
    inputSchema: {
      texto: z.string().describe('Términos a buscar, ej. "retención en la fuente", "declaración de importación"'),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar'),
      limite: z.coerce.number().int().min(1).max(50).default(15),
    },
  },
  async ({ texto, desde, limite }) => {
    const r = await dian.buscar(texto, limite, desde)
    if (!r.total) {
      return vacio(`normativa de la DIAN sobre "${texto}"`, 'Prueba con menos palabras o con el término técnico exacto.')
    }
    const items = r.items
    if (!items.length) return vacio(`resultados a partir de la posición ${desde}`, `La búsqueda reúne ${r.total}; pide un "desde" menor.`)
    const fin = desde + items.length
    return txt(
      `${r.total} documento(s) en el normograma de la DIAN; se muestran ${desde + 1}–${fin}.\n\n` +
        items
          .map(
            (d) =>
              `- ${d.nombre}${d.tipo ? ` (${d.tipo}${d.anio ? `, ${d.anio}` : ''})` : ''}\n` +
              `  ${d.epigrafe || '(sin epígrafe)'}\n` +
              (d.entidad ? `  Entidad: ${d.entidad}\n` : '') +
              (d.extracto ? `  «…${d.extracto.slice(0, 240)}…»\n` : '') +
              `  link para obtener_documento_dian: ${d.link}`,
          )
          .join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : ''),
    )
  },
)

server.registerTool(
  'obtener_documento_dian',
  {
    title: 'Obtener el texto de un documento de la DIAN',
    description:
      'Texto de un documento del normograma de la DIAN por su "link" (el que devuelve buscar_normativa_tributaria). ' +
      'Nunca devuelve el documento entero: el Decreto 1625 de 2016 son 6,5 MB. Usa buscar_en_texto o ' +
      'desde/limite_caracteres, igual que en obtener_norma.',
    inputSchema: {
      link: z.string().describe('Nombre del archivo, ej. "decreto_1625_2016.htm"'),
      buscar_en_texto: z.string().optional().describe('Devuelve solo los fragmentos que mencionan este término'),
      desde: z.coerce.number().int().min(0).default(0),
      max_pasajes: z.coerce.number().int().positive().optional(),
      limite_caracteres: z.coerce.number().int().positive().default(8000).describe('Tope del TEXTO devuelto; se ajusta al rango 200–40.000'),
    },
  },
  async ({ link, buscar_en_texto, desde, max_pasajes, limite_caracteres }) => {
    const tope = Math.min(Math.max(limite_caracteres, 200), 40_000)
    const url = dian.urlDocumento(link)
    const r = await pedirHttp(url, 90_000)
    if (r.status !== 200) return vacio(`el documento "${link}" en el normograma de la DIAN`, 'Verifica el link con buscar_normativa_tributaria.')
    const texto = textoDe(cargar(r.cuerpo), 'body')
    if (texto.length < 200) return txt(`${link}\n\n${avisoSinTexto(texto.length, url)}`)

    if (buscar_en_texto) {
      const f = fragmentos(texto, buscar_en_texto, 400, max_pasajes ?? 10, tope)
      if (!f.total) return txt(`El término "${buscar_en_texto}" no aparece en ${link} (${texto.length} caracteres revisados).\nURL: ${url}`)
      return txt(
        `${link}\n${f.total} aparición(es) de "${buscar_en_texto}" en ${f.pasajes} pasaje(s); se muestran ${f.mostrados}.\n` +
          `${advertenciasVigencia(f.trozos.join(' ')).join('\n')}\n\n${f.trozos.join('\n\n---\n\n')}\n\nURL: ${url}`,
      )
    }
    const t = trocear(texto, desde, tope)
    return txt(
      `${link}\nTexto total: ${t.total} caracteres; se muestran ${t.texto.length} desde ${t.desde}` +
        (t.omitido > 0 ? `; quedan ${t.omitido} (usa desde/limite_caracteres o buscar_en_texto).` : '.') +
        `\n${advertenciasVigencia(t.texto).join('\n')}\n\n--- Texto ---\n${t.texto}\n\nURL: ${url}`,
    )
  },
)

server.registerTool(
  'buscar_jurisprudencia_suprema',
  {
    title: 'Buscar jurisprudencia de la Corte Suprema de Justicia',
    description:
      'Busca providencias de la Corte Suprema por sala: Tutelas, Civil, Laboral o Penal, desde 1991. Complementa a ' +
      'buscar_jurisprudencia, que es de la Corte CONSTITUCIONAL: son tribunales distintos. Cada resultado trae las ' +
      'NORMAS QUE CITA, que puedes resolver después con resolver_cita. No devuelve el texto: las providencias son ' +
      'archivos .docx y esta extensión no los lee. ' +
      'CÓMO BUSCA: sobre el texto completo de la providencia y sin descartar palabras comunes, así que "de" solo ' +
      'devuelve 69.454 resultados y una frase encuentra documentos que contienen sus palabras en cualquier parte. ' +
      'Usa exacto=true para la frase, y términos distintivos en vez de frases largas.',
    inputSchema: {
      texto: z.string().describe('Términos a buscar, ej. "despido sin justa causa"'),
      sala: z.enum(suprema.SALAS).default('Tutelas').describe('Sala de la Corte. Obligatoria: sin ella el buscador no responde.'),
      anio: z.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos'),
      magistrado: z.string().optional().describe('Nombre del magistrado ponente'),
      exacto: z
        .boolean()
        .default(false)
        .describe(
          'Buscar la frase exacta. MUY recomendable con frases: sin esto el buscador une las palabras con OR y ' +
            '"despido sin justa causa" devuelve 176.012 providencias contra 20.233 con exacto=true.',
        ),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántas saltarse antes de empezar'),
      limite: z.coerce
        .number()
        .int()
        .min(1)
        .max(10)
        .default(10)
        .describe('Cuántas mostrar. El buscador entrega páginas de 10 como máximo; para ver más, usa desde.'),
    },
  },
  async ({ texto, sala, anio, magistrado, exacto, desde, limite }) => {
    const r = await suprema.buscar({ texto, sala, anio, magistrado, exacto, desde, limite })
    if (!r.items.length) {
      return vacio(
        `providencias de la sala ${sala} sobre "${texto}"`,
        'Prueba otra sala (Tutelas, Civil, Laboral, Penal), un término más general o quita el año.',
      )
    }
    const fin = desde + r.items.length
    // El backend cuenta con OR entre las palabras sueltas, así que su total se
    // acerca al tamaño del corpus de la sala, no a los resultados pertinentes.
    // Darlo como "coinciden" hace creer que hay una precisión que no existe.
    const recuento = r.exacto
      ? `${r.total} providencia(s) contienen la frase exacta`
      : `~${r.total} providencia(s) con alguna de las palabras (el buscador las une con OR, así que este número ` +
        `NO mide pertinencia; repite con exacto=true para contar la frase)`
    // El índice repite el mismo fallo por cada archivo (.docx, .pdf, grafías
    // distintas del ponente). Callarlo haría creer que "quedan N" son N
    // documentos nuevos, cuando buena parte son copias.
    const repetidas =
      r.brutos > r.items.length
        ? `\n\nEsta página del buscador traía ${r.brutos} entradas y solo ${r.items.length} providencia(s) distintas: ` +
          `su índice guarda una entrada por ARCHIVO (.docx y .pdf, y a veces el ponente escrito de dos formas). ` +
          `Por eso avanzar con desde rinde menos documentos nuevos de lo que sugiere el total.`
        : ''
    return txt(
      `${recuento}, sala ${sala}; se muestran ${desde + 1}–${fin}.${repetidas}\n\n` +
        r.items
          .map(
            (p) =>
              `- ${p.titulo} (${p.clase || 'providencia'}, ${p.fecha})\n` +
              (p.magistrado ? `  Ponente: ${p.magistrado}\n` : '') +
              (p.normasCitadas.length
                ? `  Normas citadas (resolubles con resolver_cita): ${p.normasCitadas.slice(0, 8).join(' · ')}` +
                  (p.normasCitadas.length > 8 ? ` … y ${p.normasCitadas.length - 8} más` : '')
                : '  (no declara normas citadas)'),
          )
          .join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : '') +
        `\n\nEl texto completo no se puede entregar aquí: la Corte Suprema publica las providencias en .docx y esta ` +
        `extensión no lee ese formato. Búscalas por su número en cortesuprema.gov.co.`,
    )
  },
)

server.registerTool(
  'buscar_jurisprudencia_consejo_estado',
  {
    title: 'Buscar jurisprudencia del Consejo de Estado',
    description:
      'Busca providencias tituladas del Consejo de Estado, el tribunal supremo de lo contencioso administrativo: ' +
      'nulidad y restablecimiento, contratación estatal, nulidad electoral, reparación directa y conceptos de la ' +
      'Sala de Consulta. Es un tribunal DISTINTO de la Corte Constitucional y de la Corte Suprema. Cada resultado ' +
      'trae el problema jurídico que la Sala se planteó y su respuesta, que es lo que de verdad sirve para ' +
      'orientarse. No devuelve el texto completo: para eso está el enlace.',
    inputSchema: {
      texto: z.string().describe('Términos a buscar, ej. "nulidad electoral", "liquidación del contrato"'),
      limite: z.coerce.number().int().min(1).max(9).default(5).describe('El buscador entrega páginas de 9 como máximo'),
    },
  },
  async ({ texto, limite }) => {
    const r = await consejo.buscar(texto, limite)
    if (!r.items.length) {
      return vacio(`providencias del Consejo de Estado sobre "${texto}"`, 'Prueba con un término más general.')
    }
    return txt(
      `${r.paginas} página(s) de resultados en el Consejo de Estado; se muestran ${r.items.length}.\n\n` +
        r.items
          .map((p) => {
            const cabecera = [
              `- ${p.radicado}${p.clase ? ` (${p.clase})` : ''}`,
              p.fecha ? `  Fecha: ${p.fecha}` : '',
              p.sala ? `  Sala: ${p.sala}` : '',
              p.ponente ? `  Ponente: ${p.ponente}` : '',
              p.actor || p.demandado ? `  ${p.actor} contra ${p.demandado || '(sin demandado)'}` : '',
            ].filter(Boolean)
            const tesis = p.titulaciones.map(
              (t) =>
                `  · Problema jurídico: ${t.problema.slice(0, 400)}` +
                (t.respuesta ? `\n    Respuesta: ${t.respuesta}` : '') +
                (t.nota ? `\n    Nota de relatoría: ${t.nota.slice(0, 300)}` : ''),
            )
            return [...cabecera, ...tesis].join('\n')
          })
          .join('\n\n') +
        `\n\nEl texto completo no se entrega aquí; consúltalo en ${r.items[0]!.url} buscando el radicado.`,
    )
  },
)

server.registerTool(
  'buscar_en_suin',
  {
    title: 'Buscar en SUIN-Juriscol',
    description:
      'Busca en los 56.832 documentos de SUIN-Juriscol (MinJusticia) por título, epígrafe, materia o entidad ' +
      'emisora. Cubre leyes, decretos y resoluciones desde 1844, incluidos documentos que el Gestor Normativo no ' +
      'tiene. NO busca dentro del articulado y NO sirve para citas exactas ("LEY 909 DE 2004" no devuelve nada): ' +
      'para una cita usa resolver_cita. El campo de vigencia que devuelve es el del buscador y NO es fiable: ' +
      'contradice la ficha del propio documento; para el estado real usa resolver_cita. ' +
      'SU ÍNDICE TIENE HUECOS: "Teletrabajo" devuelve cero pese a estar en el título de la Ley 1221 de 2008, y una ' +
      'frase larga empareja por sus palabras comunes y devuelve resultados sin relación. Si buscas por materia y ' +
      'no aparece lo esperado, NO concluyas que no existe: prueba buscar_por_tema o resolver_cita.',
    inputSchema: {
      texto: z.string().describe('Palabras del título, epígrafe o materia. Ej.: "servicio militar", "Buenaventura"'),
      vigencia: z
        .enum(['Vigente', 'Vigencia en Estudio', 'Compilado', 'Derogado', 'No vigente', 'Declarado Inexequible', 'Sustituido'])
        .optional()
        .describe('Filtra por el estado que declara el BUSCADOR, que no siempre coincide con la ficha'),
      sector: z.string().optional().describe('Sector administrativo, ej. "Hacienda y Crédito Público"'),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar'),
      limite: z.coerce.number().int().min(1).max(50).default(15),
    },
  },
  async ({ texto, vigencia, sector, desde, limite }) => {
    const r = await suin.buscar({ texto, vigencia, sector, desde, limite })
    if (!r.total) {
      return vacio(
        `documentos en SUIN para "${texto}"`,
        'El buscador de SUIN solo indexa título, epígrafe, materia y entidad: no busca dentro del articulado, y las ' +
          'citas exactas no funcionan ahí. Para una norma concreta usa resolver_cita.',
      )
    }
    if (!r.items.length) {
      return vacio(`documentos a partir de la posición ${desde}`, `La búsqueda reúne ${r.total}; pide un "desde" menor.`)
    }
    const fin = desde + r.items.length
    return txt(
      `${r.total} documento(s) en SUIN-Juriscol; se muestran ${desde + 1}–${fin}.\n\n` +
        r.items
          .map(
            (d) =>
              `- ${d.titulo} (${d.subtipo})\n  ${d.epigrafe || '(sin epígrafe)'}\n` +
              `  Vigencia SEGÚN EL BUSCADOR: ${d.vigencia || '(sin dato)'}\n  ${d.url}`,
          )
          .join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : '') +
        `\n\nATENCIÓN: la vigencia de esta lista es la del índice de búsqueda y contradice la ficha del documento ` +
        `(la Ley 74 de 1923 figura aquí como "Vigencia en Estudio" y su ficha dice DEROGADO). Para el estado real ` +
        `de una norma, pídela por su cita con resolver_cita.`,
    )
  },
)

server.registerTool(
  'listar_subtemas',
  {
    title: 'Listar subtemas de un tema',
    description:
      'Subtemas de un tema del CATÁLOGO DE BÚSQUEDA, cuyos ids van en el parámetro subtema de buscar_normas. ' +
      'Ojo: el portal mantiene dos taxonomías distintas y no sincronizadas. Esta es la del formulario de consulta ' +
      'avanzada y suele ser más pobre; la de buscar_por_tema es más rica (para "teletrabajo" tiene ocho pares ' +
      'tema/subtema donde esta tiene uno). Los ids de una NO sirven en la otra.',
    inputSchema: { tema_id: z.coerce.string().regex(/^\d+$/).describe('id de tema del catálogo, como texto') },
  },
  async ({ tema_id }) => {
    const s = await gestor.subtemas(tema_id)
    if (!s.length) return vacio(`subtemas para el tema ${tema_id}`, 'Verifica el id con listar_catalogos.')
    return txt(s.map((o) => `- ${o.nombre} (id ${o.id})`).join('\n'))
  },
)

server.registerTool(
  'explicar_relacion_tema',
  {
    title: 'Explicar por qué una norma aplica a un subtema',
    description:
      'Devuelve el "restrictor": el extracto que explica por qué esa norma es pertinente para ESE subtema en ' +
      'concreto. Ambos identificadores deben salir de la MISMA fila de buscar_por_tema: el temsubid no es el id ' +
      'de listar_subtemas ni el de listar_catalogos. Para ver todos los restrictores de una norma de una vez, ' +
      'usa obtener_norma y mira su bloque "Temas asociados".',
    inputSchema: {
      temsubid: z.coerce.string().regex(/^\d+$/).describe('temsubid de buscar_por_tema (no vale el id de listar_subtemas)'),
      normid: z.coerce.string().regex(/^\d+$/).describe('normid de la misma fila de buscar_por_tema'),
    },
  },
  async ({ temsubid, normid }) => {
    // Se recupera el par del índice para poder decir a qué tema corresponde:
    // sin eso el usuario no puede verificar que la respuesta sea la que pidió.
    const fila = cargarIndice()?.filas.find((f) => f.ts === temsubid)
    const rotulo = fila ? `${normalizarRotulo(fila.t)} / ${normalizarRotulo(fila.s)}` : '(subtema no encontrado en el índice)'
    const enElIndice = fila?.n.some(([id]) => id === normid) ?? false

    const r = await gestor.restrictor(temsubid, normid)
    if (!r) {
      return vacio(
        `un restrictor para la norma ${normid} bajo "${rotulo}"`,
        enElIndice
          ? 'El índice sí relaciona esa norma con ese subtema, pero el portal no publica el extracto. Usa obtener_norma para ver los restrictores que sí tiene.'
          : 'Esa norma no está clasificada bajo ese subtema. Verifica que temsubid y normid vengan de la misma fila de buscar_por_tema.',
      )
    }
    return txt(
      `Tema / subtema: ${rotulo} (temsubid ${temsubid})\nNorma: ${normid}\n\n` +
        `Por qué aplica:\n${r}\n\n` +
        `Norma completa: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=${normid}\n` +
        `Este es el restrictor de ESTE subtema; la norma puede tener otros distintos bajo otros temas (obtener_norma los lista todos).`,
    )
  },
)

server.registerTool(
  'buscar_conceptos_fp',
  {
    title: 'Localizar conceptos de Función Pública por número o año',
    description:
      'Lista los 21.759 conceptos emitidos por Función Pública, filtrando por NÚMERO o AÑO únicamente. ' +
      'NO busca por materia: el listado solo contiene el número y el año de cada concepto ("Concepto 036201 de 2024"), ' +
      'sin el asunto. Para buscar conceptos SOBRE UN TEMA usa buscar_normas con tipo_documento "Concepto", ' +
      'que sí consulta los resúmenes temáticos.',
    inputSchema: {
      numero: z.string().optional().describe('Número del concepto, como texto. Ej.: "036201"'),
      anio: z.coerce.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos, como texto. Ej.: "2004"'),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar: pide el siguiente tramo sin repetir los ya vistos'),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    },
  },
  async ({ numero, anio, desde, limite }) => {
    const r = await gestor.conceptosFp(numero, anio, limite, desde)
    if (!r.total) {
      return vacio(
        'conceptos con ese número o año',
        'Recuerda que este listado solo filtra por número y año. Si buscas conceptos sobre un tema, usa buscar_normas con tipo_documento "Concepto".',
      )
    }
    // Un "desde" pasado del final no es lo mismo que no haber encontrado nada.
    if (!r.items.length) {
      return vacio(
        `conceptos a partir de la posición ${desde}`,
        `El filtro reúne ${r.total} concepto(s); pide un "desde" menor.`,
      )
    }
    const fin = desde + r.items.length
    return txt(
      `${r.total} concepto(s) coinciden; se muestran ${desde + 1}–${fin}.\n\n` +
        r.items.map((c) => `- ${c.titulo} (id ${c.id})\n  ${c.url}`).join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : ''),
    )
  },
)

server.registerTool(
  'listar_normas_fp',
  {
    title: 'Listar la normativa de competencia de Función Pública',
    description:
      'Listado curado por el portal con la normativa que rige o le compete al Departamento Administrativo de la ' +
      'Función Pública. OJO: no son normas que el DAFP haya expedido — incluye la Constitución Política, la Ley 100 ' +
      'de 1993 y leyes del Congreso. Es un listado corto y fijo; para buscar normativa usa buscar_normas.',
    inputSchema: {
      filtro: z.string().optional().describe('Texto para acotar por título, ej. "circular" o "1474"'),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántas saltarse antes de empezar: pide el siguiente tramo sin repetir las ya vistas'),
      limite: z.coerce.number().int().min(1).max(150).default(40),
    },
  },
  async ({ filtro, desde, limite }) => {
    const todas = await gestor.normasFp()
    const q = filtro ? sinTildes(filtro).toLowerCase() : ''
    const items = todas.filter((i) => !q || sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase().includes(q))
    if (!items.length) return vacio(`normativa de competencia del DAFP que coincida con "${filtro}"`, 'Prueba sin filtro para ver el listado completo.')
    const tramo = items.slice(desde, desde + limite)
    // Un "desde" pasado del final no es lo mismo que no haber encontrado nada.
    if (!tramo.length) {
      return vacio(`normativa a partir de la posición ${desde}`, `El listado reúne ${items.length} norma(s); pide un "desde" menor.`)
    }
    const fin = desde + tramo.length
    return txt(
      `${items.length} de ${todas.length} norma(s) del listado; se muestran ${desde + 1}–${fin}.\n\n` +
        tramo
          .map((i) => `- ${i.titulo} (id ${i.id})\n  Extracto temático: ${i.resumen || '(ninguno)'}\n  ${i.url}`)
          .join('\n') +
        (fin < items.length ? `\n\nQuedan ${items.length - fin}: repite con desde=${fin}.` : ''),
    )
  },
)

// --- prompts (aparecen como comandos en Claude Desktop) ------------------

server.registerPrompt(
  'normas-sobre',
  {
    title: '¿Qué normas aplican sobre un tema?',
    description: 'Busca la normativa aplicable a un tema y explica por qué aplica cada una.',
    argsSchema: { tema: z.string() },
  },
  ({ tema }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `¿Qué normas del sector público colombiano aplican sobre "${tema}"? Usa buscar_por_tema, y para las más ` +
            `relevantes usa explicar_relacion_tema para decirme por qué aplican. Cita siempre con enlace.`,
        },
      },
    ],
  }),
)

server.registerPrompt(
  'sigue-vigente',
  {
    title: '¿Esta norma sigue vigente?',
    description: 'Revisa el texto en busca de derogatorias y modificaciones.',
    argsSchema: { norma: z.string() },
  },
  ({ norma }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `¿"${norma}" sigue vigente? Resuélvela con resolver_cita y revisa el texto con obtener_norma buscando ` +
            `"derogad" y "modificado por". Dime qué encontraste y advierte con claridad si no puedes confirmarlo: ` +
            `el Gestor no tiene un campo de vigencia.`,
        },
      },
    ],
  }),
)

server.registerPrompt(
  'explicar-sencillo',
  {
    title: 'Explícame esta norma en lenguaje sencillo',
    description: 'Resume una norma sin jerga, para cualquier persona.',
    argsSchema: { norma: z.string() },
  },
  ({ norma }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Explícame "${norma}" en lenguaje sencillo, sin jerga jurídica: qué regula, a quién aplica y qué obliga. ` +
            `Consúltala primero con resolver_cita y cita los artículos con su enlace.`,
        },
      },
    ],
  }),
)

server.registerPrompt(
  'comparar-normas',
  {
    title: 'Compara dos normas',
    description: 'Contrasta el alcance de dos normas.',
    argsSchema: { primera: z.string(), segunda: z.string() },
  },
  ({ primera, segunda }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Compara "${primera}" y "${segunda}": qué regula cada una, en qué se solapan y en qué se contradicen. Consulta ambas y cita con enlaces.`,
        },
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
