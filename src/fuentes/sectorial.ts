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
  /** Categoría o tipo de acto (cada adaptador declara cuáles soporta). */
  categoria?: string | undefined
  pagina?: number | undefined
  limite?: number | undefined
  /** Normogramas: limita a los tipos de documento propios de la entidad (INVIMA/Supersalud). */
  solo_entidad?: boolean | undefined
}

export type Adaptador = {
  /** Identificador estable; es el valor que viaja en el parámetro `entidad`. */
  id: string
  nombre: string
  /** Sector económico al que sirve, en las palabras que usaría quien pregunta. */
  sector: string
  portal: string
  /** URL base https del portal que publica los actos; el dominio al que apuntan sus enlaces. */
  dominioPermitido: string
  /** Tipos de acto que publica esta fuente, como los nombra su propio portal. */
  tiposDocumento: string[]
  /** true si el texto del acto se puede leer aquí; las que publican PDF valen false. */
  soportaTexto: boolean
  /** true si el portal publica una señal de vigencia comprobable. */
  soportaVigencia: boolean
  /** Nombre del test de test/smoke.ts que cubre esta fuente. */
  pruebasMinimas: string
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

/** El contrato se exige en runtime, no solo en tipos: un alta sin metadatos no puede entrar. */
function validar(a: Adaptador): void {
  let dominio: URL
  try {
    dominio = new URL(a.dominioPermitido)
  } catch {
    throw new Error(`El adaptador "${a.id}" declara un dominioPermitido inválido: "${a.dominioPermitido}".`)
  }
  if (dominio.protocol !== 'https:') {
    throw new Error(`El adaptador "${a.id}" declara un dominioPermitido que no es https: "${a.dominioPermitido}".`)
  }
  if (!a.tiposDocumento.length) {
    throw new Error(`El adaptador "${a.id}" no declara ningún tipoDocumento.`)
  }
  if (typeof a.soportaTexto !== 'boolean' || typeof a.soportaVigencia !== 'boolean') {
    throw new Error(`El adaptador "${a.id}" debe declarar soportaTexto y soportaVigencia.`)
  }
  if (!a.pruebasMinimas.trim()) {
    throw new Error(`El adaptador "${a.id}" no declara su prueba mínima (pruebasMinimas).`)
  }
}

export function registrar(...adaptadores: Adaptador[]): void {
  for (const a of adaptadores) {
    validar(a) // antes de insertar: un alta fallida no contamina el mapa
    REGISTRO.set(a.id, a)
  }
}

export const adaptadores = (): Adaptador[] => [...REGISTRO.values()]

export const adaptador = (id: string): Adaptador | undefined => REGISTRO.get(id)

export const ids = (): string[] => [...REGISTRO.keys()]
