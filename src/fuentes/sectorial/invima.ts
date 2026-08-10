/**
 * INVIMA — Instituto Nacional de Vigilancia de Medicamentos y Alimentos.
 *
 * `/normatividad/normograma-invima` no es una página propia del INVIMA: es un
 * `<iframe>` a `normograma.invima.gov.co`, un producto de Avance Jurídico (la
 * misma casa editorial de SUIN-Juriscol). Ese sitio es, a su vez, un libro
 * estático de páginas HTML pre-compiladas —sin tabla ni buscador servido en el
 * propio HTML— salvo por una cosa: su "Herramientas de búsqueda" es una app
 * Angular (`<app-root>`) que sí habla con un backend real.
 *
 * El backend se encontró leyendo `compilacion/main_invima.js`: la app llama a
 * `https://normograma.info/prueba-invima/buscador/Buscar.ashx?&texto=...` y
 * recibe JSON plano, sin sesión ni token. `direccionAPI` está hardcodeada ahí
 * (el `configuracion.txt` que la app intenta leer primero da 404, así que usa
 * el valor por defecto). Se verificó con peticiones reales:
 *
 * - `texto=medicamentos` → 5765 resultados.
 * - Sin resultados, el backend NO da JSON: responde el cuerpo literal
 *   `"No se encontraron resultados."` con 200. Hay que distinguirlo del JSON
 *   antes de parsear.
 * - El motor exige el texto SIN tildes (`vacunación` da 0, `vacunacion` da
 *   671); de ahí `sinTildes`, igual que hace la propia app antes de llamarlo.
 * - Filtrar por año es un clausulado tipo Lucene que la propia app arma:
 *   `(year contains (2024~~2024))`, combinable con AND junto al texto libre.
 *
 * Lo importante para no prometer de más: esta base NO es solo lo que emite el
 * INVIMA. Es la compilación jurídica completa del sector que el INVIMA vigila
 * —leyes, decretos y resoluciones del Ministerio de Salud, conceptos, y hasta
 * sentencias de las altas cortes en la materia—, con 125 entidades distintas
 * en el campo `entidad` de una sola muestra. Filtrar aquí solo por
 * "entidad contains INVIMA" habría dejado fuera las actas de las Salas
 * Especializadas del propio INVIMA, que en el campo `entidad` no dicen
 * "INVIMA" sino el nombre de la sala ("Sala Especializada De Medicamentos"...).
 * Por eso no se filtra por entidad: se advierte del alcance real en vez de
 * fingir un recorte que rompería resultados legítimos.
 *
 * El buscador tampoco da fecha completa: el JSON solo trae `year`. El día y
 * el mes exigirían abrir cada ficha (`docs/...htm`), una petición extra por
 * resultado — se deja así de explícito en vez de aproximarlo.
 */
import { CanarioError, limpiarTermino, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { Adaptador, ActoSectorial } from '../sectorial.ts'

const API = 'https://normograma.info/prueba-invima/buscador/'
const DOCS = 'https://normograma.invima.gov.co/compilacion/docs/'
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

function construirConsulta(texto: string | undefined, anio: string | undefined): string {
  const partes: string[] = []
  const t = texto ? sinTildes(limpiarTermino(texto)).trim() : ''
  if (t) partes.push(t)
  if (anio) {
    if (!/^\d{4}$/.test(anio)) throw new Error(`Año inválido: "${anio}". Usa cuatro dígitos, p.ej. "2024".`)
    partes.push(`(year contains (${anio}~~${anio}))`)
  }
  return partes.join(' AND ')
}

export default {
  id: 'invima',
  nombre: 'INVIMA',
  sector: 'Salud — vigilancia sanitaria de medicamentos, alimentos y dispositivos médicos',
  portal: 'https://normograma.invima.gov.co/compilacion/herramientas_busqueda.html',
  dominioPermitido: 'https://normograma.invima.gov.co',
  tiposDocumento: ['Ley', 'Decreto', 'Resolución', 'Concepto', 'Sentencia'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Esta fuente NO es solo lo que emite el INVIMA: es la compilación jurídica completa del sector salud que ' +
    'el buscador de su normograma indexa (leyes, decretos y resoluciones del Ministerio de Salud, conceptos, ' +
    'jurisprudencia de las altas cortes, y las actas de las salas especializadas del propio INVIMA). El campo ' +
    '"tipo" de cada resultado dice de qué se trata; no asumas que todo es un acto del INVIMA. Los documentos son ' +
    'PDF o HTML sin texto extraíble aquí, y el buscador solo da el AÑO de cada acto, no el día ni el mes — para ' +
    'la fecha completa hay que abrir la ficha. No publica vigencia.',

  async buscar(opts): Promise<{ items: ActoSectorial[]; total?: number; nota?: string; url: string }> {
    const consulta = construirConsulta(opts.texto, opts.anio)
    if (!consulta) throw new Error('Indica un texto o un año para buscar en el normograma del Invima.')

    const url = `${API}Buscar.ashx?&texto=${encodeURIComponent(consulta)}`
    const r = await pedir(url, 40_000)
    if (r.status !== 200) throw new Error(`El buscador del normograma del Invima respondió ${r.status}.`)

    const cuerpo = r.cuerpo.trim()
    if (cuerpo === SIN_RESULTADOS) return { items: [], total: 0, url }

    let datos: Hit[]
    try {
      datos = JSON.parse(cuerpo) as Hit[]
    } catch {
      throw new CanarioError('el buscador del normograma del Invima no devolvió JSON ni el aviso de "sin resultados"')
    }
    if (!Array.isArray(datos)) {
      throw new CanarioError('el buscador del normograma del Invima devolvió JSON que no es una lista')
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
