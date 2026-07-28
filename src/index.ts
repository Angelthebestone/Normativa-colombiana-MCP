import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { idTipo, parsearCita } from './citas.ts'
import {
  advertenciasVigencia,
  articulo as extraerArticulo,
  fragmentos,
  indiceArticulos,
  trocear,
  sinTildes,
} from './parse.ts'
import * as gestor from './fuentes/gestor.ts'
import * as corte from './fuentes/corte.ts'

const DESCARGO =
  'Fuente oficial; los datos se publican con propósitos informativos. Verifica siempre en el enlace antes de tomar una decisión.'

const hoy = () => new Date().toISOString().slice(0, 10)

/** Toda respuesta sale fechada y con el descargo: es la fuente lo que la hace útil. */
const txt = (s: string) => ({
  content: [{ type: 'text' as const, text: `${s}\n\nConsulta del ${hoy()}. ${DESCARGO}` }],
})

/** Nunca se devuelve una lista vacía a secas: el vacío se explica. */
const vacio = (que: string, sugerencia: string) =>
  txt(`No encontré ${que} en las fuentes consultadas.\n\n${sugerencia}`)

// --- índice temático empaquetado -----------------------------------------

type Indice = { generado: string; filas: { t: string; s: string; ts: string; n: [string, string][] }[] }
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

function frescura(generado: string): string {
  const meses = (Date.now() - Date.parse(generado)) / (30 * 24 * 3600 * 1000)
  return meses > 3
    ? `\n\nAVISO: el índice temático empaquetado se generó el ${generado} (hace ~${Math.round(meses)} meses). Puede faltar normativa reciente; actualiza la extensión.`
    : ''
}

// --- servidor ------------------------------------------------------------

const server = new McpServer({ name: 'normativa-colombia', version: '1.0.0' })

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

    const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
    if (!r.items.length) {
      return vacio(
        `la cita "${cita}"`,
        c.anio ? `Prueba sin el año, o verifica el número.` : `Prueba indicando el año.`,
      )
    }
    const n = r.items[0]!
    let extra = ''
    if (c.articulo) {
      const norma = await gestor.obtenerNorma(n.id)
      const art = extraerArticulo(norma.texto, c.articulo)
      extra = art
        ? `\n\n--- Artículo ${c.articulo} ---\n${art}\n${advertenciasVigencia(art).join('\n')}`
        : `\n\nNo encontré un "artículo ${c.articulo}" en el texto. Usa obtener_norma con buscar_en_texto.`
    }
    return txt(
      `${n.titulo}\nid: ${n.id}\n${n.resumen ? `Resumen: ${n.resumen}\n` : ''}URL: ${n.url}${extra}`,
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
      numero: z.union([z.string(), z.number()]).optional(),
      anio: z.union([z.string(), z.number()]).optional(),
      entidad: z.string().optional().describe('Nombre o id: "Corte Constitucional", "Congreso de la República"'),
      tema: z.string().optional().describe('Nombre o id de tema del catálogo'),
      subtema: z.union([z.string(), z.number()]).optional(),
      limite: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ palabras, tipo_documento, numero, anio, entidad, tema, subtema, limite }) => {
    const r = await gestor.buscar({ palabras, tipo: tipo_documento, numero, anio, entidad, tema, subtema })
    if (!r.items.length) {
      return vacio(
        'normas con esos filtros',
        'Quita filtros, revisa las tildes (el portal distingue "gestión" de "gestion") o usa buscar_por_tema.',
      )
    }
    const lista = r.items
      .slice(0, limite)
      .map((i) => `- ${i.titulo} (id ${i.id})\n  ${i.resumen || '(sin resumen)'}\n  ${i.url}`)
      .join('\n')
    const mas = r.items.length > limite ? `\n\nSe muestran ${limite} de ${r.total} encontradas.` : ''
    return txt(
      `${r.total} documento(s) encontrado(s).${r.nota ? `\n${r.nota}` : ''}\n\n${lista}${mas}`,
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
      'Cada resultado trae temsubid y normid para pedir después explicar_relacion_tema.',
    inputSchema: {
      texto: z.string().describe('Tema a buscar, ej. "teletrabajo", "encargo", "prima de servicios"'),
      limite: z.number().int().min(1).max(50).default(15),
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
              `- ${f.t} / ${f.s} (temsubid ${f.ts})\n` +
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
          `- ${f.tema} / ${f.subtema} (temsubid ${f.temsubid})\n` +
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
      id: z.union([z.string(), z.number()]).describe('id numérico de la norma'),
      buscar_en_texto: z.string().optional().describe('Devuelve solo los fragmentos que mencionan este término'),
      articulo: z.string().optional().describe('Número de artículo, ej. "6" o "2.2.5.1.5"'),
      desde: z.number().int().min(0).default(0),
      limite_caracteres: z.number().int().min(500).max(40000).default(8000),
    },
  },
  async ({ id, buscar_en_texto, articulo, desde, limite_caracteres }) => {
    const n = await gestor.obtenerNorma(id)
    const cab = [
      n.titulo,
      ...Object.entries(n.fechas).map(([k, v]) => `${k}: ${v}`),
      `URL: ${n.url}`,
      `PDF: ${n.urlPdf}`,
    ].join('\n')

    if (n.texto.length < 200) {
      return txt(
        `${cab}\n\nEsta norma está registrada pero no tiene texto publicado en el Gestor Normativo ` +
          `(se recibieron ${n.texto.length} caracteres). No significa que la norma no diga nada: ` +
          `consúltala en el PDF o en la página oficial.`,
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
      const f = fragmentos(n.texto, buscar_en_texto)
      if (!f.total) {
        return txt(
          `${cab}\n\nEl término "${buscar_en_texto}" no aparece en el texto de esta norma ` +
            `(${n.texto.length} caracteres revisados).`,
        )
      }
      cuerpo = f.trozos.join('\n\n---\n\n')
      avisoTexto = `${f.total} aparición(es) de "${buscar_en_texto}"; se muestran ${f.trozos.length}.`
    } else {
      const t = trocear(n.texto, desde, limite_caracteres)
      cuerpo = t.texto
      const arts = indiceArticulos(n.texto)
      avisoTexto =
        `Texto total: ${t.total} caracteres. Se muestran ${t.texto.length} desde la posición ${t.desde}` +
        (t.omitido > 0 ? `; quedan ${t.omitido} sin mostrar (usa desde/limite_caracteres o buscar_en_texto).` : '.') +
        (arts.length ? `\nArtículos detectados: ${arts.join(', ')}` : '')
    }

    const avisos = advertenciasVigencia(cuerpo)
    const temas = n.temas.length
      ? `\n\nTemas asociados:\n${n.temas.slice(0, 10).map((t) => `- ${t.tema} / ${t.subtema}: ${t.restrictor}`).join('\n')}`
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
      limite: z.number().int().min(1).max(200).default(50),
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
      termino: z.string(),
      desde: z.string().optional().describe('Fecha inicial AAAA-MM-DD (por defecto 1992-01-01)'),
      hasta: z.string().optional().describe('Fecha final AAAA-MM-DD'),
      limite: z.number().int().min(1).max(100).default(10),
    },
  },
  async ({ termino, desde, hasta, limite }) => {
    const r = await corte.buscar({ termino, desde, hasta, limite })
    if (!r.items.length) return vacio(`providencias sobre "${termino}"`, 'Prueba un término más general o revisa el rango de fechas.')
    const lista = r.items
      .map(
        (p) =>
          `- ${p.sentencia} (${p.tipo}, ${p.fecha})\n  ${p.tema || '(sin tema)'}\n` +
          (p.sintesis ? `  Síntesis: ${p.sintesis.slice(0, 300)}${p.sintesis.length > 300 ? '…' : ''}\n` : '') +
          `  ruta: ${p.ruta}\n  ${p.url}`,
      )
      .join('\n')
    return txt(
      `${r.total} providencia(s) coinciden; se muestran ${r.items.length}.\n\n${lista}\n\n` +
        `Para el texto completo usa obtener_sentencia con la ruta.`,
    )
  },
)

server.registerTool(
  'obtener_sentencia',
  {
    title: 'Obtener el texto de una providencia',
    description:
      'Texto completo de una sentencia o auto de la Corte Constitucional. Igual que las normas, no se devuelve ' +
      'entero por defecto (la T-099/24 son 153.000 caracteres): usa buscar_en_texto o desde/limite_caracteres.',
    inputSchema: {
      ruta: z.string().describe('Ruta de la providencia, ej. "2024/T-099-24.htm"'),
      buscar_en_texto: z.string().optional(),
      desde: z.number().int().min(0).default(0),
      limite_caracteres: z.number().int().min(500).max(40000).default(8000),
    },
  },
  async ({ ruta, buscar_en_texto, desde, limite_caracteres }) => {
    const doc = await corte.obtenerTexto(ruta)
    if (doc.texto.length < 200) {
      return txt(`La providencia ${ruta} no trae texto legible (${doc.texto.length} caracteres). URL: ${doc.url}`)
    }
    if (buscar_en_texto) {
      const f = fragmentos(doc.texto, buscar_en_texto)
      if (!f.total) {
        return txt(`El término "${buscar_en_texto}" no aparece en ${ruta} (${doc.texto.length} caracteres revisados).\nURL: ${doc.url}`)
      }
      return txt(
        `${f.total} aparición(es) de "${buscar_en_texto}" en ${ruta}; se muestran ${f.trozos.length}.\n\n` +
          `${f.trozos.join('\n\n---\n\n')}\n\nURL: ${doc.url}`,
      )
    }
    const t = trocear(doc.texto, desde, limite_caracteres)
    return txt(
      `Providencia ${ruta}\nTexto total: ${t.total} caracteres; se muestran ${t.texto.length} desde ${t.desde}` +
        (t.omitido > 0 ? `; quedan ${t.omitido}.` : '.') +
        `\n\n--- Texto ---\n${t.texto}\n\nURL: ${doc.url}`,
    )
  },
)

server.registerTool(
  'listar_subtemas',
  {
    title: 'Listar subtemas de un tema',
    description: 'Subtemas activos de un tema del catálogo, para afinar buscar_normas.',
    inputSchema: { tema_id: z.union([z.string(), z.number()]) },
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
      'Devuelve el "restrictor": el extracto que explica por qué esa norma es pertinente para ese subtema. ' +
      'Es la información más valiosa del Gestor y no aparece en la búsqueda normal.',
    inputSchema: {
      temsubid: z.union([z.string(), z.number()]),
      normid: z.union([z.string(), z.number()]),
    },
  },
  async ({ temsubid, normid }) => {
    const r = await gestor.restrictor(temsubid, normid)
    if (!r) return vacio(`una explicación para temsubid ${temsubid} y normid ${normid}`, 'Verifica los identificadores con buscar_por_tema.')
    return txt(`${r}\n\nNorma: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=${normid}`)
  },
)

server.registerTool(
  'buscar_conceptos_fp',
  {
    title: 'Buscar conceptos de Función Pública',
    description:
      'Filtra los 21.759 conceptos emitidos por Función Pública. La primera llamada descarga un listado grande ' +
      'y puede tardar; después queda en caché. Para la mayoría de casos basta buscar_normas con tipo_documento "Concepto".',
    inputSchema: {
      texto: z.string().optional(),
      anio: z.union([z.string(), z.number()]).optional(),
      limite: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ texto, anio, limite }) => {
    const r = await gestor.conceptosFp(texto, anio, limite)
    if (!r.items.length) return vacio('conceptos con esos criterios', 'Prueba con otro término o sin filtrar por año.')
    return txt(
      `${r.total} concepto(s) coinciden; se muestran ${r.items.length}.\n\n` +
        r.items.map((c) => `- ${c.titulo} (id ${c.id})\n  ${c.url}`).join('\n') +
        ``,
    )
  },
)

server.registerTool(
  'listar_normas_fp',
  {
    title: 'Listar las normas propias de Función Pública',
    description: 'Las normas emitidas por el Departamento Administrativo de la Función Pública.',
    inputSchema: {},
  },
  async () => {
    const items = await gestor.normasFp()
    if (!items.length) return vacio('normas de Función Pública', 'El portal pudo cambiar; reintenta más tarde.')
    return txt(
      `${items.length} norma(s):\n` + items.map((i) => `- ${i.titulo} (id ${i.id})\n  ${i.url}`).join('\n') +
        ``,
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
