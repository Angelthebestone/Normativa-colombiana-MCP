/** Esquema, contrato por fuente y tipos de `obtener_documento`. */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type * as gestor from '../../fuentes/gestor/index.ts'
import type * as suin from '../../fuentes/suin/index.ts'
import { estricto, numeroDeArticulo } from '../../nucleo/normalizar.ts'
import { proyectar } from '../../nucleo/alcance.ts'

export const TITULO = 'Obtener el texto de un documento por fuente'

export const DESCRIPCION =
  'Devuelve el texto (troceado, nunca entero) de una de las ocho fuentes con texto. CADA FUENTE EXIGE LO ' +
  'SUYO y los parámetros de otra no valen con ella: gestor necesita id; suin, id; corte, ruta; suprema, ruta y sala; ' +
  'consejo, token; dian, link; creg, ruta; sectorial, entidad y url. Una combinación que no encaje se ' +
  'rechaza antes de salir a la red, diciendo qué falta y el ejemplo mínimo que funciona. Qué parte sale: ' +
  'historial (gestor) da los cambios anotados en vez del texto, del artículo si va con articulo; articulo ' +
  '(gestor y suin) o seccion (cortes) acotan y entonces buscar_en_texto no se aplica; desde solo avanza el troceo, ' +
  'no los pasajes de buscar_en_texto. Informa total/mostrado/omitido y el "desde" del trozo siguiente. ' +
  'ESCRIBE EN DISCO solo con entero o ruta_destino, que se imponen a todo lo anterior: dian y sectorial ' +
  'guardan el archivo original; las demás, texto-<fuente>.txt (sin ruta_destino, en una carpeta temporal); ' +
  'consejo no lo admite. Nunca sobrescribe: un nombre repetido lleva sufijo. Para encontrar el documento usa ' +
  'antes resolver_cita o el buscador de su fuente.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
}

/** El esquema común a todas las fuentes. */
const comun = {
  buscar_en_texto: z.string().optional().describe('Devuelve solo los fragmentos que mencionan este término'),
  desde: z.coerce.number().int().min(0).default(0),
  max_pasajes: z.coerce.number().int().positive().optional().describe('Máximo de pasajes con buscar_en_texto (por defecto 10)'),
  limite_caracteres: z.coerce
    .number()
    .int()
    .positive()
    .default(8000)
    .describe('Tope del TEXTO devuelto; se ajusta al rango 200–40.000'),
}

/**
 * Descargar a disco vale con cualquier fuente, así que vive aparte de los extras
 * por fuente y la unión de abajo (cerrada con `.strict()`) también lo admite: sin
 * esto, `entero` y `ruta_destino` se anunciaban y se rechazaban siempre.
 */
const archivo = {
  entero: z
    .boolean()
    .optional()
    .describe('En vez de trocear, escribe el documento a disco y devuelve la ruta con un trozo del texto'),
  ruta_destino: z
    .string()
    .optional()
    .describe('Carpeta donde guardar el archivo (con entero o para descargar el PDF/Word sin devolver texto)'),
}

export const schema = estricto({
  // Solo las fuentes encendidas (FUENTES): la llamada a una apagada no se puede
  // ni escribir, y la valida el mismo esquema antes de tocar la red.
  fuente: z
    .enum(proyectar(['gestor', 'suin', 'corte', 'suprema', 'consejo', 'dian', 'creg', 'sectorial'] as const, (f) => f))
    .describe('De qué fuente sale el documento'),
  ...comun,
  // Extras por fuente (opcionales; el handler valida cuál aplica según fuente).
  id: z.coerce.string().optional().describe('Solo gestor y suin: id numérico de la norma'),
  articulo: z.preprocess(numeroDeArticulo, z.string().optional()).describe('Solo gestor y suin: número de artículo'),
  historial: z
    .boolean()
    .optional()
    .describe('Solo gestor: en vez del texto, devuelve los cambios anotados sobre la norma'),
  sin_temas: z
    .boolean()
    .optional()
    .describe('Solo gestor: omite el bloque de temas asociados (ahorra contexto cuando solo se quiere el articulado)'),
  ruta: z.string().optional().describe('corte/suprema/creg: ruta del documento'),
  seccion: z
    .enum(['encabezado', 'antecedentes', 'consideraciones', 'decision', 'salvamentos', 'aclaraciones', 'notas'])
    .optional()
    .describe(
      'Solo corte, suprema y consejo: devuelve solo esa parte de la providencia. "consideraciones" es la motivación ' +
        'de la MAYORÍA; "salvamentos" y "aclaraciones" son los votos particulares, que NO son doctrina de la Sala.',
    ),
  sala: z.string().optional().describe('Solo suprema: la MISMA sala con la que se encontró'),
  token: z.string().optional().describe('Solo consejo: token que devuelve buscar_jurisprudencia_consejo_estado'),
  link: z.string().optional().describe('Solo dian: nombre del archivo, ej. "decreto_1625_2016.htm"'),
  entidad: z
    .string()
    .optional()
    .describe('Solo sectorial: id del regulador (los lista buscar_normativa_sectorial)'),
  url: z
    .string()
    .optional()
    .describe('Solo sectorial: enlace del acto a leer, tal como lo devuelve buscar_normativa_sectorial'),
  ...archivo,
})

/** El tipo de entrada (los valores con default se resuelven al validar). */
export type Parametros = z.input<typeof schema>
/** Ya validado y con los defaults aplicados (desde/limite_caracteres resueltos). */
export type Resueltas = z.infer<typeof schema>

/**
 * El contrato real de `fuente`, en una tabla que el mensaje de error reutiliza.
 *
 * La unión discriminada de abajo ES la validación de verdad, pero no puede ser
 * el `inputSchema` publicado: `registerTool` normaliza con
 * `normalizeObjectSchema`, que devuelve `undefined` para una unión (no tiene
 * `.shape`) y publica entonces un esquema VACÍO —medido: el cliente dejaría de
 * ver los 18 parámetros de esta herramienta, que es la que más pesa—. Por eso
 * el contrato va además en la descripción, que el cliente sí lee, y se comprueba
 * aquí antes de tocar la red.
 */
const EXIGE: Record<string, string[]> = {
  gestor: ['id'],
  suin: ['id'],
  corte: ['ruta'],
  suprema: ['ruta', 'sala'],
  consejo: ['token'],
  dian: ['link'],
  creg: ['ruta'],
  sectorial: ['entidad', 'url'],
}

/** El ejemplo mínimo que funciona, por fuente: es lo que el error devuelve. */
const EJEMPLO: Record<string, string> = {
  gestor: '{"fuente":"gestor","id":"31431"}',
  suin: '{"fuente":"suin","id":"1670817"}',
  corte: '{"fuente":"corte","ruta":"2021/SU-371-21.htm"}',
  suprema: '{"fuente":"suprema","ruta":"<la de buscar_jurisprudencia_suprema>","sala":"Laboral"}',
  consejo: '{"fuente":"consejo","token":"<el de buscar_jurisprudencia_consejo_estado>"}',
  dian: '{"fuente":"dian","link":"decreto_1625_2016.htm"}',
  creg: '{"fuente":"creg","ruta":"<la de buscar_resoluciones_creg>"}',
  sectorial: '{"fuente":"sectorial","entidad":"sic","url":"<la de buscar_normativa_sectorial>"}',
}

/**
 * Parámetro exclusivo → fuentes que lo admiten. Con otra fuente se RECHAZA en
 * vez de ignorarse: `{fuente:"gestor", id:"31431", ruta:"…"}` devolvía la norma
 * del id y tiraba la ruta sin decir nada, que es el peor desenlace posible.
 */
const EXCLUSIVOS: Record<string, string[]> = {
  id: ['gestor', 'suin'],
  articulo: ['gestor', 'suin'],
  historial: ['gestor'],
  sin_temas: ['gestor'],
  seccion: ['corte', 'suprema', 'consejo'],
  sala: ['suprema'],
  token: ['consejo'],
  link: ['dian'],
  ruta: ['corte', 'suprema', 'creg'],
  entidad: ['sectorial'],
  url: ['sectorial'],
}

const SECCIONES_PROVIDENCIA = [
  'encabezado',
  'antecedentes',
  'consideraciones',
  'decision',
  'salvamentos',
  'aclaraciones',
  'notas',
] as const

/**
 * Identificador que se acepta como número o como texto, pero que NO se inventa
 * cuando falta: `z.coerce.string()` convierte `undefined` en la cadena
 * "undefined", así que una fuente sin su parámetro obligatorio pasaría la unión
 * y el error se daría más tarde. Medido: `{fuente:"gestor"}` colaba por ahí.
 */
const identificador = z.union([z.string(), z.number()]).transform(String)

/**
 * La unión discriminada por `fuente`: cada rama exige lo suyo y `.strict()`
 * convierte el parámetro de otra fuente en un error en vez de en un descarte
 * silencioso. El SDK no la publica (ver arriba), pero es la que valida.
 */
const compartidos = { ...comun, ...archivo }
export const union = z.discriminatedUnion('fuente', [
  z
    .object({
      ...compartidos,
      fuente: z.literal('gestor'),
      id: identificador,
      articulo: z.string().optional(),
      historial: z.boolean().optional(),
      sin_temas: z.boolean().optional(),
    })
    .strict(),
  z.object({ ...compartidos, fuente: z.literal('suin'), id: identificador, articulo: z.string().optional() }).strict(),
  z.object({ ...compartidos, fuente: z.literal('corte'), ruta: z.string(), seccion: z.enum(SECCIONES_PROVIDENCIA).optional() }).strict(),
  z
    .object({ ...compartidos, fuente: z.literal('suprema'), ruta: z.string(), sala: z.string(), seccion: z.enum(SECCIONES_PROVIDENCIA).optional() })
    .strict(),
  z.object({ ...compartidos, fuente: z.literal('consejo'), token: z.string(), seccion: z.enum(SECCIONES_PROVIDENCIA).optional() }).strict(),
  z.object({ ...compartidos, fuente: z.literal('dian'), link: z.string() }).strict(),
  z.object({ ...compartidos, fuente: z.literal('creg'), ruta: z.string() }).strict(),
  // La entidad se resuelve en el handler (y allí se listan los ids válidos):
  // enumerarla aquí exigiría el registro sectorial ya cargado, y este módulo se
  // evalúa antes de `src/fuentes/sectorial/registro.ts`.
  z.object({ ...compartidos, fuente: z.literal('sectorial'), entidad: z.string(), url: z.string() }).strict(),
])

/** El error de una combinación imposible: qué se pidió, qué falta o sobra, y qué sí funciona. */
export function problemaDeFuente(r: Resueltas): string {
  const campos = r as unknown as Record<string, unknown>
  const f = r.fuente
  const faltan = (EXIGE[f] ?? []).filter((k) => campos[k] === undefined)
  const sobran = Object.entries(EXCLUSIVOS)
    .filter(([k, dueñas]) => !dueñas.includes(f) && campos[k] !== undefined)
    .map(([k, dueñas]) => `${k} (es de ${dueñas.join('/')})`)
  const motivo =
    [faltan.length ? `hace falta ${faltan.join(' y ')}` : '', sobran.length ? `sobra ${sobran.join(', ')}` : '']
      .filter(Boolean)
      .join('; ') || 'los parámetros no encajan con esa fuente'
  return (
    `${motivo.charAt(0).toUpperCase()}${motivo.slice(1)}. ` +
    `Cada valor de "fuente" exige lo suyo (${Object.entries(EXIGE).map(([k, v]) => `${k}→${v.join('+')}`).join(', ')}). ` +
    `Ejemplo mínimo que funciona: ${EJEMPLO[f]}`
  )
}

export const topeDe = (l: number | undefined): number => Math.min(Math.max(l ?? 8000, 200), 40_000)

/**
 * Dependencias inyectables para probar sin red: los extractores sectoriales y
 * la descarga aceptan las suyas, y aquí se propagan. El servidor llama sin
 * ellas; los tests las pasan para no depender de portales.
 */
export type DepsLectura = {
  pedirBytes?: typeof import('../../nucleo/http.ts')['pedirBytes']
  extraerPdf?: (bytes: Uint8Array) => Promise<string>
  descomprimirZip?: (bytes: Uint8Array) => Promise<Uint8Array | null>
  obtenerNorma?: typeof gestor.obtenerNorma
  documentoSuin?: typeof suin.documento
}
