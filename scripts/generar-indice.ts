/**
 * Genera datos/indice-tematico.json a partir de la consulta temática completa.
 *
 * El HTML crudo son ~20 MB y tarda ~35 s; destilado queda en unos pocos MB y
 * permite responder por tema sin red, con el buscador OR del portal fuera del
 * camino. Se regenera al publicar cada versión.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pedir } from '../src/http.ts'

const URL_TODOS = 'https://www.funcionpublica.gov.co/eva/gestornormativo/consulta-tematica.php?todos=1&texto=todos'
const SALIDA = fileURLToPath(new URL('../datos/indice-tematico.json', import.meta.url))

const RE = /info_restrictor\('([\s\S]*?)','([\s\S]*?)','([\s\S]*?)',(\d+),(\d+)\)/g

const entidades = (s: string) =>
  s
    .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
    .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
    .replace(/&Aacute;/g, 'Á').replace(/&Eacute;/g, 'É').replace(/&Iacute;/g, 'Í')
    .replace(/&Oacute;/g, 'Ó').replace(/&Uacute;/g, 'Ú').replace(/&Ntilde;/g, 'Ñ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

console.log('Descargando la consulta temática completa (~20 MB, puede tardar un minuto)…')
const res = await pedir(URL_TODOS, 300_000)
if (res.status !== 200) throw new Error(`El portal respondió ${res.status}`)
const html = res.cuerpo
console.log(`Recibidos ${(html.length / 1e6).toFixed(1)} MB.`)

/**
 * `n` guarda `[normid, titulo]`, pero el título solo se conserva en las ocho
 * primeras normas de cada fila: buscar_por_tema imprime ocho y resume el resto
 * como "… y N más", así que los demás títulos viajaban en el paquete para no
 * mostrarse nunca. Los ids se conservan todos, que es lo que usan
 * explicar_relacion_tema y el desempate por tamaño de temaDelIndice.
 * Medido: 5,16 MB → 3,25 MB, un 37% menos.
 */
const TITULOS_POR_FILA = 8

const grupos = new Map<string, { t: string; s: string; ts: string; n: [string, string?][] }>()
let n = 0
for (const m of html.matchAll(RE)) {
  const [, tema, subtema, titulo, ts, normid] = m
  const clave = `${ts}`
  let g = grupos.get(clave)
  if (!g) {
    g = { t: entidades(tema!), s: entidades(subtema!), ts: ts!, n: [] }
    grupos.set(clave, g)
  }
  g.n.push(g.n.length < TITULOS_POR_FILA ? [normid!, entidades(titulo!)] : [normid!])
  n++
}

if (grupos.size < 1000) throw new Error(`Solo se extrajeron ${grupos.size} subtemas: el portal pudo cambiar de formato.`)

const salida = {
  generado: new Date().toISOString().slice(0, 10),
  fuente: URL_TODOS,
  filas: [...grupos.values()].sort((a, b) => a.t.localeCompare(b.t) || a.s.localeCompare(b.s)),
}

mkdirSync(dirname(SALIDA), { recursive: true })
writeFileSync(SALIDA, JSON.stringify(salida))
const kb = Buffer.byteLength(JSON.stringify(salida)) / 1024
console.log(`Índice escrito: ${grupos.size} subtemas, ${n} relaciones, ${kb.toFixed(0)} KB → ${SALIDA}`)
