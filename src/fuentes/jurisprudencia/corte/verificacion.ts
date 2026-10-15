import { poner, obtener, TTL_BUSQUEDA_MS } from '../../../nucleo/cache.ts'
import { parsearCita } from '../../../nucleo/citas/index.ts'
import { buscar } from './busqueda.ts'
import type { Providencia } from './providencia.ts'

/**
 * Identidad de una providencia: sin separadores y en mayúsculas. La relatoría
 * guarda `SU.371/21` y quien cita escribe `SU-371/21`; sin quitar el guion, el
 * punto y la barra, las dos formas no casan nunca.
 */
const identidad = (s: string): string => s.replace(/[\s.\-/]/g, '').toUpperCase()

/**
 * Formas del término que la relatoría indexa de manera distinta; el porqué está
 * medido y documentado en `verificar`. La literal primero —es la que resuelve
 * las C y las T—, la que va sin guiones si aquella no rindió, y la «C-331 de 2023»
 * al final: hay providencias que solo esa forma encuentra (medido el 2026-09-28:
 * C-331/23 daba «no existe» con las otras dos y 20 aciertos con esta, y el
 * «no existe» era falso).
 */
function formasDeSondeo(sentencia: string): string[] {
  const literal = sentencia.trim()
  const sinGuion = literal.replace(/-/g, '')
  const c = parsearCita(literal)
  const deAnio = c?.sentencia && c.anio ? `${c.sentencia.split('/')[0]} de ${c.anio}` : ''
  return [...new Set([literal, sinGuion, deAnio].filter(Boolean))]
}

/**
 * La ventana de fechas del sondeo: el año de la cita, no el buscador entero.
 *
 * Son 30 años de relatoría (1992→2100) y el buscador es de TEXTO COMPLETO: sin
 * acotar, el número de la sentencia se busca en el texto de todas las demás, y
 * la providencia buscada no sale. Medido el 2026-10-15, con la ventana completa
 * y `maxprov` 20: «T-406/92» 51 aciertos, «T-760/08» 254, «T-025/04» 314, y en
 * ninguno está la providencia —que sí está en el sitio, su ruta responde 200—
 * así que el sondeo concluía «no-existe» sobre sentencias reales. Con la ventana
 * del año exacto los mismos términos dan 1, 4 y 3 aciertos y la providencia está
 * entre ellos. Se probaron 16 sentencias y autos de 1992 a 2026: 16 aciertan con
 * la ventana corta, 12 fallan sin ella. El peor caso de ruido baja a 12, cómodo
 * bajo el tope de 20.
 */
function ventanaDe(anio: string | undefined): { desde?: string; hasta?: string } {
  return anio ? { desde: `${anio}-01-01`, hasta: `${Number(anio) + 1}-01-01` } : {}
}

/**
 * Veredictos firmes de `verificar`, guardados un rato. Una búsqueda no se revalida
 * como una copia de documento, y sin esto volver a preguntar por la misma sentencia
 * paga otra vez todos los sondeos: medido el 2026-09-29, C-337/11 costaba +2
 * peticiones la segunda vez y una sentencia inexistente +5, sin ninguna copia. El
 * flujo normal (resolver_cita, luego consultar_vigencia, luego linea_jurisprudencial)
 * la pregunta tres veces seguidas. Nunca se guarda `no-medido`: un fallo de red no
 * es un dato. El TTL (y su techo) está en `TTL_BUSQUEDA_MS`.
 */
const recordar = (clave: string, v: VerificacionSentencia): VerificacionSentencia => {
  poner(clave, v, TTL_BUSQUEDA_MS)
  return v
}

export type VerificacionSentencia = {
  estado: 'existe' | 'no-existe' | 'no-medido'
  providencia?: Providencia
  /** Los términos con los que se sondeó, en orden; sirve para que la respuesta declare qué se probó. */
  sondeos: string[]
  /** Por qué no se pudo medir; obligatorio cuando `estado` es `no-medido`. */
  motivo?: string
}

/**
 * ¿Aparece esta sentencia al buscarla por su número en la relatoría?
 *
 * `no-existe` NO significa "esa providencia no existe en el mundo": puede no
 * estar indexada, estar transcrita de otra forma o publicada con otro número.
 * Significa solo que NINGUNA de las formas sondeadas trajo una coincidencia
 * exacta por identidad, así que la capa de arriba no debe afirmar más que eso.
 * `no-medido` es distinto: la fuente falló (excepción de red) y `sondeos` solo
 * lista el término que se alcanzó a enviar, sin conclusión que leer.
 *
 * Se sondea con más de una forma del término porque la relatoría las indexa
 * distinto (medido el 2026-09-16 con `buscar({termino, limite:20})`):
 *
 * | cita      | término con guion                       | término sin guion              |
 * |-----------|-----------------------------------------|--------------------------------|
 * | SU-371/21 | 3 aciertos AJENOS (A. 371/21, C-1047…)  | acierto EXACTO (2021/SU371-21) |
 * | T-099/24  | acierto EXACTO                          | 0 resultados                   |
 * | C-337/11  | acierto EXACTO                          | 0 resultados                   |
 * | T-015/22  | acierto EXACTO                          | 0 resultados                   |
 *
 * Es decir: las C y las T casan con el guion; las SU solo sin él. Ninguna forma
 * sola basta, y por eso se prueban las dos en orden, gastando la segunda llamada
 * únicamente cuando la primera no dio el acierto.
 */
export async function verificar(
  sentencia: string,
  deps: { buscar?: typeof buscar } = {},
): Promise<VerificacionSentencia> {
  const sondeos: string[] = []
  const objetivo = identidad(sentencia)
  const clave = `corte:verificar:${objetivo}`
  const guardado = obtener(clave) as VerificacionSentencia | null
  if (guardado) return guardado
  const ventana = ventanaDe(parsearCita(sentencia)?.anio)
  try {
    for (const forma of formasDeSondeo(sentencia)) {
      sondeos.push(forma)
      const { items } = await (deps.buscar ?? buscar)({ termino: forma, limite: 20, ...ventana })
      const p = items.find((x) => identidad(x.sentencia) === objetivo)
      if (p) return recordar(clave, { estado: 'existe', providencia: p, sondeos })
    }
    return recordar(clave, { estado: 'no-existe', sondeos })
  } catch (e) {
    // Fallo de fuente, no negativa: se declara para que nadie lo lea como "no existe".
    return { estado: 'no-medido', sondeos, motivo: (e as Error).message }
  }
}

/**
 * Resuelve "C-337/11" a su providencia usando el buscador. Un fallo de fuente
 * sigue siendo error —solo `verificar` lo convierte en estado—, para no
 * confundirlo con "no está en la relatoría".
 */
export async function porSentencia(sentencia: string): Promise<Providencia | null> {
  const r = await verificar(sentencia)
  if (r.estado === 'no-medido') throw new Error(r.motivo)
  return r.providencia ?? null
}
