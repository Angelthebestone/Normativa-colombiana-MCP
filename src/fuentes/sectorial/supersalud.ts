/**
 * Supersalud — Superintendencia Nacional de Salud.
 *
 * La página de normatividad del portal (SharePoint) no publica un listado
 * parseable: enlaza a un normograma externo de Avance Jurídico
 * (normograma.supersalud.gov.co), la misma casa editorial de SUIN-Juriscol y
 * del normograma del INVIMA. Ese normograma es, como el del INVIMA, un libro
 * de páginas HTML estáticas con una app Angular de búsqueda (`<app-root>`).
 *
 * El backend se encontró leyendo `compilacion/main_sns.js`: la app llama a
 * `https://normograma.info/prueba-sns/buscador/Buscar.ashx?&texto=...` y
 * recibe JSON plano, sin sesión ni token. `direccionAPI` está hardcodeada ahí
 * (el `configuracion.txt` que la app intenta leer primero da 404, así que usa
 * el valor por defecto `prueba-sns`). Se verificó con una petición real:
 *
 * - `texto=habilitacion` → JSON con `nombre`, `texto`, `link`, `entidad`,
 *   `epigrafe`, `tipo`, `year`, `numero`.
 * - La codificación es latin1/ISO-8859-1; `decodificar` de `http.ts` ya lo
 *   resuelve.
 *
 * Lo importante para no prometer de más: esta base NO es solo lo que emite la
 * Supersalud. Es la compilación jurídica del sector salud que su normograma
 * indexa —leyes, decretos y resoluciones del Ministerio de Salud, conceptos y
 * hasta sentencias—, con varias entidades en el campo `entidad`. Por eso no se
 * filtra por entidad: se advierte del alcance real en vez de fingir un recorte.
 */
import { CanarioError, limpiarTermino, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { ActoSectorial, Adaptador } from '../sectorial.ts'

const API = 'https://normograma.info/prueba-sns/buscador/'
const DOCS = 'https://normograma.supersalud.gov.co/compilacion/docs/'
const SIN_RESULTADOS = 'No se encontraron resultados.'

type Hit = {
  nombre?: string
  link?: string
  entidad?: string
  epigrafe?: string
  tipo?: string
  year?: string
  numero?: string
}

export default {
  id: 'supersalud',
  nombre: 'Superintendencia Nacional de Salud',
  sector: 'Salud: aseguramiento, prestación de servicios y protección al usuario',
  portal: 'https://normograma.supersalud.gov.co/compilacion/herramientas_busqueda.html',
  dominioPermitido: 'https://normograma.supersalud.gov.co',
  tiposDocumento: ['Ley', 'Decreto', 'Resolución', 'Circular', 'Concepto'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Esta fuente NO es solo lo que emite la Supersalud: es la compilación jurídica del sector salud que el ' +
    'normograma de la entidad indexa (leyes, decretos y resoluciones del Ministerio de Salud, conceptos y ' +
    'jurisprudencia de las altas cortes), con varias entidades en el campo "entidad" de cada resultado. El ' +
    'campo "tipo" dice de qué se trata; no asumas que todo es un acto de la Supersalud. Los documentos son ' +
    'PDF o HTML sin texto extraíble aquí, y el buscador solo da el AÑO de cada acto, no el día ni el mes. ' +
    'No publica vigencia.',

  async buscar(opts): Promise<{ items: ActoSectorial[]; total?: number; nota?: string; url: string }> {
    const texto = opts.texto ? sinTildes(limpiarTermino(opts.texto)).trim() : ''
    if (!texto) throw new Error('Indica un texto para buscar en el normograma de la Supersalud.')

    const url = `${API}Buscar.ashx?&texto=${encodeURIComponent(texto)}`
    const r = await pedir(url, 40_000)
    if (r.status !== 200) throw new Error(`El buscador del normograma de la Supersalud respondió ${r.status}.`)

    const cuerpo = r.cuerpo.trim()
    if (cuerpo === SIN_RESULTADOS) return { items: [], total: 0, url }

    let datos: Hit[]
    try {
      datos = JSON.parse(cuerpo) as Hit[]
    } catch {
      throw new CanarioError('el buscador del normograma de la Supersalud no devolvió JSON ni el aviso de "sin resultados"')
    }
    if (!Array.isArray(datos)) {
      throw new CanarioError('el buscador del normograma de la Supersalud devolvió JSON que no es una lista')
    }

    const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
    const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
    const desde = (pagina - 1) * limite

    const items: ActoSectorial[] = datos.slice(desde, desde + limite).map((h) => ({
      tipo: h.tipo?.trim() || 'Sin clasificar',
      numero: h.numero?.trim() ?? '',
      anio: h.year?.trim() ?? '',
      // El buscador no da día ni mes: solo el año. Se dice en la advertencia.
      fecha: h.year?.trim() ?? '',
      epigrafe: (h.epigrafe ?? h.nombre ?? '').trim(),
      url: h.link ? new URL(h.link, DOCS).toString() : url,
    }))

    return { items, total: datos.length, url }
  },
} satisfies Adaptador
