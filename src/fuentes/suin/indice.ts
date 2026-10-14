import { readFileSync } from 'node:fs'
import { sinTildes } from '../../nucleo/parse.ts'
import { esStopword } from '../../nucleo/stopwords.ts'
import type { ResultadoSuin } from './buscador.ts'
import { enlaceSuin } from './enlace.ts'

/**
 * Mapa "ley 909 2004" → id, generado con scripts/generar-indice-suin.ts. Ya no
 * hace falta para la vigencia —la ficha se pide por tipo, número y año—; queda
 * para `buscarEnIndice`, que resuelve una cita escrita como texto sin red.
 */
type Indice = { generado: string; normas: Record<string, string> }
let indice: Indice | null | undefined

function cargarIndice(): Indice | null {
  if (indice !== undefined) return indice
  // Empaquetado este módulo vive en server/index.js y el índice queda un nivel
  // arriba; sin empaquetar vive en src/fuentes/suin/ y quedan tres. Se prueban ambos.
  for (const rel of ['../datos/indice-suin.json', '../../../datos/indice-suin.json']) {
    try {
      indice = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Indice
      return indice
    } catch {
      /* siguiente ubicación */
    }
  }
  indice = null
  return indice
}

/** Qué cubre el índice empaquetado, para poder declararlo en vez de prometerlo. */
export function coberturaIndice(): { generado: string; leyes: number } | null {
  const idx = cargarIndice()
  return idx ? { generado: idx.generado, leyes: Object.keys(idx.normas).length } : null
}

/** Clave normalizada (sin tildes, minúsculas) del epígrafe de una ley. */
const normaliza = (s: string): string => sinTildes(s).toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * Búsqueda por texto sobre el índice de leyes empaquetado. A diferencia del
 * buscador de Azure, no normaliza tildes ni deriva: "Teletrabajo" no casa con
 * "trabajo remoto", así que una ley solo aparece si su título contiene la
 * palabra exacta, sin tildes. Si la búsqueda no rinde, `buscar_en_suin` cae al
 * buscador vivo.
 */
export function buscarEnIndice(texto: string, limite = 15): { total: number; items: ResultadoSuin[] } {
  const idx = cargarIndice()
  const aguja = normaliza(texto)
  if (!idx || !aguja) return { total: 0, items: [] }
  // Sin las vacías: "ley 1221 de 2008" no debe exigir la palabra "de" en la clave.
  const palabras = aguja.split(' ').filter((p) => !esStopword(p))
  const pedido = aguja.match(/\b(19|20)\d{2}\b/)?.[0] ?? ''
  const sinAño = palabras.filter((p) => !/^(19|20)\d{2}$/.test(p)).join(' ')
  const items: ResultadoSuin[] = []
  for (const [clave, id] of Object.entries(idx.normas)) {
    if (items.length >= limite) break
    // La clave es "tipo numero anio". La búsqueda debe caber en ella sin vacías:
    // "ley 1221 de 2008" → "ley 1221" + año 2008 exacto.
    if (pedido) {
      if (!clave.endsWith(pedido) || !clave.includes(sinAño)) continue
    } else if (!clave.includes(sinAño)) {
      continue
    }
    const m = clave.match(/^(.+?)\s+(\d+)\s+(\d{4})$/)
    const tipo = m?.[1] ?? ''
    const numero = m?.[2] ?? ''
    const anio = m?.[3] ?? ''
    items.push({
      id,
      titulo: `${tipo.toUpperCase()} ${numero} de ${anio}`.trim(),
      subtipo: tipo,
      epigrafe: '',
      vigencia: '',
      entidad: '',
      url: enlaceSuin(id),
    })
  }
  return { total: items.length, items }
}
