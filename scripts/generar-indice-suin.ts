/**
 * Genera datos/indice-suin.json: mapea "ley 909 2004" → id de SUIN-Juriscol.
 *
 * SUIN es la única fuente del país que publica el ESTADO DE VIGENCIA, pero no
 * tiene buscador utilizable —su Solr no resuelve ni por nombre ni por IP—, así
 * que la única vía es enumerar su sitemap. El sitemap solo trae ids, sin decir
 * a qué norma corresponde cada uno, de modo que hay que abrir cada documento
 * una vez para leer su título. Son ~11.700 peticiones a un servicio público:
 * a la tasa de `pedir` (1/s, serializadas) tarda unas tres horas.
 *
 * Por eso es REANUDABLE: se relee el índice ya escrito y solo se piden los ids
 * que faltan, guardando cada 200. Se puede cortar con Ctrl-C y volver luego.
 * robots.txt permite explícitamente `viewDocument.asp?id=*` y declara estos
 * sitemaps, que es justo la vía sancionada para enumerarlo.
 *
 * Uso: node scripts/generar-indice-suin.ts [sitemap…]   (por defecto, leyes)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { Agent, request } from 'node:https'
import { dirname } from 'node:path'
import { rootCertificates } from 'node:tls'
import { createGunzip } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { SECTIGO_EV } from '../src/nucleo/ca.ts'
import { pedir } from '../src/nucleo/http.ts'
import { claveSuin, fichaSuin } from '../src/fuentes/suin.ts'

const BASE = 'https://www.suin-juriscol.gov.co'

/**
 * El crawl no usa `pedir`: su cubo de una petición por segundo protege las
 * horas de uso interactivo, y aquí son 11.689 documentos de una sola vez. Medido
 * contra el propio servidor: conexión nueva cada vez 966 ms, reutilizándola
 * 683 ms, y con cuatro en vuelo 260 ms por documento. Cuatro es lo que abre un
 * navegador cualquiera contra un mismo host, así que no es una carga anómala.
 *
 * SUIN_CONCURRENCIA=1 lo deja secuencial si hiciera falta ir más suave.
 */
const CONCURRENCIA = Math.max(1, Math.min(8, Number(process.env['SUIN_CONCURRENCIA'] ?? 4)))
const agente = new Agent({ keepAlive: true, maxSockets: CONCURRENCIA, ca: [...rootCertificates, SECTIGO_EV] })

/** GET con la cadena completada y gzip; devuelve '' si el documento no sirve. */
const traer = (path: string): Promise<string> =>
  new Promise((r) => {
    const req = request(
      `${BASE}${path}`,
      { agent: agente, timeout: 60_000, headers: { 'User-Agent': 'normativa-colombia-mcp (indice SUIN)', 'Accept-Encoding': 'gzip' } },
      (res) => {
        const flujo = res.headers['content-encoding'] === 'gzip' ? res.pipe(createGunzip()) : res
        const trozos: Buffer[] = []
        flujo.on('data', (c: Buffer) => trozos.push(c))
        flujo.on('end', () => r(res.statusCode === 200 ? Buffer.concat(trozos).toString('utf8') : ''))
        flujo.on('error', () => r(''))
      },
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => r(''))
    req.end()
  })
const SALIDA = fileURLToPath(new URL('../datos/indice-suin.json', import.meta.url))
const sitemaps = process.argv.slice(2).length ? process.argv.slice(2) : ['sitemapleyes.xml']

type Indice = { generado: string; fuente: string[]; normas: Record<string, string>; vistos: string[] }

const previo: Indice = (() => {
  try {
    return JSON.parse(readFileSync(SALIDA, 'utf8')) as Indice
  } catch {
    return { generado: '', fuente: [], normas: {}, vistos: [] }
  }
})()

const vistos = new Set(previo.vistos)
const normas = previo.normas

const guardar = () => {
  mkdirSync(dirname(SALIDA), { recursive: true })
  const salida: Indice = {
    generado: new Date().toISOString().slice(0, 10),
    fuente: [...new Set([...previo.fuente, ...sitemaps])],
    normas,
    vistos: [...vistos],
  }
  writeFileSync(SALIDA, JSON.stringify(salida))
}

const ids: string[] = []
for (const s of sitemaps) {
  const r = await pedir(`${BASE}/${s}`, 120_000)
  if (r.status !== 200) throw new Error(`${s} respondió ${r.status}`)
  const encontrados = [...r.cuerpo.matchAll(/viewDocument\.asp\?id=(\d+)/g)].map((m) => m[1]!)
  if (!encontrados.length) throw new Error(`${s} no trae ids: el sitemap pudo cambiar de formato.`)
  console.log(`${s}: ${encontrados.length} documentos`)
  ids.push(...encontrados)
}

const pendientes = [...new Set(ids)].filter((id) => !vistos.has(id))
console.log(
  `${pendientes.length} por leer (${vistos.size} ya en el índice), ${CONCURRENCIA} en paralelo: ` +
    `~${((pendientes.length * 0.26) / (60 * (CONCURRENCIA / 4))).toFixed(0)} min.`,
)

let hechos = 0
let conTitulo = 0

async function leer(id: string): Promise<void> {
  const html = await traer(`/viewDocument.asp?id=${id}`)
  if (html) {
    const f = fichaSuin(html)
    if (f) {
      normas[claveSuin(f.tipo, f.numero, f.anio)] = id
      conTitulo++
    }
  }
  vistos.add(id) // un 404 también se marca: no hay que volver a pedirlo
  if (++hechos % 100 === 0) {
    guardar()
    console.log(`${hechos}/${pendientes.length} — ${Object.keys(normas).length} normas identificadas`)
  }
}

// Cola simple: CONCURRENCIA obreros tirando del mismo array. El guardado va
// dentro de leer(), así que un Ctrl-C pierde como mucho los últimos 100.
let siguiente = 0
await Promise.all(
  Array.from({ length: CONCURRENCIA }, async () => {
    while (siguiente < pendientes.length) await leer(pendientes[siguiente++]!)
  }),
)

guardar()
console.log(`Índice escrito: ${Object.keys(normas).length} normas, ${vistos.size} ids visitados → ${SALIDA}`)
console.log(`Títulos leídos en esta pasada: ${conTitulo}/${pendientes.length}`)
