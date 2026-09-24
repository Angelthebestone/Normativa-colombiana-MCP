/**
 * Alcance declarado: qué fuente se consultó y cuál NO.
 *
 * Una búsqueda vacía en `buscar_jurisprudencia` no dice que la norma no exista:
 * dice que la Corte Constitucional no la tiene. Sin la lista de las fuentes que
 * no se tocaron, quien lee tiene que adivinar si el hueco es del corpus o de la
 * pregunta, y adivinar es lo que este servidor existe para evitar. Cuesta una
 * línea por respuesta y va DELANTE, para saber a qué se está entrando.
 */

/**
 * Fuentes que una herramienta puede llegar a consultar, por su clave interna.
 *
 * Los nombres son los completos, no abreviaturas: son los que usa
 * `describir_fuentes` y los que espera el arnés del proyecto al comprobar que la
 * respuesta declara su alcance. Abreviarlos («Gestor» por «Gestor Normativo»)
 * rompía esa comprobación sin que nada avisara.
 */
export const NOMBRE_FUENTE: Record<string, string> = {
  gestor: 'Gestor Normativo',
  corte: 'Corte Constitucional',
  suprema: 'Corte Suprema',
  consejo: 'Consejo de Estado',
  dian: 'DIAN',
  suin: 'SUIN-Juriscol',
  creg: 'CREG',
  anh: 'ANH',
  upme: 'UPME',
  anla: 'ANLA',
  sectorial: 'reguladores sectoriales',
}

/** Una fuente usada, con el detalle que la haga interpretable ("12 resultados"). */
export type Uso = { clave: string; detalle?: string }

/**
 * Línea de alcance. Lo que no aparezca en `consultadas` se declara como no
 * consultado, que es la mitad útil del dato: el vacío de una fuente no es el
 * vacío de las demás. Las fuentes que el operador apagó (FUENTES) van aparte:
 * «no la consulté» y «esta instalación no la tiene» se leen distinto.
 */
export function alcance(consultadas: (string | Uso)[], off: readonly string[] = apagadas()): string {
  const usadas = consultadas.map((c) => (typeof c === 'string' ? { clave: c } : c))
  const vistas = new Set(usadas.map((u) => u.clave))
  const si = usadas
    .map((u) => `${NOMBRE_FUENTE[u.clave] ?? u.clave}${u.detalle ? ` (${u.detalle})` : ''}`)
    .join(', ')
  const fuera = Object.entries(NOMBRE_FUENTE).filter(([clave]) => !vistas.has(clave))
  const no = fuera.filter(([clave]) => !off.includes(clave)).map(([, nombre]) => nombre)
  const desactivadas = fuera.filter(([clave]) => off.includes(clave)).map(([, nombre]) => nombre)

  return (
    (usadas.length ? `Alcance: consulté ${si}.` : 'Alcance: sin consultar ninguna fuente.') +
    (no.length ? ` NO consulté ${no.join(', ')}.` : '') +
    (desactivadas.length ? ` Desactivadas en esta instalación, no consultadas: ${desactivadas.join(', ')}.` : '')
  )
}

// --- qué fuentes están encendidas ------------------------------------------

/**
 * Qué fuentes consulta esta instalación: lo elige el operador al instalar, con
 * la variable de entorno FUENTES (en la extensión .mcpb, el campo «Fuentes»).
 *
 * Por qué existe: cada herramienta que aparece en `tools/list` se paga en cada
 * sesión, se use o no. Las seis sectoriales son 9.161 B de 36.647 B —un 25 %—
 * (medido el 2026-09-16), y quien solo trabaja con leyes y sentencias no
 * necesita la CREG. Consolidarlas en una herramienta se descartó: lo que hace
 * que el modelo elija bien es la descripción de cada una. Apagar la fuente
 * recupera el ahorro sin tocar la semántica de las que quedan.
 *
 * Es el patrón de EXPEDIENTES=1 generalizado, con una diferencia a propósito:
 * el expediente apagado sigue en `tools/list` y avisa al llamarlo; una fuente
 * apagada DESAPARECE, y su valor sale de los enums de las herramientas que
 * cubren varias fuentes (`obtener_documento.fuente`, `buscar_unificado.fuentes`).
 * Así la llamada a una fuente apagada no se puede ni escribir.
 *
 * El Gestor Normativo no se puede apagar: es el corpus que resuelven
 * `resolver_cita` y las diez herramientas V2. Apagarlo no ahorraría una
 * herramienta, dejaría media docena rotas.
 */

/** Fuentes que el operador puede apagar: todas menos el Gestor. */
export const APAGABLES = Object.keys(NOMBRE_FUENTE).filter((k) => k !== 'gestor')

/**
 * La herramienta que existe SOLO para una fuente. Las que cubren varias
 * (`resolver_cita`, `obtener_documento`, `buscar_unificado`, `consultar_vigencia`…)
 * no están: se quedan y dejan de consultar la apagada, diciéndolo.
 */
const HERRAMIENTA_DE: Record<string, string> = {
  buscar_jurisprudencia: 'corte',
  buscar_jurisprudencia_suprema: 'suprema',
  buscar_jurisprudencia_consejo_estado: 'consejo',
  buscar_normativa_tributaria: 'dian',
  buscar_en_suin: 'suin',
  buscar_resoluciones_creg: 'creg',
  buscar_normativa_anh: 'anh',
  buscar_normativa_upme: 'upme',
  listar_normativa_ambiental_anla: 'anla',
  buscar_normativa_sectorial: 'sectorial',
}

/**
 * Lee FUENTES. Dos formas, sin mezclar: la lista de las que se quieren
 * (`corte,suin`: el Gestor va siempre) o la de las que se quitan
 * (`-creg,-anh,-upme`). Vacía o ausente: todas.
 *
 * Una clave desconocida ROMPE el arranque en vez de ignorarse: un `FUENTES=cort`
 * ignorado dejaría la instalación sin la Corte Constitucional y sin que nadie
 * lo supiera, que es el vacío mudo que este servidor existe para evitar.
 */
export function leerFuentes(valor = process.env['FUENTES'] ?? ''): Set<string> {
  const fichas = valor
    .split(/[\s,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  if (!fichas.length) return new Set(Object.keys(NOMBRE_FUENTE))

  const negativas = fichas.filter((t) => t.startsWith('-'))
  if (negativas.length && negativas.length !== fichas.length) {
    throw new Error(
      `FUENTES="${valor}" mezcla fuentes que se quieren con fuentes que se quitan (-clave). Usa una forma: ` +
        `"corte,suin" (solo esas, más el Gestor) o "-creg,-anh" (todas menos esas).`,
    )
  }
  const claves = fichas.map((t) => t.replace(/^-/, ''))
  const malas = claves.filter((c) => !APAGABLES.includes(c))
  if (malas.length) {
    const gestor = malas.includes('gestor') ? ' El Gestor Normativo no se puede apagar: es el corpus principal.' : ''
    throw new Error(
      `FUENTES="${valor}": ${malas.map((m) => `"${m}"`).join(', ')} no es una fuente que se pueda elegir.${gestor} ` +
        `Las claves son: ${APAGABLES.join(', ')}.`,
    )
  }
  const activas = negativas.length ? APAGABLES.filter((k) => !claves.includes(k)) : claves
  return new Set(['gestor', ...activas])
}

/** true si la fuente está encendida en esta instalación. Se relee en cada llamada. */
export const activa = (clave: string): boolean => leerFuentes().has(clave)

/** Las fuentes apagadas, en el orden de NOMBRE_FUENTE. */
export const apagadas = (): string[] => {
  const on = leerFuentes()
  return APAGABLES.filter((k) => !on.has(k))
}

/** true si la herramienta debe publicarse: su fuente, si es de una sola, está encendida. */
export function herramientaActiva(nombre: string): boolean {
  const f = HERRAMIENTA_DE[nombre]
  return f === undefined || activa(f)
}

/** Deja en `valores` solo los que pertenecen a fuentes encendidas (`fuenteDe` los mapea). */
export function proyectar<T extends string>(valores: readonly T[], fuenteDe: (v: T) => string): [T, ...T[]] {
  const quedan = valores.filter((v) => activa(fuenteDe(v)))
  // El Gestor siempre queda, así que ningún enum que lo lleve se vacía; uno que
  // no lo lleve y se vacíe es un error de configuración que hay que ver.
  if (!quedan.length) throw new Error(`FUENTES deja vacío el enum [${valores.join(', ')}]`)
  return quedan as [T, ...T[]]
}

/** La frase que va en toda respuesta cuando alguna fuente está apagada. */
export function avisoApagada(clave: string): string {
  return `${NOMBRE_FUENTE[clave] ?? clave} está DESACTIVADA en esta instalación (variable FUENTES): no se consultó. No es un vacío ni un fallo de la fuente.`
}
