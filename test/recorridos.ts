/**
 * Los ocho recorridos de la auditoría, como datos.
 *
 * Medir la latencia de una llamada suelta no dice nada: lo que sufre quien usa
 * esto es CUÁNTAS LLAMADAS le cuesta contestar una pregunta. Cada recorrido es
 * la secuencia que da de verdad un modelo competente sin ayuda —no el camino
 * ideal— porque es ese camino el que se paga.
 *
 * Vive aparte de `scripts/medir.ts` para que el arnés de fallos de LLM
 * (`scripts/barrido-llm.ts`) pueda reutilizar las mismas respuestas sin volver
 * a golpear los portales. Sin efectos de lado: aquí solo hay datos y un runner.
 */
import type { Cliente } from '../test/red.ts'

export type Paso = {
  tool: string
  args: Record<string, unknown>
  /** Qué se busca con este paso, para leer la tabla sin abrir el código. */
  por?: string
}

export type Recorrido = {
  id: number
  pregunta: string
  /** El camino tal como se anduvo en la sesión real del 15–16 de septiembre. */
  pasos: Paso[]
  /** Cómo se sabe que se llegó a la respuesta. */
  espera: RegExp
  /** La fuente que responde, para la regla de alcance declarado. */
  fuente: string
  /** Contexto extra para las reglas de texto. */
  notas?: string
}

/** Cinco términos inventados por quien consultaba: el caso de campo del punto 2. */
export const RECORRIDOS: Recorrido[] = [
  {
    id: 1,
    pregunta: '¿Qué dice hoy el artículo 2.4.1.2.44 del Decreto 1066 de 2015?',
    fuente: 'Gestor Normativo',
    pasos: [
      { tool: 'resolver_cita', args: { cita: 'Decreto 1066 de 2015' }, por: 'llegar al id de la norma' },
      { tool: 'obtener_documento', args: { fuente: 'gestor', id: '{id}', articulo: '2.4.1.2.44' }, por: 'pedir el artículo por su número' },
      { tool: 'obtener_documento', args: { fuente: 'gestor', id: '{id}', buscar_en_texto: 'labores previas de verificación' }, por: 'término inventado 1' },
      { tool: 'obtener_documento', args: { fuente: 'gestor', id: '{id}', buscar_en_texto: 'informe de verificación' }, por: 'término inventado 2' },
      { tool: 'obtener_documento', args: { fuente: 'gestor', id: '{id}', buscar_en_texto: 'El protegido tendrá la oportunidad' }, por: 'término inventado 3' },
    ],
    espera: /2\.4\.1\.2\.44/,
  },
  {
    id: 2,
    pregunta: '¿Existe la SU-371 de 2021 y qué requisitos fija para admitir una grabación?',
    fuente: 'Corte Constitucional',
    pasos: [
      { tool: 'buscar_jurisprudencia', args: { termino: 'SU-371' }, por: 'localizar la providencia por su número' },
      { tool: 'buscar_jurisprudencia', args: { termino: 'grabación de llamadas' }, por: 'reintentar por materia' },
    ],
    espera: /SU-?371\s*[/-]\s*21|SU-371 de 2021|SU371\/21/,
    notas: 'erratas conocidas de la relatoría: "validas", "intensión"',
  },
  {
    id: 3,
    pregunta: '¿Está vigente el Decreto 1235 de 2023?',
    fuente: 'SUIN-Juriscol',
    pasos: [
      { tool: 'consultar_vigencia', args: { cita: 'Decreto 1235 de 2023' }, por: 'pedir el estado de vigencia' },
      { tool: 'resolver_cita', args: { cita: 'Decreto 1235 de 2023' }, por: 'ver si la norma aparece' },
    ],
    espera: /Estado:\s*(?:Vigente|Derogado|Vigencia en Estudio|Sustituido|Compilado|No vigente|Declarado Inexequible)/i,
    notas: 'el caso de referencia de la regla de identidad (regla 4) y del no colapso (regla 1)',
  },
  {
    id: 4,
    pregunta: 'Dame los artículos 3, 40 y 47 de la Ley 1437 de 2011',
    fuente: 'Gestor Normativo',
    pasos: [
      { tool: 'resolver_cita', args: { cita: 'Ley 1437 de 2011', articulos: ['3', '40', '47'] }, por: 'una sola llamada con el lote de artículos' },
    ],
    espera: /art[ií]culo 40|Art[ií]culo 40|ART[IÍ]CULO 40/,
    notas: 'control: hoy funciona bien. Es el patrón a imitar.',
  },
  {
    id: 5,
    pregunta: '¿A qué documento remite el numeral 1.16 del artículo 2.4.1.2.44?',
    fuente: 'Gestor Normativo',
    pasos: [
      { tool: 'resolver_cita', args: { cita: 'Decreto 1066 de 2015' }, por: 'llegar al id' },
      { tool: 'obtener_documento', args: { fuente: 'gestor', id: '{id}', articulo: '2.4.1.2.44' }, por: 'leer el artículo que remite' },
      { tool: 'obtener_documento', args: { fuente: 'gestor', id: '{id}', buscar_en_texto: 'Manual de Uso, Manejo y Recomendaciones' }, por: 'buscar el documento remitido dentro de la norma' },
    ],
    espera: /remite al? (?:Manual|documento)|este art[ií]culo remite|remisi[oó]n a/i,
    notas: 'se espera que el recorrido NO llegue: el manual no está en ninguna fuente y hoy no se detecta la remisión',
  },
  {
    id: 6,
    pregunta: '¿Qué resoluciones de la CREG regulan el cargo por confiabilidad?',
    fuente: 'CREG',
    pasos: [
      { tool: 'buscar_resoluciones_creg', args: { texto: 'cargo por confiabilidad' }, por: 'buscar por materia' },
      { tool: 'buscar_normas', args: { palabras: 'cargo por confiabilidad' }, por: 'el buscador general, uniendo términos con OR' },
    ],
    espera: /confiabilidad/i,
  },
  {
    id: 7,
    pregunta: '¿Qué ha dicho la Sala Laboral de la Corte Suprema sobre estabilidad reforzada?',
    fuente: 'Corte Suprema',
    pasos: [
      { tool: 'buscar_jurisprudencia_suprema', args: { texto: 'estabilidad reforzada', sala: 'Laboral', limite: 5 }, por: 'buscar en la sala Laboral' },
      { tool: 'buscar_normas', args: { palabras: 'estabilidad laboral reforzada' }, por: 'el buscador general' },
    ],
    espera: /estabilidad/i,
  },
  {
    id: 8,
    pregunta: '¿Qué sentencias hay sobre uso indebido de medidas de protección de la UNP?',
    fuente: 'Corte Constitucional',
    pasos: [
      { tool: 'buscar_jurisprudencia', args: { termino: 'uso indebido de medidas de protección' }, por: 'buscar por materia' },
      { tool: 'buscar_unificado', args: { texto: 'medidas de protección UNP', limite: 5 }, por: 'buscar en varias fuentes a la vez' },
    ],
    espera: /UNP|medidas de protecci[oó]n/i,
  },
]

export type ResultadoPaso = {
  tool: string
  por: string
  /** El texto crudo que devolvió el servidor: lo reutilizan los jurados de texto. */
  texto: string
  ms: number
  /** Peticiones HTTP que costó ESTE paso (el contador del server es acumulado). */
  http: number
  bytes: number
  caracteres: number
  esError: boolean
  /** `true` si la respuesta trae la marca de que se llegó. */
  acierta: boolean
}

export type ResultadoRecorrido = {
  recorrido: Recorrido
  pasos: ResultadoPaso[]
  /** Suma de llamadas, peticiones HTTP y caracteres devueltos. */
  llamadas: number
  http: number
  caracteres: number
  ms: number
  /** `true` si ALGÚN paso devolvió la marca esperada. */
  llego: boolean
  /** El primer paso que la devolvió, o null. */
  llegoEn: number | null
}

/** Interpreta `{id}` con el primer id que aparezca en las respuestas anteriores. */
function sustituir(args: Record<string, unknown>, ctx: Record<string, string>): Record<string, unknown> {
  const salida: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args)) {
    salida[k] = typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, n: string) => ctx[n] ?? '') : v
  }
  return salida
}

/**
 * Corre un recorrido entero y devuelve las medidas. El `ctx` se alimenta de las
 * propias respuestas, igual que haría un modelo leyendo la anterior.
 */
export async function correrRecorrido(c: Cliente, r: Recorrido): Promise<ResultadoRecorrido> {
  const ctx: Record<string, string> = {}
  const pasos: ResultadoPaso[] = []
  let llegoEn: number | null = null
  let httpAcumulado = 0

  for (const [i, paso] of r.pasos.entries()) {
    const args = sustituir(paso.args, ctx)
    const antes = c.peticionesAcumuladas()
    const t0 = Date.now()
    let texto = ''
    let esError = false
    try {
      const res = await c.tool(paso.tool, args)
      texto = res.texto
      esError = res.esError
    } catch (e) {
      texto = `TRANSPORTE: ${(e as Error).message}`
      esError = true
    }
    const ms = Date.now() - t0
    const uso = c.ultimoUso(paso.tool)
    const http = Math.max(0, c.peticionesAcumuladas() - antes)
    httpAcumulado += http

    // Lo que un modelo leería de la respuesta para el paso siguiente.
    const id = /\bid:\s*(\d{3,7})/.exec(texto)?.[1]
    if (id) ctx['id'] = id
    const ruta = /\bruta:\s*([^\s]+)/.exec(texto)?.[1]
    if (ruta) ctx['ruta'] = ruta

    const acierta = r.espera.test(texto)
    if (acierta && llegoEn === null) llegoEn = i + 1

    pasos.push({
      tool: paso.tool,
      por: paso.por ?? '',
      texto,
      ms,
      http,
      bytes: uso?.bytes ?? 0,
      caracteres: texto.length,
      esError,
      acierta,
    })
  }

  return {
    recorrido: r,
    pasos,
    llamadas: r.pasos.length,
    http: httpAcumulado,
    caracteres: pasos.reduce((a, p) => a + p.caracteres, 0),
    ms: pasos.reduce((a, p) => a + p.ms, 0),
    llego: llegoEn !== null,
    llegoEn,
  }
}

/** Estimación de tokens de las respuestas: la heurística b/4 sobre el texto devuelto. */
export const tokens = (caracteres: number): number => Math.round(caracteres / 4)

/** Corre los ocho y devuelve la tabla completa. */
export async function correrTodos(c: Cliente, solo?: number[]): Promise<ResultadoRecorrido[]> {
  const salida: ResultadoRecorrido[] = []
  for (const r of RECORRIDOS) {
    if (solo && !solo.includes(r.id)) continue
    salida.push(await correrRecorrido(c, r))
  }
  return salida
}

/** Tabla comparable entre ejecuciones, para pegar en el informe. */
export function tabla(resultados: ResultadoRecorrido[]): string {
  const lineas = [
    'rec  pregunta (recortada)                            llamadas  http  caracteres  ~tokens       ms  ¿llegó?',
    '---  ---------------------------------------------  --------  ----  ----------  -------  -------  --------',
  ]
  for (const r of resultados) {
    lineas.push(
      `${String(r.recorrido.id).padStart(3)}  ${r.recorrido.pregunta.slice(0, 45).padEnd(45)}  ` +
        `${String(r.llamadas).padStart(8)}  ${String(r.http).padStart(4)}  ${String(r.caracteres).padStart(10)}  ` +
        `${String(tokens(r.caracteres)).padStart(7)}  ${String(Math.round(r.ms)).padStart(7)}  ` +
        `${r.llego ? `sí (paso ${r.llegoEn})` : 'NO'}`,
    )
  }
  return lineas.join('\n')
}
