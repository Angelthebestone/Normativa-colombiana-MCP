/**
 * Con `CACHE_DIR` puesta, las copias se escriben además en ese directorio y se
 * releen cuando la memoria no las tiene: es lo que evita volver a bajar entera
 * una providencia al reiniciar el cliente. Medido el 2026-09-28 contra la
 * relatoría con la C-355/06 (3.398.037 caracteres, 3,4 MB de texto): primera
 * descarga 627 ms y 1 petición; segunda en un proceso nuevo, 22 ms, servida de
 * la copia y sin salir a la red (0 peticiones). Sin la variable no se toca el
 * sistema de ficheros.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Copia } from './tipos.ts'

/**
 * Con `CACHE_DIR` puesta, cada copia se escribe además como
 * `<sha256-de-la-URL>.json` en ese directorio y se relee cuando la memoria no
 * la tiene. Sin la variable no se toca el sistema de ficheros —ni una llamada a
 * `fs`—; con ella, cualquier fallo se traga en silencio, como en
 * `EXPEDIENTES_DIR` (`expediente.ts`): un disco lleno o un directorio ilegible
 * no pueden tumbar el servidor.
 *
 * El nombre del fichero sale del hash, nunca de la URL: nada de rutas armadas
 * con datos que vengan de la fuente.
 */
function directorio(): string | null {
  const dir = process.env['CACHE_DIR']
  return dir ? dir : null
}

const archivoDe = (clave: string): string => createHash('sha256').update(clave).digest('hex') + '.json'

/** ¿`x` tiene la forma de una `Copia`? Cualquier otra cosa es un fichero corrupto. */
function esCopia(x: unknown): x is Copia {
  if (!x || typeof x !== 'object') return false
  const c = x as Record<string, unknown>
  const cabeceras = c['cabeceras']
  return (
    typeof c['cuerpo'] === 'string' &&
    typeof c['status'] === 'number' &&
    Number.isFinite(c['fecha']) &&
    Number.isFinite(c['vence']) &&
    !!cabeceras &&
    typeof cabeceras === 'object' &&
    Object.values(cabeceras).every((v) => typeof v === 'string')
  )
}

/** Borra `ruta` sin lanzar; devuelve si lo consiguió. */
function olvidar(ruta: string): boolean {
  try {
    unlinkSync(ruta)
    return true
  } catch {
    return false
  }
}

/**
 * La copia que hay en disco para `clave`, o null. Un fichero ilegible, truncado
 * (cierre a mitad) o con otra forma se ignora y se borra, para que la próxima
 * descarga lo reemplace limpio.
 */
export function leerDeDisco(clave: string): Copia | null {
  const dir = directorio()
  if (!dir) return null
  const ruta = join(dir, archivoDe(clave))
  let crudo: string
  try {
    crudo = readFileSync(ruta, 'utf8')
  } catch {
    return null // no está (lo normal) o no se puede leer
  }
  let copia: Copia | null = null
  try {
    const x: unknown = JSON.parse(crudo)
    if (esCopia(x)) copia = x
  } catch {
    // JSON cortado a mitad o basura.
  }
  if (!copia) olvidar(ruta)
  return copia
}

/**
 * Tope del directorio: 500 ficheros y 256 MB. Una providencia grande ronda
 * 1,8 MB y una norma corriente 200 KB, así que 256 MB dan para un centenar de
 * las grandes y el recuento de 500 corta antes con las corrientes: el caché no
 * puede crecer sin límite en el disco de quien lo use.
 *
 * ponytail: el recuento se revisa en cada escritura —un `readdir`, 1 ms medido
 * el 2026-09-28 con 500 ficheros— y el tamaño cada 32, que exige un `stat` por
 * fichero (36 ms con 500): entre revisión y revisión caben a lo sumo 32 copias
 * de más. El salto siguiente, si el tope se quedara corto, es un índice en
 * memoria de tamaños y fechas.
 */
const MAX_FICHEROS_EN_DISCO = 500
const MAX_BYTES_EN_DISCO = 256 * 1024 * 1024

/** Escrituras desde el arranque; cada 32 se revisa además el tamaño. */
let escrituras = 0

/** Purga lo más antiguo por fecha de modificación hasta volver bajo el tope. */
function podar(): void {
  const dir = directorio()
  if (!dir) return
  escrituras++
  try {
    const nombres = readdirSync(dir)
    // Un `.tmp` solo queda de una escritura muerta a medias. Si otro proceso
    // estuviera escribiendo justo ahora perdería ese guardado —no la copia que
    // tiene en memoria—, mal menor frente a irlos acumulando para siempre.
    for (const n of nombres) if (n.endsWith('.tmp')) olvidar(join(dir, n))

    const ficheros = nombres.filter((n) => n.endsWith('.json'))
    if (ficheros.length <= MAX_FICHEROS_EN_DISCO && escrituras % 32 !== 0) return

    const conTamano = ficheros
      .map((n) => {
        const ruta = join(dir, n)
        const info = statSync(ruta)
        return { ruta, bytes: info.size, mtime: info.mtimeMs }
      })
      .sort((a, b) => a.mtime - b.mtime) // el más antiguo, primero

    let quedan = conTamano.length
    let bytes = conTamano.reduce((suma, f) => suma + f.bytes, 0)
    for (const f of conTamano) {
      if (quedan <= MAX_FICHEROS_EN_DISCO && bytes <= MAX_BYTES_EN_DISCO) break
      if (olvidar(f.ruta)) {
        quedan -= 1
        bytes -= f.bytes
      }
    }
  } catch {
    // Directorio inexistente o ilegible: no hay nada que podar.
  }
}

/** Escribe la copia en disco —temporal + rename, atómico— y poda si toca. */
export function escribirEnDisco(clave: string, copia: Copia): void {
  const dir = directorio()
  if (!dir) return
  const ruta = join(dir, archivoDe(clave))
  const temporal = `${ruta}.${process.pid}.tmp`
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(temporal, JSON.stringify(copia), 'utf8')
    // El rename es atómico en el mismo sistema de ficheros: un cierre a mitad
    // deja el temporal a medias, nunca el JSON bueno truncado.
    renameSync(temporal, ruta)
  } catch {
    olvidar(temporal) // el temporal a medias no se queda
  }
  podar()
}
