import { idTipo, parsearCita, candidatosAmbiguos } from '../../nucleo/citas.ts'
import { articulo as extraerArticulo, limpiarArticulo } from '../../nucleo/parse/articulos.ts'
import { type Norma } from '../../nucleo/parse/gestor.ts'
import * as gestor from '../../fuentes/gestor.ts'

/** Inyectables para probar sin red (patrón de validar_cita.ts). */
export type Deps = { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma }

export type Articulo = { texto: string | null; url: string; titulo: string }

/**
 * Trae una norma citada del Gestor. Los errores se devuelven, no se lanzan:
 * cada camino de `con_reforma` tiene que poder decir qué le faltó.
 */
export async function resolverNorma(cita: string, deps: Deps): Promise<{ norma: Norma } | { error: string }> {
  const c = parsearCita(cita)
  if (!c) return { error: `No reconocí la cita «${cita}» como una norma del Gestor Normativo.` }
  const buscar = deps.buscar ?? gestor.buscar
  const r = await buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return {
        error: `La cita «${cita}» es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años distintos. Repite con el año, por ejemplo «${ambiguos[0]!.titulo}».`,
      }
    }
  }
  const primero = r.items[0]
  if (!primero) return { error: `No encontré la norma «${cita}» en el Gestor Normativo.` }
  return { norma: await (deps.obtenerNorma ?? gestor.obtenerNorma)(primero.id) }
}

/**
 * Trae el texto de un artículo de una norma citada. Si la cita o el artículo
 * no se encuentran, devuelve el lado con texto null y una nota clara.
 */
export async function articuloDe(cita: string, numero: string, deps: Deps = {}): Promise<{ articulo: Articulo; nota: string }> {
  const res = await resolverNorma(cita, deps)
  if ('error' in res) return { articulo: { texto: null, url: '', titulo: '' }, nota: res.error }
  const n = res.norma
  const texto = extraerArticulo(n.texto, numero)
  if (texto === null) {
    return {
      articulo: { texto: null, url: n.url, titulo: n.titulo },
      nota: `No encontré el artículo ${numero} en «${n.titulo}» (${n.url}).`,
    }
  }
  // Se compara el texto sustantivo, sin las notas entre paréntesis que el
  // portal incrusta (reformas, "Ver sentencia"): son ruido editorial, no contenido.
  return { articulo: { texto: limpiarArticulo(texto), url: n.url, titulo: n.titulo }, nota: '' }
}
