import { sinTildes } from '../parse/texto.ts'

export type Articulo = { numero: string; desde: number; hasta: number; titulo: string }

/** Los artículos del texto por su encabezado a renglón propio, igual que parse.ts. */
export function partirEnArticulos(plano: string): Articulo[] {
  const marcas: { numero: string; desde: number; fin: number }[] = []
  for (const m of plano.matchAll(/(?:^|\n)[ \t]*(?:ARTICULO|Articulo)\s+(\d[\d.]*(?:-\d+)?[A-Za-z]?)\s*[°º]?[.:]?[ \t]*/gi)) {
    marcas.push({ numero: m[1]!, desde: m.index!, fin: m.index! + m[0].length })
  }
  return marcas.map((mk, i) => {
    const hasta = marcas[i + 1]?.desde ?? plano.length
    const cabecera = plano.slice(mk.fin, Math.min(mk.fin + 90, hasta))
    const corte = cabecera.search(/[.\n]/)
    const titulo = (corte >= 0 ? cabecera.slice(0, corte) : cabecera).replace(/\s+/g, ' ').trim()
    return { numero: mk.numero.replace(/\.+$/, ''), desde: mk.desde, hasta, titulo }
  })
}

export const normalizar = (s: string): string => sinTildes(s).toLowerCase().replace(/[.,;:]+$/, '').replace(/\s+/g, ' ').trim()

/**
 * Título que anuncia la cláusula de vigencia. La palabra tiene que cerrar el
 * título: así quedan fuera «VIGENCIA FONDOS ELÉCTRICOS», «VIGENCIAS FUTURAS DE
 * LA NACIÓN…» (Ley 1955) y «Vigencia del Sistema General de Pensiones»
 * (Ley 100), que llevan la palabra pero no son la entrada en vigor de la norma.
 */
export const esTituloDeVigencia = (titulo: string): boolean => {
  const t = normalizar(titulo)
  return (
    /^(?:la\s+)?(?:entrada\s+en\s+)?vigencia?s?$/.test(t) ||
    /^vigencias?\s+(?:y|e)\s+derogatorias?$/.test(t) ||
    /^derogatorias?\s+(?:y|e)\s+vigencias?$/.test(t) ||
    /(?:^|\s)y\s+vigencias?$/.test(t)
  )
}
