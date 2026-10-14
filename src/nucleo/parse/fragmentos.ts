import { sinTildes } from './texto.ts'

// --- troceado y búsqueda dentro del texto --------------------------------

export type Trozo = { texto: string; total: number; desde: number; omitido: number }

export function trocear(texto: string, desde = 0, limite = 8000): Trozo {
  const ini = Math.max(0, Math.min(desde, texto.length))
  const fin = Math.min(texto.length, ini + limite)
  return { texto: texto.slice(ini, fin), total: texto.length, desde: ini, omitido: texto.length - fin }
}

/**
 * Búsqueda de texto completo del lado del cliente: el buscador del portal solo
 * indexa los resúmenes temáticos, así que es aquí donde realmente se busca
 * dentro del articulado.
 */
export function fragmentos(
  texto: string,
  termino: string,
  contexto = 400,
  max = 10,
  presupuesto = Number.POSITIVE_INFINITY,
) {
  const plano = sinTildes(texto).toLowerCase()
  const aguja = sinTildes(termino).toLowerCase().trim()
  if (!aguja) return { total: 0, trozos: [] as string[], inicios: [] as number[], pasajes: 0, mostrados: 0 }

  // Ventanas solapadas se fusionan: dos coincidencias cercanas producían seis
  // extractos casi idénticos y hacían leer lo mismo varias veces.
  const ventanas: { ini: number; fin: number; hits: number; primera: number }[] = []
  let total = 0
  for (let i = plano.indexOf(aguja); i !== -1; i = plano.indexOf(aguja, i + aguja.length)) {
    total++
    const ini = Math.max(0, i - contexto)
    const fin = Math.min(texto.length, i + aguja.length + contexto)
    const ultima = ventanas.at(-1)
    if (ultima && ini <= ultima.fin) {
      ultima.fin = Math.max(ultima.fin, fin)
      ultima.hits++
    } else {
      // `primera` es la posición de la coincidencia, no la de la ventana: quien
      // rotula el pasaje necesita saber dónde cae el término, no dónde empieza
      // el contexto, que puede haber cruzado una frontera de sección.
      ventanas.push({ ini, fin, hits: 1, primera: i })
    }
  }

  // El presupuesto de caracteres manda sobre el número de pasajes: sin él, diez
  // pasajes fusionados pueden superar los 18.000 caracteres justo en las normas
  // grandes, que son las que este troceado existe para poder manejar.
  const trozos: string[] = []
  const inicios: number[] = []
  let gastado = 0
  for (const v of ventanas.slice(0, max)) {
    if (gastado >= presupuesto) break
    const margen = presupuesto - gastado
    let cuerpo = texto.slice(v.ini, v.fin).trim()
    if (cuerpo.length > margen) cuerpo = `${cuerpo.slice(0, Math.max(0, margen - 1)).trimEnd()}…`
    const trozo =
      (v.ini > 0 ? '…' : '') +
      cuerpo +
      (v.fin < texto.length ? '…' : '') +
      (v.hits > 1 ? `\n[${v.hits} coincidencias en este pasaje]` : '')
    trozos.push(trozo)
    inicios.push(v.primera)
    gastado += cuerpo.length
  }

  return { total, trozos, inicios, pasajes: ventanas.length, mostrados: trozos.length }
}
