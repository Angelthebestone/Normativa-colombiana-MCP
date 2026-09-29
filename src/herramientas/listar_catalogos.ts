/** Los valores válidos de los filtros de `buscar_normas`, que el portal no documenta. */
import { z } from 'zod'

import { conPrefijo, sinPrefijo } from '../nucleo/catalogos.ts'
import { sinTildes } from '../nucleo/parse.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Listar catálogos de búsqueda'

export const DESCRIPCION =
  'Valores válidos para los filtros de buscar_normas: tipos de documento (29), años, entidades (89) y temas ' +
  '(2.509), más los subtemas de un tema (subtemas con tema_id), los conceptos de Función Pública ' +
  '(conceptos_fp con numero/anio) y el listado curado del DAFP (normas_fp). En temas el filtro es ' +
  'obligatorio por volumen, y sus ids llevan prefijo ("tema-24457") porque el portal tiene tres taxonomías ' +
  'que reutilizan los mismos números. ' +
  'OJO CON EL ALCANCE: estos catálogos son SOLO del Gestor Normativo de Función Pública y solo sirven en ' +
  'buscar_normas; no cubren la DIAN (su normograma está en buscar_normativa_tributaria), ni SUIN-Juriscol, ' +
  'ni las tres altas cortes. Que "DIAN" no aparezca entre las entidades no significa que no haya normativa ' +
  'suya: significa que el Gestor no la cataloga como entidad emisora.'

const esquema = z.object({
  catalogo: z.enum(['tipos', 'anios', 'entidades', 'temas', 'subtemas', 'conceptos_fp', 'normas_fp']),
  filtro: z.string().optional().describe('Texto para filtrar; obligatorio en "temas"'),
  tema_id: z.string().optional().describe('Id del tema (solo catalogo="subtemas"), con prefijo "tema-…"'),
  numero: z.string().optional().describe('Número del concepto (solo catalogo="conceptos_fp")'),
  anio: z.string().optional().describe('Año del concepto (solo catalogo="conceptos_fp")'),
  desde: z.coerce.number().int().min(0).default(0),
  limite: z.coerce.number().int().min(1).max(200).default(50),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export async function escribir({ catalogo, filtro, tema_id, numero, anio, desde, limite }: Params): Promise<string> {
  /**
   * Cada catálogo usa unos parámetros. Uno que no le toca se ignora, y callarlo
   * hace creer que el filtro se aplicó: `catalogo="tipos"` con `numero="9999"`
   * devolvía los 29 tipos como si 9999 hubiera filtrado algo, y quien llamaba
   * deducía que no había resultados, no que había pasado el parámetro a otro
   * catálogo. Se nombra el que sobra y dónde sí vale, como en obtener_documento.
   */
  const DE_CADA: Record<string, string[]> = {
    tipos: ['filtro'],
    anios: ['filtro'],
    entidades: ['filtro'],
    temas: ['filtro'],
    subtemas: ['tema_id'],
    conceptos_fp: ['numero', 'anio'],
    normas_fp: ['filtro'],
  }
  const puestos: [string, unknown][] = [
    ['filtro', filtro],
    ['tema_id', tema_id],
    ['numero', numero],
    ['anio', anio],
  ]
  const propios = DE_CADA[catalogo] ?? []
  const sobran = puestos
    .filter(([k, v]) => v !== undefined && !propios.includes(k))
    .map(([k]) => `${k} (es de ${Object.entries(DE_CADA).filter(([, ks]) => ks.includes(k)).map(([c]) => `${c}`).join(', ') || 'otro catálogo'})`)
  if (sobran.length) {
    return (
      `Con catalogo="${catalogo}" sobra ${sobran.join(' y ')}.\n\n` +
        `${catalogo === 'temas' || catalogo === 'normas_fp' ? 'Este catálogo filtra con "filtro".' : 'Este catálogo no filtra por ese parámetro.'} ` +
        `Cada catálogo usa los suyos: ${Object.entries(DE_CADA)
          .map(([c, ks]) => (ks.length ? `${c}→${ks.join('+')}` : c))
          .join(', ')}.`
    )
  }
  if (catalogo === 'temas' && !filtro) {
    return ('El catálogo de temas tiene 2.509 entradas: indica un filtro de texto para acotarlo.')
  }
  // Catálogos propios del Gestor (tipos, años, entidades, temas).
  if (catalogo === 'tipos' || catalogo === 'anios' || catalogo === 'entidades' || catalogo === 'temas') {
    const c = await gestor.catalogos()
    const q = filtro ? sinTildes(filtro).toLowerCase() : ''
    const lista = c[catalogo].filter((o) => !q || sinTildes(o.nombre).toLowerCase().includes(q))
    if (!lista.length) return vacio(`entradas de "${catalogo}" que coincidan con "${filtro}"`, 'Prueba un filtro más corto.')
    return (
      `${lista.length} entrada(s) en ${catalogo}:\n` +
        lista
          .slice(0, limite)
          .map((o) => `- ${o.nombre} (id ${catalogo === 'temas' ? conPrefijo('tema', o.id) : o.id})`)
          .join('\n') +
        (lista.length > limite ? `\n… y ${lista.length - limite} más.` : '')
    )
  }
  // Subtemas de un tema del catálogo de búsqueda.
  if (catalogo === 'subtemas') {
    if (!tema_id) return ('Para catalogo="subtemas" hace falta tema_id (con prefijo "tema-…").')
    const tema = sinPrefijo('tema', tema_id)
    const s = await gestor.subtemas(tema)
    if (!s.length) return vacio(`subtemas para el tema ${tema_id}`, 'Verifica el id con catalogo="temas".')
    return (s.map((o) => `- ${o.nombre} (id ${conPrefijo('sub', o.id)})`).join('\n'))
  }
  // Conceptos de Función Pública (solo número/año; sin materia).
  if (catalogo === 'conceptos_fp') {
    if (!numero && !anio) {
      throw new Error(
        'Para catalogo="conceptos_fp" indica al menos numero o anio: el listado solo trae número y año de cada ' +
          'concepto, sin el asunto. Para conceptos SOBRE UN TEMA usa buscar_normas con tipo_documento "Concepto".'
      )
    }
    const r = await gestor.conceptosFp(numero, anio, limite, desde)
    if (!r.total) return vacio('conceptos con ese número o año', 'Recuerda que este listado solo filtra por número y año.')
    if (!r.items.length) {
      return vacio(`conceptos a partir de la posición ${desde}`, `El filtro reúne ${r.total} concepto(s); pide un "desde" menor.`)
    }
    const fin = desde + r.items.length
    return (
      `${r.total} concepto(s) coinciden; se muestran ${desde + 1}–${fin}.\n\n` +
        r.items.map((c) => `- ${c.titulo} (id ${c.id})\n  ${c.url}`).join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : '')
    )
  }
  // Listado curado de normas de competencia del DAFP.
  const todas = await gestor.normasFp()
  const q = filtro ? sinTildes(filtro).toLowerCase() : ''
  const items = todas.filter((i) => !q || sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase().includes(q))
  if (!items.length) return vacio(`normativa de competencia del DAFP que coincida con "${filtro}"`, 'Prueba sin filtro para ver el listado completo.')
  const tramo = items.slice(desde, desde + limite)
  if (!tramo.length) {
    return vacio(`normativa a partir de la posición ${desde}`, `El listado reúne ${items.length} norma(s); pide un "desde" menor.`)
  }
  const fin = desde + tramo.length
  return (
    `${items.length} de ${todas.length} norma(s) del listado; se muestran ${desde + 1}–${fin}.\n\n` +
      tramo
        .map((i) => `- ${i.titulo} (id ${i.id})\n  Extracto temático: ${i.resumen || '(ninguno)'}\n  ${i.url}`)
        .join('\n') +
      (fin < items.length ? `\n\nQuedan ${items.length - fin}: repite con desde=${fin}.` : '')
  )
}
