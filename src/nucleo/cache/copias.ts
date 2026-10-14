/**
 * Copias de documento con revalidación condicional: el cuerpo de una URL con sus
 * validadoras HTTP, para que la capa de transporte la revalide y, si la fuente
 * calla, la sirva fechada y rotulada.
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

import type { Disco } from './disco.ts'
import type { Copia } from './tipos.ts'

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

/**
 * Tope de copias vivas. Un servidor MCP dura horas y una norma del Gestor pasa
 * de 900 KB, así que sin tope esto crece sin límite; se descarta la más antigua.
 */
const MAX_COPIAS = 64

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

/** Copias en memoria de una instancia de caché, con su espejo en disco. */
export function crearCopias(disco: Disco) {
  const { escribirEnDisco, leerDeDisco } = disco
  const copias = new Map<string, Copia>()

  /** Mete la copia en el mapa; si pasa del tope, la más antigua sale. */
  function ponerEnMemoria(clave: string, copia: Copia): void {
    copias.delete(clave) // reinsertar mantiene el orden de inserción como orden de uso
    copias.set(clave, copia)
    while (copias.size > MAX_COPIAS) {
      const masVieja = copias.keys().next().value
      if (masVieja === undefined) break
      copias.delete(masVieja)
    }
  }

  /**
   * Copia guardada para `clave`, aunque esté vencida: la degradación la usa. El
   * mapa manda —el disco es solo para lo que la memoria perdió al reiniciar— y
   * lo que se lee de disco se sube al mapa.
   */
  function obtenerCopia(clave: string): Copia | null {
    const enMemoria = copias.get(clave)
    if (enMemoria) return enMemoria
    const deDisco = leerDeDisco(clave)
    if (deDisco) ponerEnMemoria(clave, deDisco)
    return deDisco
  }

  function guardarCopia(clave: string, copia: Copia): void {
    ponerEnMemoria(clave, copia)
    escribirEnDisco(clave, copia)
  }

  /** Marca la copia como vista hoy (tras un 304), sin tocar su cuerpo. */
  function refrescarCopia(clave: string, fecha: number, vence: number): Copia | null {
    const c = copias.get(clave)
    if (!c) return null
    c.fecha = fecha
    c.vence = vence
    escribirEnDisco(clave, c) // la fecha nueva también sobrevive al reinicio
    return c
  }

  /** Solo para las pruebas: vacía el mapa en memoria, sin tocar el disco (CACHE_DIR). */
  function limpiarCopias(): void {
    copias.clear()
  }

  /** Cuántas copias hay vivas (diagnóstico y pruebas del tope). */
  function copiasGuardadas(): number {
    return copias.size
  }

  return { obtenerCopia, guardarCopia, refrescarCopia, limpiarCopias, copiasGuardadas }
}

export type Copias = ReturnType<typeof crearCopias>
