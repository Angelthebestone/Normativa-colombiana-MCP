import { CanarioError } from '../../../nucleo/parse/errores.ts'
import { limpiarTermino } from '../../../nucleo/parse/texto.ts'
import { pedir } from '../../../nucleo/http.ts'
import { enlaceBusqueda } from './enlaces.ts'
import { parsear, RAIZ } from './listado.ts'
import { contienenTodas, type Providencia } from './providencia.ts'

export async function buscar(
  texto: string,
  limite = 5,
  pagina = 1,
  exacto = true,
  deps: { pedir?: typeof pedir } = {},
): Promise<{
  paginas: number
  pagina: number
  items: Providencia[]
  url: string
  nota?: string | undefined
  omitidos: number
  ampliada?: boolean
}> {
  const q = limpiarTermino(texto)
  if (!q) throw new Error('Indica un término para buscar en el Consejo de Estado.')
  const pedirHttp = deps.pedir ?? pedir

  // El enlace cuenta las páginas desde cero; hacia fuera se numeran desde uno,
  // que es como las rotula la propia página ("Página 1 de 15406").
  const n = Math.max(1, Math.trunc(pagina))
  const url = enlaceBusqueda(q, n - 1, exacto)
  const r = await pedirHttp(url, 120_000)

  // Un 500 de SAMAI no es un cambio de marcado. Su backend responde
  // «The wait operation timed out» cuando la consulta agota el tiempo en su
  // base de datos, y sin esta comprobación el canario culpaba a la estructura
  // del portal y mandaba a actualizar la extensión, que no arregla nada.
  if (r.status >= 500) {
    throw new Error(
      `SAMAI no respondió a tiempo (error ${r.status}): su buscador agota el tiempo con consultas amplias. ` +
        `Vuelve a intentarlo, o usa un término más específico. No es que no haya providencias.`,
    )
  }
  if (r.status !== 200) throw new Error(`SAMAI respondió ${r.status}.`)

  const res = parsear(r.cuerpo, Math.min(Math.max(limite, 1), 10), url)

  // Un 200 no prueba nada, así que el canario mira el contenido. Sin el rótulo
  // de paginación ni el armazón de resultados la respuesta ni siquiera es la
  // página de resultados: eso es un cambio de marcado, no un "no hay nada". Con
  // armazón y sin filas es cero resultados (medido con «qwertyzzz»: 200, sin
  // rótulo, con `ResultadoBusqueda1`), el mismo criterio que `porRadicado`.
  if (res.paginas < 0) {
    if (/ResultadoBusqueda1/.test(r.cuerpo) && !new RegExp(`${RAIZ}HypRadicado_\\d+"`).test(r.cuerpo)) res.paginas = 0
    else {
      throw new CanarioError(
        'SAMAI respondió sin el rótulo de paginación: el enlace permanente de búsqueda dejó de devolver resultados',
      )
    }
  }
  // Con paginación pero sin ninguna fila legible el fallo es del parseo, y este
  // es el caso traicionero: parece "no hay providencias" y no lo es.
  if (!res.items.length && res.paginas > 0 && n <= res.paginas) {
    throw new CanarioError(
      `SAMAI dice tener ${res.paginas} página(s) de resultados pero no se pudo leer ninguna providencia ` +
        `(los identificadores del repetidor cambiaron)`,
    )
  }

  // Escalera de precisión (igual que la Suprema): la frase exacta primero y,
  // solo si no devuelve nada y el texto tiene más de una palabra, se amplía a
  // OR — y se dice que se amplió. Sin esto, "no existe esa frase" se lee como
  // "no hay nada sobre esto", que son cosas distintas y la segunda es falsa.
  if (!res.items.length && exacto && q.trim().split(/\s+/).length > 1) {
    const urlOr = enlaceBusqueda(q, n - 1, false)
    const r2 = await pedirHttp(urlOr, 120_000)
    if (r2.status >= 500) {
      throw new Error(
        `SAMAI no respondió a tiempo (error ${r2.status}) en la búsqueda ampliada. Vuelve a intentarlo.`,
      )
    }
    if (r2.status === 200) {
      const resOr = parsear(r2.cuerpo, Math.min(Math.max(limite, 1), 10), urlOr)
      if (resOr.items.length) {
        return {
          ...resOr,
          pagina: n,
          url: urlOr,
          omitidos: 0,
          ampliada: true,
          nota:
            `AVISO: la frase exacta "${q}" no apareció en ninguna providencia de esta página. Lo que sigue es una ` +
            `búsqueda AMPLIADA, con las palabras unidas por OR, así que puede incluir providencias que solo ` +
            `comparten alguna palabra suelta y el número de páginas NO mide pertinencia. Verifica la pertinencia ` +
            `de cada una antes de citarla.`,
        }
      }
    }
  }

  // SAMAI une los términos con OR, así que exigir TODOS es un filtro local sobre
  // el texto que el buscador publica. De la página pedida solo quedan las
  // providencias que tratan todo el asunto, no las que rozan una palabra.
  // En el modo ampliado (OR) no se exigen todos: la ampliación ya es el aviso.
  const { items, exigidos, omitidos } = exacto
    ? contienenTodas(res.items, q)
    : { items: res.items, exigidos: [] as string[], omitidos: 0 }
  const nota =
    exacto && exigidos.length >= 2
      ? `Se exigieron TODOS los términos (${exigidos.join(', ')}) sobre el problema jurídico, la respuesta y la nota ` +
        `de relatoría: esto es un filtro local de pertinencia.`
      : !exacto
        ? `Modo ampliado (OR): el número de páginas NO mide pertinencia, solo cuántas providencias contienen ` +
          `alguna de las palabras. Repite con exacto=true para contar la frase.`
        : undefined

  return { ...res, items, pagina: n, url, ...(nota ? { nota } : {}), omitidos }
}

/**
 * Providencias tituladas de UN radicado concreto, sin depender de la paginación.
 *
 * `buscar` no sirve para esto y no es culpa del portal: su canario exige el
 * rótulo `PaginaActualLabel`, y medido el 2026-09-28 ese rótulo NO aparece
 * cuando la consulta es un radicado —ni con la providencia buscada (HTTP 200,
 * 129.526 bytes) ni sin ninguna (HTTP 200, ~21.876 bytes)—, así que lanzaba
 * `CanarioError` en los dos casos. El fallo era del canario. Aquí el canario
 * mira otra cosa: el armazón de resultados (`ResultadoBusqueda1`) y las filas
 * del repetidor, que sí vienen en las dos respuestas.
 *
 * SAMAI tokeniza la consulta, así que la frase puede traer vecinos: se filtra
 * por identidad y solo salen las providencias cuyo radicado coincide con el
 * pedido. Y un vacío con armazón NO es un fallo: significa que SAMAI no tiene
 * titulada ninguna providencia de ese proceso, que es distinto de que el
 * proceso no exista (solo titula una parte).
 */
export async function porRadicado(formateado: string): Promise<{ items: Providencia[]; url: string }> {
  // Una sola página: el radicado es una frase, no una consulta que recorra
  // miles de resultados. Va CON guiones, que es como SAMAI lo indexa.
  const url = enlaceBusqueda(formateado, 0, true)
  const r = await pedir(url, 120_000)

  // Mismo trato que `buscar`: un 500 es su consulta agotando el tiempo, no un
  // cambio de marcado, y culpabilizar al parser manda a actualizar la extensión.
  if (r.status >= 500) {
    throw new Error(
      `SAMAI no respondió a tiempo (error ${r.status}): su buscador agota el tiempo con consultas amplias. ` +
        `Vuelve a intentarlo. No es que no haya providencias.`,
    )
  }
  if (r.status !== 200) throw new Error(`SAMAI respondió ${r.status}.`)

  const res = parsear(r.cuerpo, 10, url)
  // Las filas del repetidor se cuentan del HTML crudo, no de `items`: si están
  // pero no se leen, `items` viene vacío y hay que distinguir ese caso del vacío
  // legítimo.
  const hayFilas = new RegExp(`${RAIZ}HypRadicado_\\d+"`).test(r.cuerpo)
  const hayArmazon = /ResultadoBusqueda1/.test(r.cuerpo)

  // Sin el armazón la respuesta ni siquiera es la página de resultados: es un
  // cambio de marcado, no un "no hay nada".
  if (!res.items.length && !hayArmazon) {
    throw new CanarioError(
      'SAMAI respondió sin el armazón de resultados: el enlace permanente de búsqueda dejó de devolver resultados',
    )
  }
  // Con armazón y filas del repetidor, pero ninguna legible, el fallo es del
  // parseo: este es el caso traicionero, parece "no hay providencias" y no lo es.
  if (!res.items.length && hayFilas) {
    throw new CanarioError(
      `SAMAI devolvió filas de resultados pero no se pudo leer ninguna providencia ` +
        `(los identificadores del repetidor cambiaron)`,
    )
  }

  const pedido = formateado.replace(/\D/g, '')
  const items = res.items.filter((p) => p.radicado.replace(/\D/g, '') === pedido)
  return { items, url }
}
