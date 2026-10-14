import { BASE_GESTOR, parseResultados, type Resultado } from '../../nucleo/parse/gestor.ts'
import { sinTildes, tieneTildes } from '../../nucleo/parse/texto.ts'
import { obtener, poner, TTL_BUSQUEDA_MS } from '../../nucleo/cache.ts'
import { entero, traer } from './portal.ts'
import { resolver } from './catalogos.ts'
import { subtemas } from './documentos.ts'
import { contienenTodos, quitarStopwords } from './terminos.ts'

export type Filtros = {
  palabras?: string | undefined
  /**
   * `true`: el resultado solo conserva los documentos que contienen TODOS los
   * términos (filtro local sobre título+resumen, sin tildes). Por defecto el
   * portal une con OR, como en la web.
   */
  todos?: boolean | undefined
  tipo?: string | number | undefined
  numero?: string | number | undefined
  anio?: string | number | undefined
  entidad?: string | number | undefined
  tema?: string | number | undefined
  subtema?: string | number | undefined
}

/**
 * La búsqueda avanzada del portal, con su respuesta recordada `TTL_BUSQUEDA_MS`: nueve herramientas
 * pasan por aquí y el flujo de verificar una cita (resolver_cita, consultar_vigencia, analizar_conflicto…)
 * repetía la misma búsqueda por norma. Solo se recuerda lo que devolvió resultados: un vacío puede ser un
 * fallo pasajero del portal y se vuelve a preguntar. Se guardan y devuelven copias del arreglo, porque los
 * llamadores lo ordenan y recortan.
 */
async function consultar(
  p: URLSearchParams,
  termino = '',
  leer: (url: string) => Promise<string> = traer,
): Promise<{ total: number; items: Resultado[] }> {
  p.set('t', 'ejecuta_busqueda_avanzada2')
  const clave = `gestor:buscar:${p}|${termino}`
  const guardado = obtener(clave) as { total: number; items: Resultado[] } | null
  if (guardado) return { total: guardado.total, items: [...guardado.items] }
  const r = parseResultados(await leer(`${BASE_GESTOR}/gestion/funphp/funajax.php?${p}`), termino)
  if (r.items.length) poner(clave, { total: r.total, items: [...r.items] }, TTL_BUSQUEDA_MS)
  return r
}

/**
 * Traduce un par tema/subtema (por nombre) al `subtemaid` que entiende el
 * buscador. Es la vía que de verdad encuentra: `palabras=teletrabajo` devuelve
 * 3 documentos en todo el portal, mientras que el subtema correspondiente
 * devuelve 55, de los cuales 43 son conceptos.
 *
 * Ojo: el `temsubid` de la consulta temática es OTRO espacio de ids y no sirve
 * como `subtemaid`.
 */
export async function subtemaPorNombre(tema: string, subtema: string): Promise<string | undefined> {
  const idTema = await resolver(tema, 'temas')
  if (!idTema) return undefined
  const objetivo = sinTildes(subtema).toLowerCase()
  const lista = await subtemas(idTema)
  return (
    lista.find((s) => sinTildes(s.nombre).toLowerCase() === objetivo)?.id ??
    lista.find((s) => sinTildes(s.nombre).toLowerCase().includes(objetivo))?.id
  )
}

export async function buscar(
  f: Filtros,
  deps: { leer?: (url: string) => Promise<string> } = {},
): Promise<{ total: number; items: Resultado[]; nota?: string | undefined; aplicados: string[] }> {
  const p = new URLSearchParams()
  const notas: string[] = []
  // Qué filtros se aplicaron de verdad: sin esto, un cero por combinación
  // inexistente es indistinguible de un filtro que no se supo resolver.
  const aplicados: string[] = []

  if (f.palabras) {
    const { usadas, descartadas } = quitarStopwords(f.palabras)
    p.set('palabras', usadas)
    if (descartadas.length) notas.push(`Se ignoraron palabras vacías (${descartadas.join(', ')}): el buscador del portal las une con OR e inundan el resultado.`)
  }
  for (const [etiqueta, valor, campo, cual] of [
    ['tipo', f.tipo, 'tipdoc', 'tipos'],
    ['entidad', f.entidad, 'entidad1', 'entidades'],
    ['tema', f.tema, 'temarl', 'temas'],
  ] as const) {
    if (valor === undefined || valor === '') continue
    const id = await resolver(valor, cual)
    if (id) {
      p.set(campo, id)
      aplicados.push(`${etiqueta}="${valor}" (id ${id})`)
    } else {
      notas.push(`No reconocí ${etiqueta} "${valor}"; se ignoró. Consulta los valores válidos con listar_catalogos.`)
    }
  }
  const num = entero(f.numero)
  const an = entero(f.anio)

  // El subtema admite el id o el nombre. Por nombre hace falta el tema, porque
  // los subtemas no son únicos en el portal: "Teletrabajo" cuelga de varios.
  let sub = entero(f.subtema)
  if (!sub && f.subtema) {
    if (!f.tema) {
      notas.push(
        `Para usar el subtema por nombre ("${f.subtema}") hace falta indicar también el tema; ` +
          `si no, usa el id numérico que devuelve listar_catalogos con catalogo="subtemas".`,
      )
    } else {
      sub = await subtemaPorNombre(String(f.tema), String(f.subtema))
      if (!sub) notas.push(`No encontré el subtema "${f.subtema}" dentro del tema "${f.tema}"; se ignoró.`)
    }
  }
  if (num) {
    p.set('nrodoc', num)
    aplicados.push(`número=${num}`)
  }
  if (an) {
    p.set('ano', an)
    aplicados.push(`año=${an}`)
  }
  if (sub) {
    p.set('subtemaid', sub)
    aplicados.push(`subtema=${sub}`)
  }
  if (f.palabras) aplicados.push(`palabras="${p.get('palabras')}"`)

  if (![...p.keys()].length) {
    // Si algún filtro se descartó, el motivo explica más que un error genérico.
    throw new Error(
      notas.length
        ? `No quedó ningún filtro aplicable. ${notas.join(' ')}`
        : 'Indica al menos un filtro o unas palabras para buscar.',
    )
  }

  let { total, items } = await consultar(p, f.palabras ?? '', deps.leer)

  // `gestión` (18 resultados) y `gestion` (3) son conjuntos distintos: el portal
  // no normaliza tildes, así que se consultan ambas y se unen.
  if (f.palabras && tieneTildes(p.get('palabras') ?? '')) {
    const p2 = new URLSearchParams(p)
    p2.set('palabras', sinTildes(p.get('palabras')!))
    try {
      const otra = await consultar(p2, f.palabras ?? '', deps.leer)
      const vistos = new Set(items.map((i) => i.id))
      const extra = otra.items.filter((i) => !vistos.has(i.id))
      if (extra.length) {
        items = [...items, ...extra]
        total += extra.length
        notas.push('Se unieron los resultados con y sin tildes: el portal los trata como búsquedas distintas.')
      }
    } catch {
      /* la variante sin tildes es un extra; si falla, seguimos con lo que hay */
    }
  }

  // El buscador une los términos con OR: conviene saber cuáles aparecieron de
  // verdad, o "zopilote interconectado" parece haber encontrado zopilotes.
  if (f.palabras && items.length) {
    const heno = sinTildes(items.map((i) => `${i.titulo} ${i.resumen}`).join(' ')).toLowerCase()
    const ausentes = (p.get('palabras') ?? '')
      .split(' ')
      .filter((t) => t && !heno.includes(sinTildes(t).toLowerCase()))
    if (ausentes.length) {
      notas.push(
        `Atención: ${ausentes.map((t) => `"${t}"`).join(' y ')} no aparece en ningún resultado — ` +
          `el portal une los términos con OR, así que coincidió solo el resto.`,
      )
    }
  }

  // Modo AND local: el portal consultado une con OR, así que cuando se piden
  // TODOS los términos el filtro es local y posterior, sobre título+resumen.
  if (f.todos && f.palabras && items.length) {
    const { items: filtrados, exigidos, omitidos } = contienenTodos(items, f.palabras)
    const excluidos = omitidos > 0 ? ` Se descartaron ${omitidos} por no contener todos los términos.` : ''
    notas.push(
      `Se exigieron TODOS los términos (${exigidos.join(', ')}) sobre título y resumen; ` +
        `el portal los une con OR, así que esto es un filtro local de pertinencia.${excluidos}`,
    )
    items = filtrados
    total = filtrados.length
  }

  return { total, items, nota: notas.join(' ') || undefined, aplicados }
}
