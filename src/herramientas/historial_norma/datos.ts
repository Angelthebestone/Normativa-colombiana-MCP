import type { Cambio } from '../../nucleo/parse/historial.ts'
import { fechaBogota } from '../../nucleo/fecha.ts'
import { acotar, ficha, ultimaReforma } from './cambios.ts'

/** Los datos del modo json, con la misma forma que promete la descripción. */
export type DatosHistorial = {
  fecha_consulta: string
  /** La línea de alcance, la misma que el modo markdown pone delante. */
  alcance: string
  titulo: string
  url: string
  /** Cambios anotados de la norma (o del artículo pedido), antes de paginar. */
  total: number
  /** La página: los cambios ya ordenados que caben entre `desde` y `limite`. */
  cambios: Cambio[]
  ultima_reforma: Cambio | null
  avisos: string[]
}

/** Los avisos del json: lo mismo que el texto dice al lector, en frases sueltas. */
function avisosDe(
  d: { ordenados: Cambio[]; tramo: Cambio[]; desde: number },
  articulo?: string | undefined,
): string[] {
  const avisos = [
    'Son las notas literales del portal, ordenadas por el año de la norma que las introduce; los cambios sin año ' +
      'van al final, sin ordenar. No se deduce vigencia: el estado actual se consulta con resolver_cita.',
  ]
  if (!d.ordenados.length) {
    avisos.push(
      articulo
        ? `El Gestor no anota cambios sobre el artículo ${articulo}; eso no equivale a que siga intacto.`
        : 'El Gestor no anota reformas sobre esta norma; eso no equivale a que esté intacta.',
    )
    return avisos
  }
  const ultima = ultimaReforma(d.ordenados)
  if (ultima) {
    avisos.push(
      `La reforma más reciente anotada por el portal es ${ficha(ultima)}: es la última anotada, no necesariamente la que rige.`,
    )
    if (ultima.accion === 'derogado') avisos.push('La última reforma anotada es una DEROGATORIA.')
  } else {
    avisos.push('Ninguna nota trae año: no se puede señalar cuál es la reforma más reciente.')
  }
  const sinAnio = d.ordenados.filter((c) => !c.anio).length
  if (sinAnio) avisos.push(`${sinAnio} cambio(s) no traen año en la nota y van al final, sin ordenar.`)
  const fin = d.desde + d.tramo.length
  if (!d.tramo.length) {
    avisos.push(`"desde" (${d.desde}) está más allá del final: el filtro reúne ${d.ordenados.length} cambio(s).`)
  } else if (fin < d.ordenados.length) {
    avisos.push(`Quedan ${d.ordenados.length - fin}: repite con desde=${fin}.`)
  }
  return avisos
}

/** El objeto vacío de los caminos sin norma resuelta: la misma forma, en cero. */
export const sinDatos = (alcanceLinea: string, aviso: string): DatosHistorial => ({
  fecha_consulta: fechaBogota(),
  alcance: alcanceLinea,
  titulo: '',
  url: '',
  total: 0,
  cambios: [],
  ultima_reforma: null,
  avisos: [aviso],
})

/**
 * Los datos de una norma ya resuelta. Exportada para poder probar el json sin
 * red; el texto sale de `formatearHistorial` sobre el mismo `acotar`.
 */
export function datosDe(
  cambios: Cambio[],
  titulo: string,
  url: string,
  alcanceLinea: string,
  opts: { articulo?: string | undefined; desde?: number | undefined; limite?: number | undefined } = {},
): DatosHistorial {
  const { ordenados, desde, tramo } = acotar(cambios, opts)
  return {
    fecha_consulta: fechaBogota(),
    alcance: alcanceLinea,
    titulo,
    url,
    total: ordenados.length,
    cambios: tramo,
    ultima_reforma: ultimaReforma(ordenados),
    avisos: avisosDe({ ordenados, tramo, desde }, opts.articulo),
  }
}
