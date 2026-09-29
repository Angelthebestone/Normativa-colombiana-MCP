/**
 * Copias persistentes en disco con CACHE_DIR: relectura tras «reiniciar», copia
 * corrupta que se ignora y se borra, topes del directorio, nombre derivado del
 * hash de la URL y nada tocado sin la variable. Directorio temporal del sistema
 * —con espacios y tildes—, sin red.
 *
 *   node --test test/cache-disco.ts
 */
import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after, before } from 'node:test'

import * as cache from '../src/nucleo/cache.ts'

const dir = mkdtempSync(join(tmpdir(), 'caché con espacios-'))

before(() => {
  process.env['CACHE_DIR'] = dir
})
after(() => {
  delete process.env['CACHE_DIR']
  rmSync(dir, { recursive: true, force: true })
})

/** Ficheros de copia que hay en `d` ahora mismo. */
const ficheros = (d = dir): string[] => readdirSync(d).filter((n) => n.endsWith('.json'))

/** Ruta que le toca a `clave`: sha256 de la URL, para escribir o leer a mano. */
const rutaDe = (clave: string, d = dir): string => join(d, createHash('sha256').update(clave).digest('hex') + '.json')

/** Copia válida de juguete; las fechas se pueden fijar. */
const copia = (cuerpo: string, fechas: { fecha?: number; vence?: number } = {}): cache.Copia => ({
  cuerpo,
  status: 200,
  cabeceras: { 'last-modified': 'Wed, 01 Feb 2006 05:00:00 GMT' },
  fecha: fechas.fecha ?? 1_770_000_000_000,
  vence: fechas.vence ?? 1_780_000_000_000,
})

/** Deja mapa y directorio como recién arrancados, para que cada prueba aísle. */
function reiniciar(): void {
  cache.limpiarCopias()
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { force: true })
}

test('la copia escrita sobrevive al «reinicio» y vuelve con sus validadoras', () => {
  reiniciar()
  const url = 'https://www.corteconstitucional.gov.co/relatoria/2006/C-355-06.htm'
  cache.guardarCopia(url, copia('<html>providencia de 1,9 MB</html>'))
  assert.equal(ficheros().length, 1, 'con CACHE_DIR la copia también va a disco')

  cache.limpiarCopias() // reinicio del cliente: se pierde la memoria
  assert.ok(existsSync(rutaDe(url)), 'limpiarCopias no toca el disco')
  const releida = cache.obtenerCopia(url)
  assert.ok(releida)
  assert.equal(releida.cuerpo, '<html>providencia de 1,9 MB</html>')
  assert.equal(releida.status, 200)
  assert.equal(releida.fecha, 1_770_000_000_000)
  assert.equal(releida.vence, 1_780_000_000_000)
  // Lo que hace útil la copia releída: con ella se revalida contra la fuente.
  assert.deepEqual(cache.cabecerasCondicionales(releida), {
    'If-Modified-Since': 'Wed, 01 Feb 2006 05:00:00 GMT',
  })

  // Ya subida al mapa, otra lectura no depende del fichero.
  rmSync(rutaDe(url), { force: true })
  assert.equal(cache.obtenerCopia(url)?.cuerpo, '<html>providencia de 1,9 MB</html>')
})

test('la copia de memoria manda: el disco solo repone lo que falta', () => {
  reiniciar()
  const url = 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=31431'
  cache.guardarCopia(url, copia('memoria'))
  writeFileSync(rutaDe(url), JSON.stringify(copia('disco')), 'utf8') // otro proceso escribió por detrás

  assert.equal(cache.obtenerCopia(url)?.cuerpo, 'memoria')
  cache.limpiarCopias()
  assert.equal(cache.obtenerCopia(url)?.cuerpo, 'disco', 'sin memoria, lo que queda es el disco')
})

test('una copia corrupta se ignora y se borra, sin lanzar', () => {
  reiniciar()
  const url = 'https://www.corteconstitucional.gov.co/relatoria/2006/C-355-06.htm'
  cache.guardarCopia(url, copia('<html>buena</html>'))
  cache.limpiarCopias()

  const validos = JSON.stringify(copia('x'))
  for (const basura of ['{no es json', JSON.stringify({ cuerpo: 42 }), validos.slice(0, 30), '']) {
    writeFileSync(rutaDe(url), basura, 'utf8')
    assert.equal(cache.obtenerCopia(url), null, `debería ignorar «${basura.slice(0, 16)}»`)
    assert.equal(existsSync(rutaDe(url)), false, 'el fichero inservible se borra')
  }

  // Un buen JSON vuelve a leerse: el borrado no rompió nada.
  writeFileSync(rutaDe(url), validos, 'utf8')
  assert.equal(cache.obtenerCopia(url)?.cuerpo, 'x')

  // Una ruta ilegible (aquí, un directorio con el nombre del hash) tampoco lanza.
  reiniciar()
  mkdirSync(rutaDe(url), { recursive: true })
  assert.equal(cache.obtenerCopia(url), null)
  rmSync(rutaDe(url), { recursive: true, force: true })
})

test('el nombre del fichero sale del hash de la URL, nunca de la URL', () => {
  reiniciar()
  const url = 'https://www.corteconstitucional.gov.co/relatoria/2006/C-355-06.htm'
  cache.guardarCopia(url, copia('x'))
  const nombre = ficheros()[0]!
  assert.equal(nombre, createHash('sha256').update(url).digest('hex') + '.json')
  assert.doesNotMatch(nombre, /corteconstitucional|relatoria|C-355|htm/i)
})

test('el tope de ficheros borra los más antiguos por fecha de modificación', () => {
  reiniciar()
  const MAX = 500
  // 510 copias de antes, con fechas de modificación escalonadas: el reloj del
  // sistema no distingue 510 escrituras seguidas.
  for (let i = 0; i < MAX + 10; i++) {
    const ruta = join(dir, `${i}.json`)
    writeFileSync(ruta, JSON.stringify({ i }), 'utf8')
    const t = new Date(1_000_000 + i * 1000)
    utimesSync(ruta, t, t)
  }

  const nueva = 'https://x.gov.co/recien-llegada.htm'
  cache.guardarCopia(nueva, copia('nueva'))

  assert.equal(ficheros().length, MAX, 'el recuento vuelve justo al tope')
  for (let i = 0; i < 10; i++) {
    assert.equal(existsSync(join(dir, `${i}.json`)), false, `la copia ${i} era de las más antiguas`)
  }
  assert.ok(existsSync(join(dir, `${MAX + 9}.json`)), 'la más nueva de las de antes se queda')
  assert.ok(existsSync(rutaDe(nueva)), 'y la recién escrita, también')
})

test('el tope de bytes borra lo más antiguo aunque haya pocos ficheros', () => {
  reiniciar()
  // Tres ficheros de 100 MB lógicos, dispersos: no ocupan 300 MB reales.
  const grandes = [0, 1, 2].map((i) => {
    const ruta = join(dir, `grande-${i}.json`)
    const fd = openSync(ruta, 'w')
    ftruncateSync(fd, 100 * 1024 * 1024)
    closeSync(fd)
    const t = new Date(1_000_000 + i * 1000)
    utimesSync(ruta, t, t)
    return ruta
  })

  // El tamaño se revisa cada 32 escrituras (cuesta un stat por fichero): se
  // escribe esa racha para que le toque el turno.
  for (let i = 0; i < 32; i++) cache.guardarCopia(`https://x.gov.co/pequena-${i}.htm`, copia(`p${i}`))

  assert.equal(existsSync(grandes[0]!), false, 'la más antigua cayó al pasarse de 256 MB')
  assert.ok(existsSync(grandes[1]!), 'con dos grandes ya se está por debajo del tope')
  assert.ok(existsSync(grandes[2]!))
  const bytes = ficheros().reduce((suma, n) => suma + statSync(join(dir, n)).size, 0)
  assert.ok(bytes <= 256 * 1024 * 1024, `el directorio quedó en ${bytes} bytes`)
  reiniciar()
})

test('refrescarCopia persiste la fecha nueva del 304', () => {
  reiniciar()
  const url = 'https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1083_2015.htm'
  cache.guardarCopia(url, copia('<html>decreto viejo</html>', { fecha: 1, vence: 2 }))

  cache.limpiarCopias()
  assert.equal(cache.obtenerCopia(url)?.fecha, 1, 'vuelve del disco antes del 304')
  cache.refrescarCopia(url, 5_000, 9_000)

  cache.limpiarCopias() // otro reinicio
  const tras304 = cache.obtenerCopia(url)
  assert.equal(tras304?.fecha, 5_000)
  assert.equal(tras304?.vence, 9_000)
  assert.equal(tras304?.cuerpo, '<html>decreto viejo</html>', 'refrescar no toca el cuerpo')

  // Refrescar algo que no está en memoria no inventa nada en disco.
  const fantasma = 'https://x.gov.co/jamas-vista.htm'
  assert.equal(cache.refrescarCopia(fantasma, 1, 2), null)
  assert.equal(existsSync(rutaDe(fantasma)), false)
})

test('sin CACHE_DIR no se escribe nada y con ella sí: la guarda es la variable', () => {
  reiniciar()
  delete process.env['CACHE_DIR']
  const url = 'https://x.gov.co/sin-variable.htm'
  try {
    cache.guardarCopia(url, copia('nada'))
    cache.refrescarCopia(url, 5_000, 9_000)
    assert.deepEqual(readdirSync(dir), [], 'ni un fichero, ni el directorio tocado')
  } finally {
    process.env['CACHE_DIR'] = dir
  }
  cache.guardarCopia(url, copia('nada'))
  assert.equal(ficheros().length, 1, 'con la variable, la misma copia deja fichero')
})

test('crea el directorio si no existe, con espacios y tildes en la ruta', () => {
  const anidado = join(dir, 'sub dir ñá', 'caché profunda')
  process.env['CACHE_DIR'] = anidado
  try {
    const url = 'https://x.gov.co/anidada.htm'
    cache.guardarCopia(url, copia('anidada'))
    assert.ok(existsSync(rutaDe(url, anidado)))
    cache.limpiarCopias()
    assert.equal(cache.obtenerCopia(url)?.cuerpo, 'anidada')
  } finally {
    process.env['CACHE_DIR'] = dir
  }
})
