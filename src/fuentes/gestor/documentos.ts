import { BASE_GESTOR, enlacesDeNormas, parseNorma, parseTematica, type FilaTema, type Norma, type Resultado } from '../../nucleo/parse/gestor.ts'
import { CanarioError } from '../../nucleo/parse/errores.ts'
import { pdfEsEscaneo } from '../../nucleo/parse/pdf.ts'
import { limpiarTermino } from '../../nucleo/parse/texto.ts'
import { entero, traer } from './portal.ts'

export async function obtenerNorma(id: string | number): Promise<Norma> {
  const n = entero(id)
  if (!n) throw new Error(`Identificador de norma inválido: ${id}`)
  return parseNorma(await traer(`${BASE_GESTOR}/norma.php?i=${n}`), n)
}

/**
 * ¿El PDF de una norma es un escaneo? Solo se pregunta cuando el HTML no trajo
 * texto: es una petición de más en un camino que ya iba a devolver poco, y a
 * cambio distingue "no hay texto publicado" de "es una imagen".
 */
export async function pdfEscaneado(id: string | number): Promise<boolean> {
  try {
    return pdfEsEscaneo(await traer(`${BASE_GESTOR}/norma_pdf.php?i=${entero(id)}`))
  } catch {
    return false // sin PDF no hay nada que afirmar; se informa como "sin texto" a secas
  }
}

export async function subtemas(temaId: string | number): Promise<{ id: string; nombre: string }[]> {
  const t = entero(temaId)
  if (!t) throw new Error(`Identificador de tema inválido: ${temaId}`)
  const html = await traer(`${BASE_GESTOR}/gestion/funphp/funajax.php?t=cargar_subtemas_activos&itema=${t}`)
  return [...html.matchAll(/<option value="(\d+)"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1]!, nombre: m[2]!.trim() }))
}

/** El restrictor: por qué una norma aplica a un subtema. Es lo mejor del portal. */
export async function restrictor(temsubid: string | number, normid: string | number): Promise<string> {
  const a = entero(temsubid)
  const b = entero(normid)
  if (!a || !b) throw new Error('temsubid y normid deben ser numéricos.')
  const t = await traer(`${BASE_GESTOR}/consulta-tematica.php?inforestrictor=si&temsubid=${a}&normid=${b}`)
  return t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function tematica(texto: string): Promise<FilaTema[]> {
  const q = limpiarTermino(texto)
  if (!q) throw new Error('Indica un término para la consulta temática.')
  return parseTematica(await traer(`${BASE_GESTOR}/consulta-tematica.php?texto=${encodeURIComponent(q)}`))
}

// `normasfp.php` es un listado plano: no trae el contador "encontrados" que sí
// devuelve el buscador, así que se leen los enlaces directamente.
export async function normasFp(): Promise<Resultado[]> {
  const items = enlacesDeNormas(await traer(`${BASE_GESTOR}/normasfp.php`))
  if (!items.length) throw new CanarioError('el listado de normas de Función Pública no trae enlaces')
  return items
}
