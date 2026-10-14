/**
 * Búsqueda federada `buscar_unificado`: una sola herramienta que agrega las
 * fuentes ya existentes (Gestor, Corte Constitucional, SUIN y DIAN) para que
 * el enrutado no dependa solo de las INSTRUCCIONES.
 *
 * Es orquestación, no un scraper nuevo: reutiliza `gestor.buscar/tematica`,
 * `corte.buscar`, `suin.buscar` y `dian.buscar`, con `conAlternativas` por
 * fuente cuando rinde 0. Cada resultado se etiqueta con su fuente y su URL, y
 * la vigencia de SUIN se rotula "SEGÚN EL BUSCADOR" sin reinterpretarla.
 *
 * Ranking trivial: `perfil=tributario` prioriza la DIAN; el resto sigue el
 * orden Gestor → Corte → SUIN → DIAN. No hay reranking LLM ni router: es un
 * fan-out explícito y testeable.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance, proyectar } from '../nucleo/alcance.ts'
import { fechaBogota } from '../nucleo/fecha.ts'
import { FUENTES, CLAVE_ALCANCE, NOTA_SUIN, PERFILES_ADMITIDOS, POR_FUENTE, fuentesDe, ordenar, type Fuente, type Item } from './buscar_unificado/fuentes.ts'

export const TITULO = 'Buscar en varias fuentes a la vez'

export const DESCRIPCION =
  'Busca en paralelo en Gestor Normativo, Corte Constitucional, SUIN-Juriscol y DIAN, y agrega los ' +
  'resultados con su fuente y su enlace. Úsala cuando la consulta es abierta o por materia y no hay ' +
  'herramienta obvia; para una cita exacta sigue siendo mejor resolver_cita y para un tribunal concreto, su ' +
  'buscador propio. perfil elige las fuentes ("salud" añade INVIMA y Supersalud; "mineria", la ANM) y el ' +
  'orden; si pasas fuentes, esa lista manda y el perfil solo ordena. limite es POR fuente, así que el total ' +
  'puede multiplicarse. La vigencia de SUIN se rotula SEGÚN EL BUSCADOR y no es la ficha oficial. Cuando la ' +
  'fuente sirve su texto, cada resultado trae "Para leer", la llamada lista a obtener_documento. Una fuente ' +
  'caída se declara como fallo, no como vacío.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

export const schema = estricto({
  texto: z.string().describe('Términos a buscar, ej. "teletrabajo"'),
  perfil: z
    .enum(['laboral', 'tributario', 'ambiental', 'contratacion', 'energia', 'salud', 'mineria'])
    .optional()
    .describe(
      'Perfil sectorial: prioriza la fuente que mejor responde a ese sector (tributario → DIAN; salud → INVIMA ' +
        'y Supersalud; mineria → ANM)',
    ),
  fuentes: z
    // Solo las encendidas (FUENTES): pedir una apagada no se puede ni escribir.
    .array(z.enum(proyectar(FUENTES, (f) => CLAVE_ALCANCE[f])))
    .optional()
    .describe('Fuentes a consultar; sin él se usan todas menos DIAN (que va con perfil=tributario)'),
  limite: z.coerce.number().int().min(1).max(30).default(15).describe('Cuántos resultados por fuente (máximo 30)'),
  formato: z
    .enum(['markdown', 'json'])
    .default('markdown')
    .describe(
      'Salida: "markdown" (texto legible, por defecto) o "json" (un objeto con fecha_consulta, alcance, texto, ' +
        'resultados, sin_resultados, fallidas y avisos, sin cabecera ni pie)',
    ),
})

/** Entrada del cliente: los campos con default (limite, formato) llegan opcionales. */
type Parametros = z.input<typeof schema>


export function formatear(
  resultados: Partial<Record<Fuente, Item[]>>,
  texto: string,
  perfil?: string,
  /** Fallos por fuente (fuente → mensaje): se declaran como fallo, nunca como vacío. */
  fallidas: Partial<Record<Fuente, string>> = {},
): string {
  const consultadas = Object.keys(resultados) as Fuente[]
  const conFallo = new Set(Object.keys(fallidas) as Fuente[])
  const vacias = consultadas.filter((f) => !resultados[f]?.length && !conFallo.has(f))
  const ordenados = ordenar(Object.values(resultados).flat(), perfil)
  const lineas: string[] = []
  for (const item of ordenados) {
    // «Para leer» va pegado a la URL: es la llamada que devuelve el TEXTO del
    // resultado, y solo la traen las fuentes cuyo texto sí se puede pedir.
    const extra =
      (item.detalle ? `\n  ${item.detalle}` : '') + (item.paraLeer ? `\n  Para leer: ${item.paraLeer}` : '')
    lineas.push(`- [${item.fuente}] ${item.titulo}\n  ${item.url}${extra}`)
  }
  const bloque = [
    `Resultados para "${texto}"${perfil ? ` (perfil ${perfil})` : ''}:`,
    ...(lineas.length ? lineas : ['  (sin resultados)']),
  ]
  if (vacias.length) {
    bloque.push(
      '',
      `Sin resultados en: ${vacias.join(', ')} (respondieron sin nada).`,
      'Un vacío en una fuente NO significa que la norma no exista; para una cita exacta usa resolver_cita.',
    )
  }
  const caidas = consultadas.filter((f) => conFallo.has(f))
  if (caidas.length) {
    bloque.push(
      '',
      `No se pudo consultar: ${caidas.map((f) => `${f} (${fallidas[f] ?? 'la fuente no respondió'})`).join('; ')}.`,
      'Esto es un FALLO de la fuente, no un vacío: no concluyas que no hay resultados ahí. Vuelve a intentarlo.',
    )
  }
  // Una sola línea al final explica por qué hay resultados sin «Para leer».
  if (ordenados.some((i) => i.fuente === 'suin')) bloque.push('', NOTA_SUIN)
  return bloque.join('\n')
}

export async function escribir(
  params: Parametros,
  deps: { porFuente?: Record<Fuente, (texto: string, limite: number) => Promise<Item[]>> } = {},
): Promise<string> {
  const json = params.formato === 'json'
  // Un perfil desconocido no debe ejecutar ningún fan-out: se lista lo admitido.
  if (params.perfil && !(PERFILES_ADMITIDOS as readonly string[]).includes(params.perfil)) {
    const cabecera = 'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).'
    const aviso = `No existe el perfil "${params.perfil}". Disponibles: ${PERFILES_ADMITIDOS.join(', ')}.`
    if (json) {
      return JSON.stringify({
        fecha_consulta: fechaBogota(),
        texto: params.texto,
        perfil: params.perfil,
        alcance: cabecera,
        resultados: [],
        sin_resultados: [],
        fallidas: {},
        avisos: [aviso],
      })
    }
    return `${cabecera}\n\n${aviso}`
  }
  const porFuente = deps.porFuente ?? POR_FUENTE
  const fuentes = fuentesDe(params.perfil, params.fuentes)
  const limite = Math.min(params.limite ?? 15, 30)
  const resultado = {} as Record<Fuente, Item[]>
  for (const f of FUENTES) resultado[f] = []
  const fallidas: Partial<Record<Fuente, string>> = {}

  await Promise.all(
    fuentes.map(async (f) => {
      try {
        // Supersalud pide el doble: lo que INVIMA ya trae se descarta más abajo y el límite se completa con lo siguiente.
        resultado[f] = await porFuente[f](params.texto, f === 'supersalud' ? limite * 2 : limite)
      } catch (e) {
        // Una fuente caída no tumba el resto: se anota como FALLO con su
        // mensaje, no como vacío. Un vacío dice "respondió sin nada"; un fallo
        // dice "no se sabe qué hay ahí". En materia jurídica confundirlos es
        // afirmar que no hay jurisprudencia sobre algo.
        resultado[f] = []
        fallidas[f] = e instanceof Error ? e.message : String(e)
      }
    }),
  )

  // INVIMA y Supersalud publican el mismo normograma: el mismo acto sale de las dos
  // y gastaba el límite en copias. Sale una vez, atribuido a INVIMA.
  // ponytail: la clave es el nombre de archivo; el techo es un acto que las dos entidades publiquen con nombres distintos; el salto sería comparar epígrafes normalizados.
  const archivo = (url: string): string => url.split(/[?#]/)[0]!.split('/').pop() ?? ''
  const deInvima = new Map(resultado.invima.map((i): [string, Item] => [archivo(i.url), i]))
  resultado.supersalud = resultado.supersalud
    .filter((i) => {
      const gemelo = archivo(i.url) ? deInvima.get(archivo(i.url)) : undefined
      if (gemelo) gemelo.detalle = 'también en Supersalud'
      return !gemelo
    })
    .slice(0, limite)

  // Solo se declaran vacíos de las fuentes que SÍ se consultaron: un filtro
  // explícito (fuentes=["corte"]) no debe reportar "sin resultados" en las
  // que nunca se pidieron.
  const consultadas = Object.fromEntries(fuentes.map((f) => [f, resultado[f]])) as Record<Fuente, Item[]>
  // La línea de alcance se arma de lo que de verdad se consultó: una entrada por
  // clave (INVIMA y Supersalud se funden en "sectorial"), con cuántos resultados
  // trajo cada una y "falló" para las que no respondieron. Las fuentes que no
  // están en `fuentes` quedan declaradas como no consultadas por `alcance`.
  const porClave = new Map<string, { n: number; fallo: boolean }>()
  for (const f of fuentes) {
    const visto = porClave.get(CLAVE_ALCANCE[f]) ?? { n: 0, fallo: false }
    if (fallidas[f]) visto.fallo = true
    else visto.n += resultado[f].length
    porClave.set(CLAVE_ALCANCE[f], visto)
  }
  const usadas = [...porClave].map(([clave, v]) => ({
    clave,
    detalle: v.fallo ? (v.n ? `${v.n} resultado(s) y un fallo` : 'falló') : `${v.n} resultado(s)`,
  }))
  const lineaAlcance = alcance(usadas)

  // Modo json: los mismos datos que el markdown, sin cabecera ni pie, y con lo
  // que en prosa eran advertencias dentro de `avisos`. Sin sangría: se paga en
  // contexto. `sin_resultados` y `fallidas` reemplazan los bloques de prosa.
  if (json) {
    const conFallo = new Set(Object.keys(fallidas) as Fuente[])
    const vacias = fuentes.filter((f) => !resultado[f].length && !conFallo.has(f))
    const caidas = fuentes.filter((f) => conFallo.has(f))
    const todos = ordenar(Object.values(consultadas).flat(), params.perfil)
    const avisos: string[] = []
    if (vacias.length)
      avisos.push('Un vacío en una fuente NO significa que la norma no exista; para una cita exacta usa resolver_cita.')
    if (caidas.length)
      avisos.push('Esto es un FALLO de la fuente, no un vacío: no concluyas que no hay resultados ahí. Vuelve a intentarlo.')
    if (todos.some((i) => i.fuente === 'suin')) avisos.push(NOTA_SUIN)
    return JSON.stringify({
      fecha_consulta: fechaBogota(),
      texto: params.texto,
      ...(params.perfil ? { perfil: params.perfil } : {}),
      alcance: lineaAlcance,
      resultados: todos,
      sin_resultados: vacias,
      fallidas,
      avisos,
    })
  }
  return `${lineaAlcance}\n\n${formatear(consultadas, params.texto, params.perfil, fallidas)}`
}
