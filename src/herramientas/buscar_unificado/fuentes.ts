import * as gestor from '../../fuentes/gestor/index.ts'
import * as corte from '../../fuentes/jurisprudencia/corte/index.ts'
import * as suin from '../../fuentes/suin/index.ts'
import * as dian from '../../fuentes/normograma.ts'
import { adaptador } from '../../fuentes/sectorial.ts'
import { conAlternativas } from '../../nucleo/alternativas.ts'
import { activa } from '../../nucleo/alcance.ts'

/**
 * Clave de la línea de alcance para cada fuente consultable. Los tres
 * reguladores con nombre propio (INVIMA, Supersalud, ANM) comparten la clave
 * "sectorial", así que en la línea se funden en una sola entrada.
 */
export const CLAVE_ALCANCE: Record<Fuente, string> = {
  gestor: 'gestor',
  corte: 'corte',
  suin: 'suin',
  dian: 'dian',
  invima: 'sectorial',
  supersalud: 'sectorial',
  anm: 'sectorial',
}

export const FUENTES = ['gestor', 'corte', 'suin', 'dian', 'invima', 'supersalud', 'anm'] as const
export type Fuente = (typeof FUENTES)[number]

export type Item = {
  fuente: string
  titulo: string
  url: string
  detalle?: string
  /** La llamada lista a obtener_documento que trae el texto, cuando la fuente lo sirve. */
  paraLeer?: string
}

/**
 * La llamada literal a `obtener_documento` que devuelve el texto de este
 * resultado. Se arma con los MISMOS nombres de parámetro que exige esa
 * herramienta por fuente (gestor→id, suin→id, corte→ruta, dian→link, sectorial→entidad+url).
 */
export const paraLeerDe = (fuente: string, campos: Record<string, string>): string =>
  `obtener_documento con ${[`fuente="${fuente}"`, ...Object.entries(campos).map(([k, v]) => `${k}="${v}"`)].join(', ')}`

/**
 * true si `url` cae en el mismo origen que el dominio permitido del regulador.
 * Es la condición que exige `obtener_documento` para leer un PDF sectorial; sin
 * ella no se promete un «Para leer» que la lectura rechazaría. Medido el
 * 2026-09-28: los actos de la ANM viven en https://saportalanm.blob.core.windows.net
 * —un blob de Azure, no su dominio—, así que su enlace se rechaza por dominio.
 */
export const mismoOrigen = (dominio: string, url: string): boolean => {
  try {
    return new URL(url).origin === new URL(dominio).origin
  } catch {
    return false
  }
}

export const PERFILES_ADMITIDOS = ['laboral', 'tributario', 'ambiental', 'contratacion', 'energia', 'salud', 'mineria'] as const

/**
 * Qué fuentes consultar según perfil y filtro explícito. Las apagadas (FUENTES)
 * salen también de los perfiles: el perfil salud con los reguladores apagados
 * consulta lo demás y la línea de alcance dice cuáles faltan.
 */
export function fuentesDe(perfil: string | undefined, fuentes: Fuente[] | undefined): Fuente[] {
  if (fuentes?.length) return fuentes
  // Sin perfil, la DIAN se deja fuera: su buscador tarda ~20 s y su materia
  // (tributario) tiene herramienta propia. Con perfil tributario entra.
  const base: Fuente[] =
    perfil === 'tributario'
      ? ['gestor', 'corte', 'suin', 'dian']
      : perfil === 'salud'
        ? ['gestor', 'corte', 'suin', 'invima', 'supersalud']
        : perfil === 'mineria'
          ? ['gestor', 'corte', 'suin', 'anm']
          : ['gestor', 'corte', 'suin']
  return base.filter((f) => activa(CLAVE_ALCANCE[f]))
}

async function porGestor(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => gestor.buscar({ palabras: t }).then((r) => r.items),
    texto,
    1,
  )
  return items.slice(0, limite).map((i) => ({
    fuente: 'gestor',
    titulo: i.titulo,
    url: i.url,
    paraLeer: paraLeerDe('gestor', { id: i.id }),
  }))
}

async function porCorte(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => corte.buscar({ termino: t, limite }).then((r) => r.items),
    texto,
    1,
  )
  return items.slice(0, limite).map((p) => ({
    fuente: 'corte-constitucional',
    titulo: `${p.sentencia} (${p.tipo}, ${p.fecha})`,
    url: p.url,
    ...(p.sintesis ? { detalle: p.sintesis.slice(0, 200) } : {}),
    ...(p.ruta ? { paraLeer: paraLeerDe('corte', { ruta: p.ruta }) } : {}),
  }))
}

async function porSuin(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => suin.buscar({ texto: t, limite }).then((r) => r.items),
    texto,
    1,
  )
  return items.slice(0, limite).map((d) => ({
    fuente: 'suin',
    titulo: d.titulo,
    url: d.url,
    ...(d.vigencia ? { detalle: `Estado de vigencia (ficha SUIN): ${d.vigencia}` } : {}),
    paraLeer: paraLeerDe('suin', { id: d.id }),
  }))
}

async function porDian(texto: string, limite: number): Promise<Item[]> {
  const { items } = await conAlternativas(
    (t) => dian.buscar(t, limite, 0).then((r) => r.items),
    texto,
    1,
  )
  return items.map((d) => ({
    fuente: 'dian',
    titulo: d.nombre,
    url: d.url,
    detalle: d.epigrafe,
    ...(d.link ? { paraLeer: paraLeerDe('dian', { link: d.link }) } : {}),
  }))
}

/** Sectoriales de perfil: INVIMA, Supersalud y ANM se consultan con su adaptador. */
const porSectorial = (id: 'invima' | 'supersalud' | 'anm') => async (texto: string, limite: number): Promise<Item[]> => {
  const a = adaptador(id)
  if (!a) return []
  const r = await a.buscar({ texto, limite })
  return r.items.slice(0, limite).map((x) => ({
    fuente: id,
    titulo: `${x.tipo} ${x.numero}${x.anio ? ` de ${x.anio}` : ''}${x.epigrafe ? ` — ${x.epigrafe.slice(0, 120)}` : ''}`,
    url: x.url,
    // obtener_documento lee el sectorial por entidad+url, no por su clave interna.
    // Solo se promete si el enlace cae en el dominio que esa lectura acepta.
    ...(mismoOrigen(a.dominioPermitido, x.url) ? { paraLeer: paraLeerDe('sectorial', { entidad: id, url: x.url }) } : {}),
  }))
}

export const POR_FUENTE: Record<Fuente, (texto: string, limite: number) => Promise<Item[]>> = {
  gestor: porGestor,
  corte: porCorte,
  suin: porSuin,
  dian: porDian,
  invima: porSectorial('invima'),
  supersalud: porSectorial('supersalud'),
  anm: porSectorial('anm'),
}

/** Orden de presentación: tributario prioriza DIAN; el resto, Gestor primero. */
export function ordenar(items: Item[], perfil?: string): Item[] {
  const peso: Record<string, number> = { gestor: 0, 'corte-constitucional': 1, suin: 2, dian: 3, invima: 4, supersalud: 5, anm: 4 }
  if (perfil === 'tributario') peso['dian'] = -1
  return items.sort((a, b) => (peso[a.fuente] ?? 9) - (peso[b.fuente] ?? 9))
}
