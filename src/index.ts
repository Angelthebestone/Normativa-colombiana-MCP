import { readFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { idTipo, parsearCita } from './citas.ts'
import {
  advertenciasVigencia,
  normalizarRotulo,
  articulo as extraerArticulo,
  fragmentos,
  indiceArticulos,
  trocear,
  sinTildes,
} from './parse.ts'
import { NoExisteError } from './parse.ts'
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
      `${n.titulo}\nid: ${n.id}\n` +
        // No es un resumen de la norma: el Gestor no publica uno. Es el extracto
        // de UN tema al que está asociada, y en normas compiladoras como el
        // Decreto 1083 describe una porción mínima del contenido.
        (n.resumen
          ? `Extracto de un tema asociado (NO resume la norma; usa obtener_norma para su objeto y articulado): ${n.resumen}\n`
          : '') +
        `URL: ${n.url}${extra}`,
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
      numero: z.string().regex(/^\d+$/).optional().describe('Número de la norma, como texto. Ej.: "909"'),
      anio: z.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos, como texto. Ej.: "2004"'),
      entidad: z.string().optional().describe('Nombre o id: "Corte Constitucional", "Congreso de la República"'),
      tema: z.string().optional().describe('Nombre o id de tema del catálogo'),
      subtema: z.string().regex(/^\d+$/).optional().describe('subtemaid del catálogo (NO el temsubid de buscar_por_tema)'),
      limite: z.number().int().min(1).max(100).default(20),
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
                `La búsqueda por palabras solo halló ${r.total}; se añadieron ${extra.length} documentos clasificados ` +
                  `bajo el subtema oficial "${par.t} / ${par.s}", que es donde el portal los tiene indexados.`,
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
      id: z.string().regex(/^\d+$/).describe('id numérico de la norma, como texto. Ej.: "31431"'),
      buscar_en_texto: z.string().optional().describe('Devuelve solo los fragmentos que mencionan este término'),
      articulo: z.string().optional().describe('Número de artículo, ej. "6" o "2.2.5.1.5"'),
      desde: z.number().int().min(0).default(0),
      limite_caracteres: z.number().int().min(500).max(40000).default(8000),
    },
  },
  async ({ id, buscar_en_texto, articulo, desde, limite_caracteres }) => {
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
      avisoTexto = `${f.total} aparición(es) de "${buscar_en_texto}", agrupadas en ${f.pasajes} pasaje(s); se muestran ${f.trozos.length}.`
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
    // Los temas venían en el orden del portal, así que al buscar "teletrabajo"
    // en el Decreto 1083 salían diez de bienestar social. Se suben los que
    // mencionan lo buscado y se dice cuántos hay en total.
    const aguja = sinTildes(buscar_en_texto ?? articulo ?? '').toLowerCase().trim()
    const pertinente = (t: (typeof n.temas)[number]) =>
      Number(sinTildes(`${t.tema} ${t.subtema} ${t.restrictor}`).toLowerCase().includes(aguja))
    const ordenados = aguja ? [...n.temas].sort((a, b) => pertinente(b) - pertinente(a)) : n.temas

    const temas = ordenados.length
      ? `\n\nTemas asociados (${Math.min(10, ordenados.length)} de ${ordenados.length}` +
        `${aguja ? ', primero los que mencionan lo buscado' : ', sin ordenar por relevancia'}):\n` +
        ordenados
          .slice(0, 10)
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
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha inicial AAAA-MM-DD (por defecto 1992-01-01)'),
      hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha final AAAA-MM-DD'),
      tipos: z
        .array(z.enum(['C', 'T', 'SU', 'A']))
        .optional()
        .describe(
          'Tipos a incluir. Por defecto C, T y SU (doctrina). Los autos (A) son mayoría por volumen y suelen ' +
            'ser trámite, así que hay que pedirlos explícitamente: ["A"] o ["C","T","SU","A"].',
        ),
      limite: z.number().int().min(1).max(100).default(10),
    },
  },
  async ({ termino, desde, hasta, tipos, limite }) => {
    const porDefecto: ('C' | 'T' | 'SU')[] = ['C', 'T', 'SU']
    const r = await corte.buscar({ termino, desde, hasta, tipos: tipos ?? porDefecto, limite })
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
    let doc: Awaited<ReturnType<typeof corte.obtenerTexto>>
    try {
      doc = await corte.obtenerTexto(ruta)
    } catch (e) {
      // Que la ruta no exista no es un fallo de la herramienta: se informa como texto.
      if (e instanceof corte.NoExisteProvidencia) return vacio(`la providencia "${ruta}"`, e.message)
      throw e
    }
    if (doc.texto.length < 200) {
      return txt(
        `La providencia ${ruta} existe pero su documento no trae texto legible (${doc.texto.length} caracteres). ` +
          `Consúltala directamente en ${doc.url}`,
      )
    }
    if (buscar_en_texto) {
      const f = fragmentos(doc.texto, buscar_en_texto)
      if (!f.total) {
        return txt(`El término "${buscar_en_texto}" no aparece en ${ruta} (${doc.texto.length} caracteres revisados).\nURL: ${doc.url}`)
      }
      return txt(
        `${f.total} aparición(es) de "${buscar_en_texto}" en ${ruta}, agrupadas en ${f.pasajes} pasaje(s); ` +
          `se muestran ${f.trozos.length}.\n\n${f.trozos.join('\n\n---\n\n')}\n\nURL: ${doc.url}`,
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
    inputSchema: { tema_id: z.string().regex(/^\d+$/).describe('id de tema del catálogo, como texto') },
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
      temsubid: z.string().regex(/^\d+$/).describe('temsubid de buscar_por_tema (no vale el id de listar_subtemas)'),
      normid: z.string().regex(/^\d+$/).describe('normid de la misma fila de buscar_por_tema'),
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
      anio: z.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos, como texto. Ej.: "2004"'),
      limite: z.number().int().min(1).max(100).default(20),
    },
  },
  async ({ numero, anio, limite }) => {
    const r = await gestor.conceptosFp(numero, anio, limite)
    if (!r.items.length) {
      return vacio(
        'conceptos con ese número o año',
        'Recuerda que este listado solo filtra por número y año. Si buscas conceptos sobre un tema, usa buscar_normas con tipo_documento "Concepto".',
      )
    }
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
    title: 'Listar la normativa de competencia de Función Pública',
    description:
      'Listado curado por el portal con la normativa que rige o le compete al Departamento Administrativo de la ' +
      'Función Pública. OJO: no son normas que el DAFP haya expedido — incluye la Constitución Política, la Ley 100 ' +
      'de 1993 y leyes del Congreso. Es un listado corto y fijo; para buscar normativa usa buscar_normas.',
    inputSchema: {
      filtro: z.string().optional().describe('Texto para acotar por título, ej. "circular" o "1474"'),
      limite: z.number().int().min(1).max(150).default(40),
    },
  },
  async ({ filtro, limite }) => {
    const todas = await gestor.normasFp()
    const q = filtro ? sinTildes(filtro).toLowerCase() : ''
    const items = todas.filter((i) => !q || sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase().includes(q))
    if (!items.length) return vacio(`normativa de competencia del DAFP que coincida con "${filtro}"`, 'Prueba sin filtro para ver el listado completo.')
    return txt(
      `${items.length} de ${todas.length} norma(s) del listado.\n\n` +
        items
          .slice(0, limite)
          .map((i) => `- ${i.titulo} (id ${i.id})\n  Extracto temático: ${i.resumen || '(ninguno)'}\n  ${i.url}`)
          .join('\n') +
        (items.length > limite ? `\n\nSe muestran ${limite} de ${items.length}.` : ''),
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
