/**
 * Los tres catálogos temáticos del portal numeran cada uno por su cuenta, así
 * que el mismo entero existe en los tres queriendo decir cosas distintas: el
 * 38968 es «Teletrabajo durante jornada día sin carro» en listar_catalogos
 * (catalogo="subtemas") e «INHABILIDADES E INCOMPATIBILIDADES / Ex Diputados» en el de buscar_por_tema.
 * Advertirlo en las descripciones no bastaba: un id cruzado no fallaba, contestaba
 * por el subtema equivocado con el mismo aire de certeza. Con el prefijo pegado
 * al id, cruzarlos es un error explícito y no una respuesta creíble sobre otra cosa.
 */
const CATALOGOS = {
  ts: { de: 'buscar_por_tema', ejemplo: 'ts-38872' },
  sub: { de: 'listar_catalogos con catalogo="subtemas"', ejemplo: 'sub-38968' },
  tema: { de: 'listar_catalogos con catalogo="temas"', ejemplo: 'tema-24457' },
} as const
export type Catalogo = keyof typeof CATALOGOS

export const conPrefijo = (c: Catalogo, id: string | number): string => `${c}-${id}`

/** Filtros que aceptan el nombre o el id: solo lo que parece un id pasa por la aduana. */
export const idOnombre = (c: Catalogo, valor: string | undefined): string | undefined =>
  valor && /^([a-z]+-)?\d+$/i.test(valor.trim()) ? sinPrefijo(c, valor) : valor

/** Devuelve el número que entiende el portal, o explica de qué catálogo salió el id equivocado. */
export function sinPrefijo(c: Catalogo, valor: string): string {
  const v = valor.trim()
  const propio = v.match(new RegExp(`^${c}-(\\d+)$`, 'i'))
  if (propio) return propio[1]!
  const ajeno = (Object.keys(CATALOGOS) as Catalogo[]).find((k) => new RegExp(`^${k}-\\d+$`, 'i').test(v))
  throw new Error(
    `"${valor}" no sirve aquí: este parámetro lleva un id de ${CATALOGOS[c].de}, que se escribe como ` +
      `"${CATALOGOS[c].ejemplo}". ` +
      (ajeno
        ? `El prefijo "${ajeno}-" lo emite ${CATALOGOS[ajeno].de}, que es OTRA taxonomía del portal: sus números ` +
          `coinciden con los de esta y significan otra cosa, así que antes esto respondía por el tema equivocado.`
        : `Los ids pelados no se aceptan justo para que no se puedan cruzar los tres catálogos temáticos del ` +
          `portal, que reutilizan los mismos números. Pide el id a ${CATALOGOS[c].de} y pégalo con su prefijo.`),
  )
}
