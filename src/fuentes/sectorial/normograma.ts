/**
 * Adaptador compartido para los normogramas de Avance Jurídico (el mismo motor
 * `Buscar.ashx` que usan el INVIMA y la Supersalud): misma respuesta JSON,
 * mismo aviso de "sin resultados", mismo mapeo a `ActoSectorial`.
 *
 * Las únicas diferencias entre portales son la base de la API, la base de los
 * documentos y si el motor acepta el clausulado de año (el INVIMA lo acepta,
 * la Supersalud no). El resto —pedir, distinguir el "No se encontraron
 * resultados." literal, el canario ante JSON inesperado y el recorte por
 * página— es idéntico y vive aquí, no copiado en cada adaptador.
 */
import { CanarioError, limpiarTermino, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { Adaptador, ActoSectorial, OpcionesSectorial } from '../sectorial.ts'

const SIN_RESULTADOS = 'No se encontraron resultados.'

/** Con `solo_entidad=true` se recorta a los tipos propios de la entidad. Exportada para testear sin red. */
export function filtrarSoloEntidad<T extends { tipo: string }>(items: T[], tipos: string[]): T[] {
  return items.filter((x) => tipos.includes(x.tipo))
}

type Hit = {
  nombre?: string
  link?: string
  entidad?: string
  epigrafe?: string
  tipo?: string
  year?: string
  numero?: string
}

export type ConfigNormograma = {
  id: string
  nombre: string
  sector: string
  portal: string
  dominioPermitido: string
  tiposDocumento: string[]
  advertencia: string
  /** Base de la API `Buscar.ashx` (p.ej. `https://normograma.info/prueba-invima/buscador/`). */
  apiBase: string
  /** Base de los documentos, para resolver `link` relativos. */
  docsBase: string
  /** Si el motor acepta el filtro por año (`(year contains (2024~~2024))`). */
  soportaAnio: boolean
}

/** La consulta que entiende el motor: texto sin tildes y, si se soporta, el año como clausulado. */
export function construirConsulta(texto: string | undefined, anio: string | undefined, soportaAnio: boolean): string {
  const partes: string[] = []
  const t = texto ? sinTildes(limpiarTermino(texto)).trim() : ''
  if (t) partes.push(t)
  if (anio) {
    if (!/^\d{4}$/.test(anio)) throw new Error(`Año inválido: "${anio}". Usa cuatro dígitos, p.ej. "2024".`)
    if (soportaAnio) partes.push(`(year contains (${anio}~~${anio}))`)
  }
  return partes.join(' AND ')
}

/** Monta el adaptador completo para un normograma de Avance Jurídico. */
export function adaptadorNormograma(cfg: ConfigNormograma): Adaptador {
  const pedirBusqueda = async (opts: OpcionesSectorial): Promise<{ items: ActoSectorial[]; total: number; url: string }> => {
    const consulta = construirConsulta(opts.texto, opts.anio, cfg.soportaAnio)
    if (!consulta) throw new Error(`Indica un texto${cfg.soportaAnio ? ' o un año' : ''} para buscar en el normograma del ${cfg.nombre}.`)

    const url = `${cfg.apiBase}Buscar.ashx?&texto=${encodeURIComponent(consulta)}`
    const r = await pedir(url, 40_000)
    if (r.status !== 200) throw new Error(`El buscador del normograma del ${cfg.nombre} respondió ${r.status}.`)

    const cuerpo = r.cuerpo.trim()
    if (cuerpo === SIN_RESULTADOS) return { items: [], total: 0, url }

    let datos: Hit[]
    try {
      datos = JSON.parse(cuerpo) as Hit[]
    } catch {
      throw new CanarioError(`el buscador del normograma del ${cfg.nombre} no devolvió JSON ni el aviso de "sin resultados"`)
    }
    if (!Array.isArray(datos)) {
      throw new CanarioError(`el buscador del normograma del ${cfg.nombre} devolvió JSON que no es una lista`)
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
      url: h.link ? new URL(h.link, cfg.docsBase).toString() : url,
    }))

    // Con solo_entidad=true se recorta a los tipos que la propia entidad expide:
    // el normograma mezcla la compilación completa del sector (leyes, decretos
    // del Ministerio, sentencias), y a veces solo interesa el acto de la entidad.
    let filtrados = items
    let nota: string | undefined
    if (opts.solo_entidad === true) {
      filtrados = filtrarSoloEntidad(items, cfg.tiposDocumento)
      nota = `solo_entidad=true: se filtraron los actos a los tipos propios de la entidad (${cfg.tiposDocumento.join(', ')}).`
    }

    return { items: filtrados, total: filtrados.length, url, ...(nota ? { nota } : {}) }
  }

  return {
    id: cfg.id,
    nombre: cfg.nombre,
    sector: cfg.sector,
    portal: cfg.portal,
    dominioPermitido: cfg.dominioPermitido,
    tiposDocumento: cfg.tiposDocumento,
    soportaTexto: false,
    soportaVigencia: false,
    pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
    advertencia: cfg.advertencia,
    buscar: pedirBusqueda,
  }
}
