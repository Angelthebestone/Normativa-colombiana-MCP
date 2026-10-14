import { BASE_GESTOR, parseOpciones } from '../../nucleo/parse/gestor.ts'
import { CanarioError } from '../../nucleo/parse/errores.ts'
import { sinTildes } from '../../nucleo/parse/texto.ts'
import { traer } from './portal.ts'

export type Catalogos = {
  tipos: { id: string; nombre: string }[]
  anios: { id: string; nombre: string }[]
  entidades: { id: string; nombre: string }[]
  temas: { id: string; nombre: string }[]
}

let cacheCatalogos: Catalogos | null = null

export async function catalogos(): Promise<Catalogos> {
  if (cacheCatalogos) return cacheCatalogos
  const html = await traer(`${BASE_GESTOR}/consulta_avanzada.php`)
  const c: Catalogos = {
    tipos: parseOpciones(html, 'tipodoc'),
    anios: parseOpciones(html, 'ano1'),
    entidades: parseOpciones(html, 'entidad1'),
    temas: parseOpciones(html, 'temarl'),
  }
  if (c.tipos.length < 10) throw new CanarioError(`el catálogo de tipos trae ${c.tipos.length} opciones`)
  cacheCatalogos = c
  return c
}

/** Acepta el id numérico o el nombre (coincidencia laxa, sin tildes). */
export async function resolver(valor: string | number | undefined, cual: keyof Catalogos): Promise<string | undefined> {
  if (valor === undefined || valor === '') return undefined
  const s = String(valor).trim()
  if (/^\d+$/.test(s)) return s
  const lista = (await catalogos())[cual]
  const objetivo = sinTildes(s).toLowerCase()
  const exacto = lista.find((o) => sinTildes(o.nombre).toLowerCase() === objetivo)
  if (exacto) return exacto.id
  const parcial = lista.find((o) => sinTildes(o.nombre).toLowerCase().includes(objetivo))
  return parcial?.id
}
