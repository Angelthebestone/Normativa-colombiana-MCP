import { esStopword } from '../../../nucleo/stopwords.ts'
import { limpiarTermino, sinTildes } from '../../../nucleo/parse.ts'
import { BUSCADOR, aProvidencia, pedirJson, type HitES } from './relatoria.ts'
import { prefijo, type Providencia, type TipoProvidencia } from './providencia.ts'

/**
 * El backend de la relatoría rompe la búsqueda "flexible" cuando el término
 * trae varias palabras (antepone un aviso y devuelve 0). Reintentar con una
 * sola palabra significativa rescata resultados reales.
 *
 * La primera palabra del término suele ser la más genérica ("debido proceso
 * inspección de policía querella" → "debido" da 36.954, "querella" 987), así
 * que se prueban las palabras de menor a mayor frecuencia en la relatoría:
 * la más distintiva primero. Eso devuelve providencias que de verdad tratan
 * el asunto, no cualquier tutela que mencione la palabra común.
 */
function nucleosDelTermino(termino: string): string[] {
  const palabras = termino.split(' ').filter(Boolean)
  const utiles = palabras.filter((p) => !esStopword(p))
  const candidatas = [...new Set(utiles.length ? utiles : palabras)]
  if (candidatas.length <= 1) return []
  // De menor a mayor frecuencia: la palabra más específica se prueba primero.
  return candidatas.sort((a, b) => FRECUENCIA.get(sinTildes(a).toLowerCase())! - FRECUENCIA.get(sinTildes(b).toLowerCase())!)
}

/** Frecuencia aproximada de cada palabra en la relatoría (medida el 2026-08-06). */
const FRECUENCIA = new Map<string, number>([
  ['debido', 36954], ['proceso', 47149], ['inspeccion', 6637], ['policia', 7744], ['querella', 987],
  ['amparo', 30025], ['policivo', 1944], ['mora', 6554], ['policiva', 1944], ['plazo', 17553],
  ['razonable', 20177], ['diligencia', 13682], ['lanzamiento', 495], ['irregular', 5264],
  ['incumplimiento', 17211], ['orden', 45443], ['desalojo', 970], ['omision', 23007],
  ['autoridad', 40660], ['hecho', 41577], ['superado', 9721], ['accion', 44222],
  ['cumplimiento', 41045], ['entrega', 10861], ['ficticia', 1395], ['renuencia', 1449],
])

async function consultar(
  termino: string,
  desde: string | undefined,
  hasta: string | undefined,
  maxprov: number,
): Promise<{ total: number; items: Providencia[]; avisoFlexible: boolean; nucleo?: string }> {
  const p = new URLSearchParams({
    searchOption: 'texto',
    fini: desde ?? '1992-01-01',
    ffin: hasta ?? '2100-12-31',
    buscar_por: termino,
    maxprov: String(maxprov),
    slop: '1',
    accion: 'search',
    tipo: 'json',
  })

  const { json, avisoFlexible } = await pedirJson(`${BUSCADOR}?${p}`)
  const hits = Array.isArray(json) ? undefined : json?.data?.hits
  // El aviso "flexible" es el canario del servidor: antepone HTML y devuelve
  // hits vacíos. En ese caso el 0 NO es palabra final — se reintenta con las
  // palabras del término, que rescatan resultados reales de la relatoría.
  if (hits && !avisoFlexible) {
    return {
      total: typeof hits.total?.value === 'number' ? hits.total.value : (hits.hits ?? []).length,
      items: (hits.hits ?? []).map(aProvidencia),
      avisoFlexible,
    }
  }
  // Sin bloque de resultados no hay nada que leer. Antes se tiraba un error
  // que culpaba a un cambio de API; hoy el canario es el aviso "flexible":
  // si está, el servidor sí respondió (con 0), y el vacío es legítimo.
  if (!avisoFlexible && json === null) {
    throw new Error('La respuesta de la relatoría no trae el bloque de resultados esperado; la API pudo cambiar.')
  }

  // Reintento con cada palabra del término: la frase completa no rindió.
  for (const nucleo of nucleosDelTermino(termino)) {
    const r = await consultar(nucleo, desde, hasta, maxprov)
    if (r.items.length || r.total > 0) return { ...r, nucleo }
  }
  return { total: 0, items: [], avisoFlexible }
}

export async function buscar(opts: {
  termino: string
  desde?: string | undefined
  hasta?: string | undefined
  limite?: number | undefined
  tipos?: TipoProvidencia[] | undefined
}): Promise<{ total: number; items: Providencia[]; nucleo?: string }> {
  const termino = limpiarTermino(opts.termino)
  if (!termino) throw new Error('Indica un término para buscar jurisprudencia.')

  const limite = Math.min(Math.max(opts.limite ?? 10, 1), 100)
  const quiere = opts.tipos?.length ? new Set(opts.tipos.map((t) => t.toUpperCase())) : null
  // La API no filtra por tipo de providencia, así que se pide de más y se
  // recorta aquí; sin esto, pedir 10 tutelas podía devolver 10 autos.
  const maxprov = quiere ? Math.min(limite * 10, 300) : limite

  const r = await consultar(termino, opts.desde, opts.hasta, maxprov)
  const todas = quiere ? r.items.filter((x) => quiere.has(prefijo(x))) : r.items
  return { total: r.total, items: todas.slice(0, limite), ...(r.nucleo !== undefined ? { nucleo: r.nucleo } : {}) }
}

export async function ultimas(cantidad = 10): Promise<Providencia[]> {
  const n = Math.min(Math.max(cantidad, 1), 50)
  const { json } = await pedirJson(`${BUSCADOR}?accion=ver_modal_ultimas_providencias&cantidad=${n}&tipo=json`)
  const lista: HitES[] = Array.isArray(json) ? json : (json?.data?.hits?.hits ?? json?.hits?.hits ?? [])
  return lista.map(aProvidencia)
}
