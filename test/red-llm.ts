/**
 * Arnés de fallos de LLM.
 *
 * `scripts/barrido-disruptivo.ts` responde a «¿se rompió algo?»: busca salidas
 * malformadas (`undefined`, `NaN`, `[object Object]`, nombres viejos). Este
 * arnés responde a la otra pregunta, que es la que ha costado caro en sesiones
 * reales: **¿puede un modelo competente sacar una conclusión falsa de una
 * respuesta perfectamente bien formada?**
 *
 * Los tres fallos de campo que motivaron esto —el artículo equivocado del
 * Decreto 1235, dos frases de una aclaración de voto citadas como doctrina y
 * la vigencia dicha sin poder afirmarla— pasaban el barrido disruptivo sin una
 * sola queja: tenían su fecha, su descargo y su formato impecables.
 *
 * Tres familias:
 *
 *  1. La llamada verosímil y equivocada, generada del JSON Schema publicado en
 *     `tools/list` para que crezca sola cuando se añada una herramienta.
 *  2. Propiedades del TEXTO de una respuesta correcta (nueve reglas).
 *  3. El juez: una respuesta real pasada a un modelo barato con una pregunta
 *     cerrada. Si el modelo concluye lo que la respuesta no dice, el fallo es
 *     del servidor, no del juez.
 *
 * Este fichero es la LÍNEA BASE: define el arnés y sus casos propios. Los
 * agentes A, B y C añaden los suyos en `test/red-llm-a.ts`, `-b.ts` y `-c.ts`
 * importando de aquí.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// --- utilidades de texto --------------------------------------------------

/** Bloques de una respuesta: párrafos separados por línea en blanco. */
export const bloques = (texto: string): string[] => texto.split(/\n{2,}/)

/** Primer quinto del texto: donde un modelo lee con más atención. */
export const primerQuinto = (texto: string): string => texto.slice(0, Math.ceil(texto.length / 5))

/** Sin tildes y en minúsculas, para comparar identificadores. */
export const normal = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** La fecha de consulta que el servidor estampa en toda respuesta no-error. */
export const FECHA_CONSULTA = /consulta del\s+\d{4}-\d{2}-\d{2}/i

// --- familia 1: la llamada verosímil y equivocada -------------------------

/**
 * Clase del caso, porque la aserción NO es la misma para las dos:
 *
 *  - `contrato`: los argumentos son inválidos (enum con sinónimo, condicional
 *    omitido, parámetro de otra fuente, contradicción). Debe fallar el esquema
 *    o devolver un error que nombre el valor correcto. Un «no encontré nada»
 *    aquí es el peor resultado: el modelo deduce que no hay resultados y
 *    reintenta con sinónimos hasta agotarse.
 *  - `inexistente`: los argumentos son válidos y el identificador tiene forma
 *    correcta pero no existe. Debe devolver una negativa explícita, nunca un
 *    error de conexión: «la fuente falló» y «no existe» son estados distintos.
 */
export type ClaseCaso = 'contrato' | 'inexistente'

export type CasoCalle = {
  tool: string
  args: Record<string, unknown>
  motivo: string
  clase: ClaseCaso
}

/** Sinónimos plausibles: los que comete quien conoce el dominio pero no el esquema. */
const SINONIMOS: Record<string, string> = {
  fuente: 'constitucional',
  seccion: 'considerandos',
  compilacion: 'vigente',
  nivel: 'sentencia',
  perfil: 'penal',
  accion: 'borrar',
  catalogo: 'normas',
  entidad: 'noexiste',
  campo: 'notas',
  vigencia: 'no vigente',
  sala: 'laboral',
}

/** Identificadores inventados con forma válida: un modelo no inventa basura. */
const INVENTADOS: Record<string, string> = {
  cita: 'C-377 de 2000',
  ruta: '2021/SU-371-21.htm',
  id: '99999999',
  token: 'a1b2c3d4e5f6a7b8',
  link: 'decreto_9999_2030.htm',
  numero: '9999',
  anio: '2030',
  norma_a: 'Ley 9999 de 2030',
  norma_b: 'Decreto 9999 de 2030',
  termino: 'estabilidad laboral reforzadisima',
}

/** Qué exige cada valor de `fuente` en `obtener_documento`, leído de su handler. */
const EXTRAS_POR_FUENTE: Record<string, string[]> = {
  gestor: ['id'],
  corte: ['ruta'],
  suprema: ['ruta', 'sala'],
  consejo: ['token'],
  dian: ['link'],
  creg: ['ruta'],
  sectorial: ['entidad', 'url'],
}

type EsquemaPublicado = {
  name: string
  inputSchema?: { properties?: Record<string, { enum?: unknown[] }>; required?: string[] }
}

/**
 * Genera los casos de la familia 1 a partir del esquema que el servidor publica.
 * Derivarlo del esquema —y no de una lista escrita a mano— es lo que hace que
 * la cobertura crezca sola cuando se añada una herramienta.
 */
export function generarFamilia1(tools: EsquemaPublicado[]): CasoCalle[] {
  const casos: CasoCalle[] = []
  for (const t of tools) {
    const props = t.inputSchema?.properties ?? {}
    const req = t.inputSchema?.required ?? []

    // 1) Enum con sinónimo plausible.
    for (const [clave, def] of Object.entries(props)) {
      if (!def.enum?.length) continue
      const valores = def.enum.map((v) => String(v))
      const sinonimo =
        SINONIMOS[clave] ??
        (valores[0] && /^[A-ZÁÉÍÓÚÑ]/.test(valores[0]) ? valores[0].toLowerCase() : `${valores[0]}s`)
      if (valores.includes(sinonimo)) continue
      const base = baseValida(props, req)
      casos.push({
        tool: t.name,
        args: { ...base, [clave]: sinonimo },
        motivo: `${clave}: "${sinonimo}" (valores válidos: ${valores.join('|')})`,
        clase: 'contrato',
      })
    }

    // 2) Identificador inventado con forma válida.
    for (const clave of Object.keys(props)) {
      const valor = INVENTADOS[clave]
      if (!valor) continue
      const base = baseValida(props, req)
      casos.push({
        tool: t.name,
        args: { ...base, [clave]: valor },
        motivo: `${clave}: ${valor} (forma correcta, no existe)`,
        clase: 'inexistente',
      })
      break // uno por herramienta: la batería completa multiplicaría la red por 26
    }

    // 3) Parámetro condicional omitido.
    if (t.name === 'obtener_documento' && props['fuente']?.enum) {
      for (const fuente of props['fuente'].enum.map((v) => String(v))) {
        const faltan = EXTRAS_POR_FUENTE[fuente] ?? []
        if (!faltan.length) continue
        casos.push({
          tool: t.name,
          args: { fuente },
          motivo: `fuente="${fuente}" sin ${faltan.join(' ni ')}`,
          clase: 'contrato',
        })
      }
    }

    // 4) Parámetro de otra fuente.
    if (t.name === 'obtener_documento') {
      casos.push({
        tool: t.name,
        args: { fuente: 'corte', id: '31431' },
        motivo: 'fuente="corte" con id, que es parámetro de gestor',
        clase: 'contrato',
      })
    }

    // 5) Dos parámetros que se contradicen.
    if (t.name === 'resolver_cita') {
      casos.push({
        tool: t.name,
        args: { cita: 'art. 5 de la Ley 909 de 2004', articulos: ['7'] },
        motivo: 'cita apunta a un artículo y articulos pide otro',
        clase: 'contrato',
      })
    }
    if (t.name === 'obtener_documento') {
      casos.push({
        tool: t.name,
        args: { fuente: 'gestor', id: '31431', ruta: '2021/SU-371-21.htm' },
        motivo: 'id de gestor junto con ruta de corte',
        clase: 'contrato',
      })
    }
  }
  return casos
}

/** Un juego de argumentos que, quitando el parámetro que se rompe, sería válido. */
function baseValida(props: Record<string, { enum?: unknown[] }>, req: string[]): Record<string, unknown> {
  const ejemplo: Record<string, unknown> = {
    texto: 'teletrabajo',
    termino: 'prima de servicios',
    cita: 'Ley 909 de 2004',
    catalogo: 'tipos',
    nivel: 'ley',
    perfil: 'laboral',
    accion: 'crear',
    fuente: 'gestor',
    entidad: 'sic',
    norma_a: 'Ley 909 de 2004',
    norma_b: 'Ley 909 de 2004',
    articulo_a: '6',
    articulo_b: '6',
    desde: '2024-01-01',
    normas: ['Ley 909 de 2004'],
    temsubid: 'ts-24928',
    normid: '31431',
    sala: 'Laboral',
    id: '31431',
    articulo: '6',
  }
  const base: Record<string, unknown> = {}
  for (const clave of req) {
    if (clave in ejemplo) base[clave] = ejemplo[clave]
    else if (props[clave]?.enum?.length) base[clave] = props[clave]!.enum![0]
  }
  // El parámetro que se rompe suele ser opcional: se quita del relleno para que
  // el único problema del caso sea el que declara su `motivo`.
  return base
}

/** Cómo se comporta un mensaje de corrección de argumentos. */
const CORRIGE =
  /no es v[aá]lido|inv[aá]lid|debe ser|deben ser|valores? (?:v[aá]lidos|posibles|disponibles)|disponibles:|usa |prueba|ej\.|ejemplo|hace falta|requiere|exige|solo (?:acepta|contiene)|no reconozco|no existe (?:un|una)|no hay un|no encontr[eé] un/i

/** Un fallo de infraestructura no es una negativa: son estados distintos. */
const FALLO_DE_FUENTE =
  /no respondi[oó]|no responde|degradad|tiempo de espera|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket|red ca[ií]da|no se pudo conectar|error de conexi[oó]n/i

export type Respuesta = { texto: string; esError: boolean }

/**
 * Aserción única de la familia 1, partida por clase.
 * Devuelve la lista de problemas; vacía significa que pasó.
 */
export function problemasFamilia1(r: Respuesta, c: CasoCalle): string[] {
  const p: string[] = []
  const t = r.texto.trim()
  if (!t) return ['respuesta vacía: ni texto ni error']

  if (c.clase === 'contrato') {
    // Un vacío genérico no sirve: tiene que decir qué se equivocó o qué sí vale.
    const esVacioGenerico = /^No encontré .* en las fuentes consultadas\./i.test(t)
    if (!r.esError && esVacioGenerico) {
      p.push('vacío silencioso: argumentos inválidos devolvieron "no encontré" en vez de un error')
    }
    if (!r.esError && !CORRIGE.test(t)) {
      p.push('no es error y el texto no nombra el valor correcto ni un ejemplo que funcione')
    }
    if (esVacioGenerico && !CORRIGE.test(t)) p.push('vacío sin corrección')
  } else {
    if (FALLO_DE_FUENTE.test(t)) {
      p.push('un identificador inexistente produjo un fallo de fuente: no se distingue "no existe" de "la fuente falló"')
    }
    // Formas en que una respuesta rechaza explícitamente. `sobra` entra porque
    // «sobra numero (es de conceptos_fp)» es un rechazo tan explícito como «no
    // existe» —y más útil: nombra el parámetro y el catálogo al que pertenece—,
    // y el vocabulario de identificadores inexistentes no lo reconocía.
    const niega =
      /no existe|no encontr[eé]|no hay|no aparece|sin resultados|no se pudo (?:verificar|resolver)|sobra\b/i.test(t)
    if (!niega && !r.esError) p.push('identificador inexistente que no produjo ni negativa explícita ni error')
  }
  return p
}

// --- familia 2: qué se puede concluir de una respuesta correcta -----------

/** Contexto que necesita una regla para juzgar; cada regla declara el suyo. */
export type Ctx = {
  /** Identificador pedido, para la regla de identidad. */
  pedido?: string
  /** Nombre de la fuente, para la regla de alcance. */
  fuente?: string
  /** Texto con erratas conocidas, para la regla 7. */
  erratas?: string[]
  /** La respuesta lleva texto copiado de un portal, para la regla 8. */
  externo?: boolean
  /** Respuesta anterior de una llamada idéntica, para la regla 9. */
  anterior?: string
}

export type Regla = {
  id: number
  nombre: string
  /** `null` si pasa o no aplica; el problema descrito si falla. */
  comprobar: (texto: string, ctx?: Ctx) => string | null
}

/** Matices que desactivan el colapso de «vigente». */
const MATIZ = /no\b|sin\b|consta|equivale|advierte|nunca|duda|no se|no lo|no la|salvo|condicionad|inferid|confianza (?:media|baja)|precauci/i

export const REGLAS: Regla[] = [
  {
    id: 1,
    nombre: 'no colapso',
    comprobar: (t) => {
      // Solo aplica si la propia respuesta declara que la vigencia no consta.
      if (!/no consta|no se puede (?:afirmar|confirmar)|no equivale a|no afirma vigencia|no publica vigencia/i.test(t)) {
        return null
      }
      for (const m of t.matchAll(/vigente/gi)) {
        const i = m.index ?? 0
        const frase = t.slice(Math.max(0, t.lastIndexOf('.', i) + 1), t.indexOf('.', i + 6) + 1 || undefined)
        const ventana = frase.length > 4 ? frase : t.slice(Math.max(0, i - 80), i + 80)
        if (!MATIZ.test(ventana)) {
          return `"vigente" sin su matiz en la misma frase: «${ventana.trim().slice(0, 120)}»`
        }
      }
      return null
    },
  },
  {
    id: 2,
    nombre: 'procedencia pegada',
    comprobar: (t) => {
      // El origen vale en cualquiera de las formas que el servidor usa: la URL
      // desnuda de la relatoría (`https://…`), el `URL:` del Gestor, el rótulo
      // de tramo entre corchetes y la identificación de la norma.
      const rotulo = /https?:\/\/|URL:|Fuente:|Providencia |\[(?:encabezado|antecedentes|consideraciones|decisi[oó]n|salvamentos?|aclaraciones?|notas?)\]|Decreto \d|Ley \d|Resoluci[oó]n \d/i
      const citable = /(ART[IÍ]CULO|CONSIDERACIONES|ANTECEDENTES|RESUELVE|ACLARACI[OÓ]N DE VOTO|SALVAMENTO DE VOTO)/i
      const huerfanos = bloques(t).filter((b) => b.length > 400 && citable.test(b) && !rotulo.test(b))
      return huerfanos.length
        ? `${huerfanos.length} bloque(s) de texto citable sin su origen en el mismo bloque (empieza: «${huerfanos[0]!.slice(0, 80)}…»)`
        : null
    },
  },
  {
    id: 3,
    nombre: 'truncamiento por delante',
    comprobar: (t) => {
      const m = /quedan \d+ sin mostrar|omitid|se muestran \d+ desde|los demás no caben|truncad/i.exec(t)
      if (!m) return null
      const i = m.index
      const permitido = t.length / 5
      return i <= permitido
        ? null
        : `la marca de omisión cae en el carácter ${i} de ${t.length} (${((i / t.length) * 100).toFixed(0)} %), fuera del primer quinto`
    },
  },
  {
    id: 4,
    nombre: 'identidad',
    comprobar: (t, ctx) => {
      if (!ctx?.pedido) return null
      return normal(t).includes(normal(ctx.pedido))
        ? null
        : `la respuesta no nombra lo pedido ("${ctx.pedido}")`
    },
  },
  {
    id: 5,
    nombre: 'alcance declarado',
    comprobar: (t, ctx) => {
      if (!ctx?.fuente) return null
      const dice = new RegExp(ctx.fuente, 'i').test(t)
      /**
       * Se buscan formas del tipo «no consulté», «sin consultar», «no incluye»…
       * OJO: NO vale un `no es` a secas. El pie «esto no es asesoría jurídica»
       * está en casi todas las respuestas y hacía pasar la regla sin que la
       * respuesta dijera nada de su alcance.
       */
      const acota =
        /no (?:consulta|consult[eé]|incluye|cubre|est[aá]n)|sin consultar|no consultad|quedan fuera|fuera de (?:esta|estas)|no se consult/i.test(
          t,
        )
      if (!dice) return `no dice qué fuente consultó ("${ctx.fuente}")`
      return acota ? null : 'dice la fuente pero no declara qué deja fuera'
    },
  },
  {
    id: 6,
    nombre: 'relevancia junto al resultado',
    comprobar: (t) => {
      const marca = /no menciona el t[eé]rmino|no contiene el t[eé]rmino|aparece de pasada|menciona el t[eé]rmino de pasada/i
      let pegadas = 0
      let despegada: string | null = null
      for (const m of t.matchAll(new RegExp(marca, 'gi'))) {
        const i = m.index ?? 0
        const inicio = t.lastIndexOf('\n\n', i)
        const bloque = t.slice(inicio === -1 ? 0 : inicio, t.indexOf('\n\n', i) === -1 ? t.length : t.indexOf('\n\n', i))
        // Pegada al resultado = en un bloque que también trae una entrada (URL o viñeta).
        if (/https?:\/\/|^-\s|\n-\s/.test(bloque)) pegadas++
        else despegada ??= bloque.trim().slice(0, 100)
      }
      // Basta con que UNA marca vaya pegada a su resultado: entonces el dato está
      // donde se lee, y repetirlo al final es refuerzo, no despego. Solo falla si
      // TODAS quedaron lejos. La regla se disparaba también con la prosa que
      // explica por qué el buscador devuelve resultados flojos («…aparece de
      // pasada»), que no califica ningún resultado en concreto.
      if (pegadas > 0 || !despegada) return null
      return `la marca de relevancia va despegada del resultado que califica: «${despegada}»`
    },
  },
  {
    id: 7,
    nombre: 'erratas declaradas',
    comprobar: (t, ctx) => {
      const presentes = (ctx?.erratas ?? []).filter((e) => t.includes(e))
      if (!presentes.length) return null
      return /errata|lapsus|tal como (?:aparece|figura|se transcribe)|se transcribe literal|as[ií] (?:en|lo) (?:la |el )?(?:fuente|relator)|reproduce literal/i.test(t)
        ? null
        : `transcribe «${presentes[0]}» sin declarar que el texto fuente trae erratas`
    },
  },
  {
    id: 8,
    nombre: 'contenido externo delimitado',
    comprobar: (t, ctx) => {
      if (!ctx?.externo) return null
      const delimitado = /---\s*Texto\s*---|---|```|«|"[^"]{200,}"/.test(t)
      const declara = /(?:texto|contenido) (?:del portal|de la fuente|externo|copiado)|dato, no (?:instrucci[oó]n|orden)|se transcribe|no es una instrucci[oó]n/i.test(t)
      if (!delimitado) return 'el texto del portal no viene delimitado'
      return declara ? null : 'el texto del portal no se declara como dato y no como instrucción'
    },
  },
  {
    id: 9,
    nombre: 'determinismo',
    comprobar: (t, ctx) => {
      if (ctx?.anterior === undefined) return null
      if (ctx.anterior === t) return null
      return FECHA_CONSULTA.test(t) && FECHA_CONSULTA.test(ctx.anterior)
        ? null
        : 'dos llamadas idénticas dan textos distintos y ninguno viene fechado'
    },
  },
]

/** Corre todas las reglas aplicables y devuelve las que fallan. */
export function reglasQueFalla(texto: string, ctx?: Ctx): { id: number; nombre: string; problema: string }[] {
  const fallos: { id: number; nombre: string; problema: string }[] = []
  for (const r of REGLAS) {
    const p = r.comprobar(texto, ctx)
    if (p) fallos.push({ id: r.id, nombre: r.nombre, problema: p })
  }
  return fallos
}

// --- familia 3: el juez ---------------------------------------------------

export const JUEZ_BIN = process.env['JUEZ_BIN'] ?? 'cmdc'
/** Tope del texto que se le pasa al juez: por encima, el argumento de Windows se rompe. */
export const TOPE_JUEZ = 12_000

export type Veredicto = { respuesta: 'SI' | 'NO' | 'NOSESABE' | 'OTRO'; bruto: string; ms: number }

/** El prompt literal del encargo, con el texto del servidor pegado tal cual. */
export function promptDeJuez(pregunta: string, texto: string): string {
  return (
    'Basándote SOLO en el texto que sigue, responde una palabra: SI, NO o NOSESABE.\n' +
    `${pregunta}\n---\n${texto.slice(0, TOPE_JUEZ)}\n`
  )
}

/**
 * Pasa una respuesta real del servidor a un modelo barato con una pregunta
 * cerrada y devuelve qué concluyó.
 *
 * En Windows `cmdc` es un `.cmd` y `spawn` no lo ejecuta sin shell; además el
 * prompt no cabe con comillas seguras en la línea de órdenes. El prompt viaja
 * en un fichero temporal y la orden que lo lee es fija: así no hay nada que
 * escapar.
 */
export function juez(pregunta: string, texto: string): Veredicto {
  const dir = mkdtempSync(join(tmpdir(), 'juez-'))
  const fichero = join(dir, 'prompt.txt')
  const t0 = Date.now()
  try {
    writeFileSync(fichero, promptDeJuez(pregunta, texto), 'utf8')
    const r =
      process.platform === 'win32'
        ? spawnSync(
            'pwsh',
            [
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              `& ${JUEZ_BIN} -p (Get-Content -Raw -LiteralPath '${fichero}') --trust --skip-onboarding`,
            ],
            { encoding: 'utf8', timeout: 240_000, maxBuffer: 8 * 1024 * 1024 },
          )
        : spawnSync(JUEZ_BIN, ['-p', promptDeJuez(pregunta, texto), '--trust', '--skip-onboarding'], {
            encoding: 'utf8',
            timeout: 240_000,
            maxBuffer: 8 * 1024 * 1024,
          })
    // El binario colorea la salida; el veredicto se busca sobre texto plano.
    // El escape va construido y no literal para no meter un carácter de control
    // en el fuente (que es lo que el linter marca, con razón).
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
    const bruto = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(ansi, '')
    const palabra = /\b(NOSESABE|SI|NO)\b/i.exec(bruto.replace(/^[\s\S]*?\n(?=\S)/m, ''))
    const v = (palabra?.[1] ?? '').toUpperCase()
    return {
      respuesta: v === 'SI' ? 'SI' : v === 'NO' ? 'NO' : v === 'NOSESABE' ? 'NOSESABE' : 'OTRO',
      bruto: bruto.trim(),
      ms: Date.now() - t0,
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
