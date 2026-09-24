/**
 * Cache en memoria: valores genéricos con TTL y copias de documento con
 * revalidación condicional. Comparten mapa y purga perezosa, pero son dos cosas
 * distintas: `conCache` guarda un cálculo cualquiera durante un TTL, y una copia
 * guarda el cuerpo de una URL con sus validadoras HTTP para que la capa de
 * transporte la revalide y, si la fuente calla, la sirva fechada y rotulada.
 *
 * El TTL no es único porque las normas no envejecen igual: la Constitución casi
 * no cambia, una ley de 1993 poco y una de este año puede cambiar mañana.
 *
 * Medido contra los portales el 2026-09-24, con la capa de transporte del
 * servidor, documento por documento:
 *
 * | Portal (documento cacheable) | ETag | Last-Modified | If-Modified-Since | If-None-Match |
 * |---|---|---|---|---|
 * | Gestor Normativo (`norma.php?i=`) | no | no | — | — |
 * | Corte Constitucional (`/relatoria/*.htm`) | sí, IIS | sí | 304 en 7/7 | 304 en 6/7 |
 * | DIAN (`/compilacion/docs/*.htm`) | sí, IIS | sí | 304 en 7/7 | 304 en 6/7 |
 * | CREG (`/gestor/entorno/docs/*.htm`) | sí, IIS | sí | 304 en 7/7 | 304 en 6/7 |
 * | Supersalud (`/compilacion/docs/*.htm`) | sí, IIS | sí | 304 en 7/7 | 304 en 0/7 |
 * | INVIMA (`/compilacion/docs/*.htm`) | sí, IIS | sí | 304 en 1/1 | 304 en 0/1 |
 *
 * El ETag de IIS no es estable: cambia según qué servidor de la granja conteste
 * (en la Corte, `"62318d036a9cc1:0"` y `"80aa1d036a9cc1:0"` para el mismo
 * archivo), así que un `If-None-Match` con el ETag de otro nodo devuelve el
 * documento entero. `Last-Modified` es la fecha del archivo y fue idéntico en
 * todas las respuestas. En el Gestor, que no publica ninguno de los dos, el TTL
 * es lo único que acota la antigüedad de la copia.
 */

type Entrada = { valor: unknown; vence: number }

const entradas = new Map<string, Entrada>()

/**
 * Valor fresco para `clave`, o null si no está o expiró (barrido perezoso:
 * la entrada vencida se borra al tocarla y la próxima llamada la recalcula).
 */
export function obtener(clave: string): unknown | null {
  const e = entradas.get(clave)
  if (!e) return null
  if (Date.now() > e.vence) {
    entradas.delete(clave)
    return null
  }
  return e.valor
}

/** Guarda `valor` bajo `clave` hasta `ttlMs` milisegundos desde ahora. */
export function poner(clave: string, valor: unknown, ttlMs: number): void {
  entradas.set(clave, { valor, vence: Date.now() + ttlMs })
}

/**
 * Devuelve el valor cacheado si está fresco; si no, ejecuta `fn`, lo cachea
 * con `ttlMs` y lo devuelve. `fn` es async para servir a los módulos de
 * fuentes, que consultan la red.
 */
export async function conCache<T>(clave: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const fresco = obtener(clave)
  if (fresco !== null) return fresco as T
  const valor = await fn()
  poner(clave, valor, ttlMs)
  return valor
}

// --- TTL por clase de norma ----------------------------------------------

const HORA_MS = 3600 * 1000
const DIA_MS = 24 * HORA_MS

export type ClaseNorma = 'constitucion' | 'antigua' | 'media' | 'reciente' | 'actual' | 'desconocida'

/**
 * Minúsculas sin tildes. No se importa `sinTildes` de `parse.ts` a propósito:
 * este módulo lo carga la capa de transporte y `parse.ts` arrastra cheerio.
 */
const plano = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Clase según tipo y año; `desconocida` cuando el año no es utilizable. */
export function claseDeNorma(tipo: string, anio: number | string | undefined, ahora = Date.now()): ClaseNorma {
  if (/constitucion/.test(plano(tipo ?? ''))) return 'constitucion'
  const a = Number(String(anio ?? '').replace(/\D/g, '').slice(0, 4))
  if (!a || a < 1900 || a > 2200) return 'desconocida'
  const actual = new Date(ahora).getUTCFullYear()
  if (a === actual) return 'actual'
  if (a === actual - 1) return 'reciente'
  if (a >= actual - 4) return 'media'
  return 'antigua'
}

/**
 * TTL en ms por clase. No mide "cuánto tarda en cambiar" —eso no se puede
 * medir— sino cuánto se tolera servir la copia sin volver a preguntar.
 */
export function ttlDeNorma(tipo: string, anio: number | string | undefined, ahora = Date.now()): number {
  switch (claseDeNorma(tipo, anio, ahora)) {
    case 'constitucion':
      return 30 * DIA_MS
    case 'antigua':
      return 7 * DIA_MS
    case 'media':
      return 48 * HORA_MS
    case 'reciente':
      return 12 * HORA_MS
    case 'actual':
      return HORA_MS
    case 'desconocida':
      return 6 * HORA_MS
  }
}

export type Identidad = { tipo: string; anio: string }

/**
 * Tipo y año, del nombre del archivo si los lleva (`decreto_1235_2023.htm`) y,
 * si no, del encabezado del propio texto (`LEY 1437 DE 2011`). Se lee sobre una
 * muestra porque el cuerpo entero de una norma son cientos de miles de
 * caracteres y la identidad está en las primeras líneas.
 */
export function identidadDeNorma(url: string, muestra = ''): Identidad {
  const nombre = plano(url.split(/[?#]/)[0]!.split('/').pop() ?? '')
  const enUrl = /(ley|decreto|resolucion|acuerdo|circular)[-_]?(\d{1,6})[-_]((?:19|20)\d{2})/.exec(nombre)
  if (enUrl) return { tipo: enUrl[1]!, anio: enUrl[3]! }

  // El título manda sobre el cuerpo: el cuerpo de una norma CITA otras, y la
  // primera que nombra suele ser anterior y ajena (en `norma.php?i=31431`, que
  // es la Ley 1221 de 2008, la primera mención era otra ley).
  const titulo = /titulo-norma[^>]*>\s*([^<]{3,200})/i.exec(muestra)?.[1] ?? ''
  for (const texto of [titulo, muestra]) {
    if (!texto) continue
    const t = plano(texto)
    if (/constitucion politica/.test(t)) return { tipo: 'constitucion', anio: '' }
    const m = /(ley|decreto|resolucion|acuerdo|circular|acto legislativo)\s+(\d{1,6})\s+de\s+((?:19|20)\d{2})/.exec(t)
    if (m) return { tipo: m[1]!, anio: m[3]! }
  }
  return { tipo: '', anio: '' }
}

/**
 * Buscadores y APIs de todas las fuentes: congelar una búsqueda escondería lo
 * que se publique después, así que nunca se cachean.
 */
const NO_ES_DOCUMENTO =
  /funajax|buscar|buscador|consulta|\bapi[-_/.]|\.ashx|search|\bq=|&texto=|\btermino=|\bpalabras=|\bdesde=|&page=|inforestrictor/i

/**
 * Documentos: `norma.php?i=`, los `.htm` de `/compilacion/docs/` y los de
 * `/relatoria/`. Para la misma URL responden siempre el mismo texto.
 */
const ES_DOCUMENTO = /\.(?:html?|txt)$/i

/**
 * ¿Se puede guardar esta respuesta como copia reutilizable? Solo las descargas
 * de documento, nunca una búsqueda ni una API, y solo texto (los PDF van por
 * `pedirBytes` y no pasan por aquí).
 */
export function esDescargaCacheable(url: string, metodo: string, contentType: string): boolean {
  if (metodo !== 'GET') return false
  if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) return false
  if (NO_ES_DOCUMENTO.test(url)) return false
  const ruta = url.split(/[?#]/)[0]!
  return ES_DOCUMENTO.test(ruta) || /norma\.php\?i=\d+/i.test(url) || /\/compilacion\/docs\//i.test(url)
}

// --- copias de documento -------------------------------------------------

export type Copia = {
  cuerpo: string
  status: number
  cabeceras: Record<string, string>
  /** Epoch ms en que se recibió de la fuente. */
  fecha: number
  /** Epoch ms hasta el que se sirve sin volver a preguntar. */
  vence: number
}

/**
 * Tope de copias vivas. Un servidor MCP dura horas y una norma del Gestor pasa
 * de 900 KB, así que sin tope esto crece sin límite; se descarta la más antigua.
 */
const MAX_COPIAS = 64

const copias = new Map<string, Copia>()

/** Copia guardada para `clave`, aunque esté vencida: la degradación la usa. */
export function obtenerCopia(clave: string): Copia | null {
  return copias.get(clave) ?? null
}

export function guardarCopia(clave: string, copia: Copia): void {
  copias.delete(clave) // reinsertar mantiene el orden de inserción como orden de uso
  copias.set(clave, copia)
  while (copias.size > MAX_COPIAS) {
    const masVieja = copias.keys().next().value
    if (masVieja === undefined) break
    copias.delete(masVieja)
  }
}

/** Marca la copia como vista hoy (tras un 304), sin tocar su cuerpo. */
export function refrescarCopia(clave: string, fecha: number, vence: number): Copia | null {
  const c = copias.get(clave)
  if (!c) return null
  c.fecha = fecha
  c.vence = vence
  return c
}

/**
 * Cabeceras condicionales de una copia: vacías si la fuente no dio validador.
 *
 * `If-Modified-Since` va PRIMERO aunque el ETag sea el validador más fuerte:
 * medido el 2026-09-24 (tabla de arriba), el ETag de IIS cambia con el nodo que
 * responde y el `If-None-Match` de la Supersalud no acertó ni una vez, mientras
 * `Last-Modified` dio 304 en todas. Y no se mandan los dos: con `If-None-Match`
 * presente, el servidor debe ignorar `If-Modified-Since` (RFC 9110 §13.1.3), y
 * volveríamos al ETag inestable. El ETag queda para quien no publique fecha.
 */
export function cabecerasCondicionales(copia: Copia): Record<string, string> {
  const ultima = copia.cabeceras['last-modified']
  if (ultima) return { 'If-Modified-Since': ultima }
  const etag = copia.cabeceras['etag']
  return etag ? { 'If-None-Match': etag } : {}
}

/** Solo para las pruebas: deja el almacén de copias vacío. */
export function limpiarCopias(): void {
  copias.clear()
}

/** Cuántas copias hay vivas (diagnóstico y pruebas del tope). */
export function copiasGuardadas(): number {
  return copias.size
}
