/**
 * Reguladores sectoriales con forma común.
 *
 * CREG, ANH, UPME y ANLA tienen herramienta propia porque cada una devuelve algo
 * distinto: la CREG entrega articulado, ANLA entrega una clasificación temática.
 * Los reguladores que llegan aquí, en cambio, publican todos lo mismo —un acto
 * administrativo con tipo, número, fecha, epígrafe y un enlace— y por eso
 * comparten UNA herramienta con un selector de entidad.
 *
 * Eso no contradice la regla de «una herramienta por fuente»: lo que esa regla
 * evita son los parámetros condicionales, los que solo aplican según el valor de
 * otro. Aquí no hay ninguno. `entidad` elige a quién se le pregunta; el resto de
 * parámetros significan lo mismo para todas, y la que no soporte alguno lo dice
 * en su nota en vez de fingir que lo aplicó.
 *
 * Lo que NINGUNA de estas fuentes da, y hay que repetir en cada respuesta:
 * el texto del acto (casi todas publican PDF) y su vigencia.
 */

export type ActoSectorial = {
  tipo: string
  numero: string
  anio: string
  /** Como la publica el portal, sin normalizar: unos dan ISO y otros "30 de Julio de 2026". */
  fecha: string
  epigrafe: string
  url: string
}

export type ResultadoSectorial = {
  items: ActoSectorial[]
  /** Total declarado por el portal, si lo declara. */
  total?: number | undefined
  /** Lo que hubo que advertir de ESTA consulta: filtros ignorados, ruido apartado… */
  nota?: string | undefined
  /** La página consultada, para que la respuesta sea verificable. */
  url: string
}

export type OpcionesSectorial = {
  texto?: string | undefined
  anio?: string | undefined
  pagina?: number | undefined
  limite?: number | undefined
}

export type Adaptador = {
  /** Identificador estable; es el valor que viaja en el parámetro `entidad`. */
  id: string
  nombre: string
  /** Sector económico al que sirve, en las palabras que usaría quien pregunta. */
  sector: string
  portal: string
  /**
   * Qué NO cubre esta fuente o qué induce a error en ella. Se emite SIEMPRE, no
   * solo cuando hay resultados: es lo que evita que un vacío se lea como
   * inexistencia.
   */
  advertencia: string
  buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial>
}

/** Se rellena en `registrar()`; el orden de este mapa es el que ve quien consulta. */
const REGISTRO = new Map<string, Adaptador>()

export function registrar(...adaptadores: Adaptador[]): void {
  for (const a of adaptadores) REGISTRO.set(a.id, a)
}

export const adaptadores = (): Adaptador[] => [...REGISTRO.values()]

export const adaptador = (id: string): Adaptador | undefined => REGISTRO.get(id)

export const ids = (): string[] => [...REGISTRO.keys()]
