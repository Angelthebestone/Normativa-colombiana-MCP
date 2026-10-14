/** `obtener_documento` con fuente="gestor": norma del Gestor Normativo, artículo, historial y temas. */
import { advertenciasVigencia } from '../../nucleo/parse/vigencia.ts'
import { articulo as extraerArticulo, indiceArticulos } from '../../nucleo/parse/articulos.ts'
import { fragmentos, trocear } from '../../nucleo/parse/fragmentos.ts'
import { historial } from '../../nucleo/parse/historial.ts'
import { normalizarRotulo, sinTildes } from '../../nucleo/parse/texto.ts'
import { NoExisteError } from '../../nucleo/parse/errores.ts'
import * as gestor from '../../fuentes/gestor/index.ts'
import { esCompiladora, avisoCompiladora } from '../../nucleo/compiladas.ts'
import { citaNorma } from '../../nucleo/cita_oficial/index.ts'
import { analizarVacancia, enVacancia } from '../../nucleo/vacancia/index.ts'
import type { Resueltas } from './esquema.ts'
import { conOrigen, mencionesDe, reanudar, sinTexto } from './formato.ts'

// --- fuentes --------------------------------------------------------------

/**
 * Dos líneas que el modelo no debe componer ni adivinar: la cita oficial de la norma, armada solo con lo que la
 * ficha trae (lo que no consta se declara), y su vigencia diferida cuando la hay. La vigencia sale del propio
 * artículo de vigencia y solo se anuncia cuando hay algo que advertir —escalonada, relativa o todavía pendiente—:
 * repetir «rige desde su publicación» en cada norma sería ruido, y una norma «en vacancia» tratada como exigible
 * hoy es el error caro.
 */
function lineasDeCitaYVigencia(n: Awaited<ReturnType<typeof gestor.obtenerNorma>>): string[] {
  const lineas: string[] = []
  const cita = citaNorma({ titulo: n.titulo, fechas: n.fechas })
  if (cita) {
    lineas.push(`Cita oficial: ${cita.cita}${cita.faltan.length ? ` (no consta en la ficha: ${cita.faltan.join(', ')})` : ''}`)
  }
  const v = analizarVacancia(n.texto)
  const pendiente = enVacancia(v)
  if (v.clase !== 'inmediata' && v.clase !== 'no-encontrada' && pendiente !== false) {
    lineas.push(
      `${pendiente ? 'AÚN NO RIGE — ' : ''}Vigencia según su propio artículo de vigencia (art. ${v.articulo.numero}): ${v.resumen}`,
    )
  }
  return lineas
}

export async function gestorDocumento(p: Resueltas, tope: number): Promise<string> {
  if (!p.id) throw new Error('Para fuente="gestor" hace falta id.')
  let n: Awaited<ReturnType<typeof gestor.obtenerNorma>>
  try {
    n = await gestor.obtenerNorma(p.id)
  } catch (e) {
    if (e instanceof NoExisteError) return `No encontré una norma con id ${p.id}. Verifica el id con buscar_normas o resolver_cita.`
    throw e
  }

  const anioTitulo = n.titulo.match(/\bde\s+((?:19|20)\d{2})\b/)?.[1]
  const anioVigencia = Object.entries(n.fechas)
    .find(([k]) => /entrada\s+en\s+vigencia/i.test(k))?.[1]
    ?.match(/\b((?:19|20)\d{2})\b/)?.[1]
  const desajuste =
    anioTitulo && anioVigencia && anioVigencia !== anioTitulo
      ? `\nOJO CON ESE CAMPO: el portal fecha la entrada en vigencia en ${anioVigencia} para una norma de ` +
        `${anioTitulo}. Es su dato, no una comprobación de esta extensión, y en las normas compiladas no consta ` +
        `qué mide: no lo cites como fecha de expedición ni como prueba de que rige.`
      : ''
  const fechas = Object.entries(n.fechas)
  const cab = [
    n.titulo,
    ...(fechas.length ? ['Ficha del portal (campos del Gestor, copiados sin interpretar):'] : []),
    ...fechas.map(([k, v]) => `  ${k}: ${v || '(vacío en el portal)'}`),
    `URL: ${n.url}`,
    `PDF: ${n.urlPdf}`,
    ...lineasDeCitaYVigencia(n),
  ].join('\n') + desajuste

  if (n.texto.length < 200) {
    return `${cab}\n\n${sinTexto(n.texto.length, n.urlPdf, await gestor.pdfEscaneado(n.id))}`
  }

  if (p.historial) {
    const ambito = p.articulo ? extraerArticulo(n.texto, p.articulo) : n.texto
    if (p.articulo && !ambito) {
      return `${cab}\n\nNo encontré el artículo ${p.articulo}. Artículos detectados: ${indiceArticulos(n.texto).join(', ') || '(ninguno)'}`
    }
    const cambios = historial(ambito!)
    const donde = p.articulo ? `el artículo ${p.articulo}` : 'esta norma'
    if (!cambios.length) {
      return (
        `${cab}\n\nLas notas del Gestor no registran cambios sobre ${donde}. Eso NO equivale a que siga intacto: ` +
        `el portal no siempre anota las reformas, y la vigencia se consulta con resolver_cita.`
      )
    }
    return (
      `${cab}\n\n${cambios.length} cambio(s) anotados sobre ${donde}, en el orden en que aparecen en el documento:\n\n` +
      cambios
        .map(
          (c) =>
            `- ${c.accion.toUpperCase()}${c.norma ? ` por ${c.norma} de ${c.anio}` : ''}` +
            `${c.articulo ? `, artículo ${c.articulo}` : ''}\n  Nota literal: «${c.literal}»`,
        )
        .join('\n') +
      `\n\nSon las notas que el propio portal incrusta en el texto, citadas tal cual. No están ordenadas por ` +
      `fecha ni se deduce cuál rige hoy: para eso hay que leer el artículo y comprobar la vigencia.`
    )
  }

  const compiladora = !p.articulo && !p.buscar_en_texto && esCompiladora(n.titulo, n.texto.length)

  let cuerpo: string
  let avisoTexto = ''
  // El artículo pedido se trocea como el documento entero (tope y `desde`).
  let art: string | null = null

  if (p.articulo) {
    art = extraerArticulo(n.texto, p.articulo)
    if (!art) {
      const arts = indiceArticulos(n.texto)
      return (
        `${cab}\n\nNo encontré el artículo ${p.articulo}. ` +
        (arts.length ? `Artículos detectados: ${arts.join(', ')}. Repite con articulo= y uno de esos.` : 'No se detectó ningún artículo en el texto.')
      )
    }
  }
  if (p.buscar_en_texto && !art) {
    const f = fragmentos(n.texto, p.buscar_en_texto, 400, p.max_pasajes ?? 10, tope)
    if (!f.total) {
      // El vacío enseña: dice qué se buscó, sobre cuánto texto, y por dónde
      // seguir sin tener que adivinar ni volver a pedir la norma entera.
      const arts = indiceArticulos(n.texto)
      return (
        `${cab}\n\nEl término "${p.buscar_en_texto}" no aparece en el texto de esta norma ` +
        `(${n.texto.length} caracteres revisados). La búsqueda es literal, sin sinónimos ni lematización: ` +
        `prueba otra forma de la palabra, o pide el artículo por su número.` +
        (arts.length ? `\nArtículos detectados: ${arts.join(', ')}` : '')
      )
    }
    cuerpo = f.trozos.join('\n\n---\n\n')
    avisoTexto =
      `${f.total} aparición(es) de "${p.buscar_en_texto}", agrupadas en ${f.pasajes} pasaje(s); se muestran ${f.mostrados}` +
      (f.mostrados < f.pasajes ? ` (los demás no caben en ${tope} caracteres: sube limite_caracteres o afina el término).` : '.')
  } else {
    const t = trocear(art ?? n.texto, p.desde, tope)
    cuerpo = t.texto
    const arts = art ? [] : indiceArticulos(n.texto)
    avisoTexto =
      `Texto total: ${t.total} caracteres. Se muestran ${t.texto.length} desde la posición ${t.desde}` +
      (t.omitido > 0 ? `; quedan ${t.omitido} sin mostrar.\n${reanudar(p, t.desde + t.texto.length)}.` : '.') +
      (t.texto.length === 0 && t.total > 0
        ? `\nEl "desde" (${p.desde}) está más allá del final del ${art ? 'artículo' : 'texto'}: pide uno menor${art ? '' : ' o usa buscar_en_texto'}.`
        : '') +
      (arts.length ? `\nArtículos detectados: ${arts.join(', ')}` : '')
  }

  // Las notas de vigencia van al final del artículo: se leen sobre el artículo
  // completo, no sobre el trozo mostrado, o se perderían al recortarlo.
  const avisos = advertenciasVigencia(art ?? cuerpo)
  const aguja = sinTildes(p.buscar_en_texto ?? p.articulo ?? '').toLowerCase().trim()
  const pertinente = (t: (typeof n.temas)[number]) =>
    Number(sinTildes(`${t.tema} ${t.subtema} ${t.restrictor}`).toLowerCase().includes(aguja))
  const ordenados = aguja ? [...n.temas].sort((a, b) => pertinente(b) - pertinente(a)) : n.temas
  const cuantosTemas = tope < 2000 ? 3 : 10

  // El bloque de temas es costoso (en un artículo puntual ocupa varias veces
  // lo que ocupa el artículo) y casi siempre ruido: se puede omitir.
  const temas =
    p.sin_temas || !ordenados.length
      ? p.sin_temas
        ? '\n\n(Bloque de temas asociados omitido con sin_temas=true.)'
        : ''
      : `\n\nTemas asociados (${Math.min(cuantosTemas, ordenados.length)} de ${ordenados.length}` +
        `${aguja ? ', primero los que mencionan lo buscado' : ', sin ordenar por relevancia'}):\n` +
        ordenados
          .slice(0, cuantosTemas)
          .map((t) => `- ${normalizarRotulo(t.tema)} / ${normalizarRotulo(t.subtema)}: ${t.restrictor}`)
          .join('\n')

  return (
    `${cab}\n${compiladora ? `\n${avisoCompiladora(n.titulo, n.texto)}\n` : ''}${avisoTexto ? `\n${avisoTexto}\n` : ''}${avisos.length ? `\n${avisos.join('\n')}\n` : ''}` +
    `\n--- Texto ---\n${conOrigen(cuerpo, n.url)}${temas}${mencionesDe(cuerpo)}`
  )
}
