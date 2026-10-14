import { sinTildes } from '../parse/texto.ts'
import { fechaBogota } from '../fecha.ts'
import { esTituloDeVigencia, partirEnArticulos } from './articulos.ts'
import { RE_FORMULA_PROPIA, clausulasDe, isoCanonico, publicacionEnNota, type Clausula } from './clausulas.ts'
import { sumarDias, sumarMeses, fechaLarga } from './fechas.ts'

export type ClaseVacancia =
  | 'inmediata'
  | 'fecha-fija'
  | 'relativa'
  | 'escalonada'
  | 'no-determinada'
  | 'no-encontrada'

export type Vacancia = {
  /** El artículo analizado, con su número y texto literal (recortado a lo necesario). */
  articulo: { numero: string; texto: string }
  clase: ClaseVacancia
  /** ISO AAAA-MM-DD; solo con `fecha-fija` (o `relativa` con fecha de publicación conocida). */
  desde?: string
  /** Frase lista para la respuesta, en prosa prudente. */
  resumen: string
}

// --- análisis --------------------------------------------------------------

const RECORTE = 1400

export function analizarVacancia(texto: string, opciones: { publicacion?: string; hoy?: Date } = {}): Vacancia {
  const hoy = opciones.hoy ?? new Date()
  const plano = sinTildes(texto)
  const recorta = (s: string): string => {
    const t = s.length > RECORTE ? `${s.slice(0, RECORTE)}…` : s
    return t.replace(/\n{3,}/g, '\n\n').trim()
  }

  const candidatos = partirEnArticulos(plano)
    .map((a) => ({ ...a, plano: plano.slice(a.desde, a.hasta) }))
    .filter((a) => esTituloDeVigencia(a.titulo) || RE_FORMULA_PROPIA.test(a.plano))
    .map((a) => ({ ...a, clausulas: clausulasDe(a.plano, texto.slice(a.desde, a.hasta)) }))

  if (!candidatos.length) {
    return {
      articulo: { numero: '', texto: '' },
      clase: 'no-encontrada',
      resumen:
        'No se encontró un artículo de vigencia en el texto analizado. Puede venir recortado o usar una fórmula que ' +
        'este análisis no reconoce, así que la ausencia NO significa que la norma no tenga reglas de entrada en vigor: ' +
        'consulta el texto completo de la norma.',
    }
  }

  const elegido = [...candidatos].reverse().find((a) => a.clausulas.length) ?? candidatos.at(-1)!
  const todas = candidatos.flatMap((a) => a.clausulas)
  const base = { articulo: { numero: elegido.numero, texto: recorta(texto.slice(elegido.desde, elegido.hasta)) } }

  if (!todas.length) {
    const cita = recorta(texto.slice(elegido.desde, Math.min(elegido.hasta, elegido.desde + 600)).replace(/\s+/g, ' '))
    return {
      ...base,
      clase: 'no-determinada',
      resumen:
        `Hay artículo de vigencia (artículo ${elegido.numero}), pero de su texto no se desprende una fecha cierta ` +
        `—puede remitir a otra norma o depender de un hecho—. Se cita literal: «${cita}».`,
    }
  }

  const conClausulas = candidatos.filter((a) => a.clausulas.length)
  const fechas = [...new Set(todas.filter((c) => c.tipo === 'fecha').map((c) => c.iso!))]
  const relativas = todas.filter((c) => c.tipo === 'relativa')
  const inmediata = todas.find((c) => c.tipo === 'inmediata')
  const determinaciones = (inmediata ? 1 : 0) + fechas.length + new Set(relativas.map((c) => `${c.plazo} ${c.unidad}`)).size

  const deOpciones = isoCanonico(opciones.publicacion)
  const publicacion = deOpciones ?? publicacionEnNota(plano)
  const deLaNota = deOpciones === undefined && publicacion !== null

  if (determinaciones === 1 && inmediata) {
    return {
      ...base,
      clase: 'inmediata',
      resumen:
        `Su artículo de vigencia (artículo ${elegido.numero}) dice que rige desde ${inmediata.ancla}: no hay entrada ` +
        'en vigor diferida, así que la norma quedó exigible desde ese momento y no está en vacancia.',
    }
  }

  if (determinaciones === 1 && fechas.length === 1) {
    const desde = fechas[0]!
    const c = todas.find((x) => x.tipo === 'fecha')!
    const llego = fechaBogota(hoy) >= desde
    return {
      ...base,
      clase: 'fecha-fija',
      desde,
      resumen:
        `Su artículo de vigencia (artículo ${elegido.numero}) fija un día, no un plazo: «${c.cita}». ` +
        (llego
          ? `Esa fecha ya llegó, así que rige desde el ${fechaLarga(desde)}.`
          : `Todavía no rige: entra a regir el ${fechaLarga(desde)}.`),
    }
  }

  if (determinaciones === 1 && relativas.length === 1) {
    const c = relativas[0]!
    if (!publicacion) {
      return {
        ...base,
        clase: 'relativa',
        resumen:
          `Su artículo de vigencia (artículo ${elegido.numero}) no fija un día, sino un plazo: «${c.cita}». ` +
          'Falta la fecha de publicación para calcularlo, así que la fecha de exigibilidad queda indeterminada: ' +
          'búscala en la ficha de la norma (campo «Medio de Publicación») o en la nota del Diario Oficial al final ' +
          'del texto, y repite el análisis con ella.',
      }
    }
    const desde = c.unidad === 'dias' ? sumarDias(publicacion, c.plazo!) : sumarMeses(publicacion, c.plazo!)
    const llego = fechaBogota(hoy) >= desde
    return {
      ...base,
      clase: 'relativa',
      desde,
      resumen:
        `Su artículo de vigencia (artículo ${elegido.numero}) no fija un día, sino un plazo: «${c.cita}». ` +
        `Contado desde la publicación (${fechaLarga(publicacion)}${deLaNota ? ', fecha que trae la nota del Diario Oficial al final del texto' : ''}), ` +
        `rige desde el ${fechaLarga(desde)}. ` +
        (llego ? 'Esa fecha ya llegó.' : 'Todavía no rige: su exigibilidad empieza ese día.'),
    }
  }

  const variosArticulos = conClausulas.length > 1
  const numeroDe = (c: Clausula): string => (variosArticulos ? ` (artículo ${conClausulas.find((a) => a.clausulas.includes(c))!.numero})` : '')
  // Una determinación se enumera una vez: dos apartes que fijan la misma fecha
  // (los dos impuestos saludables de la Ley 2277) no son dos tramos.
  const clave = (c: Clausula): string =>
    c.tipo === 'inmediata' ? 'inmediata' : c.tipo === 'fecha' ? `fecha:${c.iso}` : `relativa:${c.plazo}:${c.unidad}`
  const items = todas
    .filter((c, i) => todas.findIndex((x) => clave(x) === clave(c)) === i)
    .map((c) => {
      const con = c.sujeto ? `${c.sujeto}, ` : ''
      if (c.tipo === 'inmediata') return `${con}desde ${c.ancla}${numeroDe(c)}`
      if (c.tipo === 'fecha') return `${con}a partir del ${fechaLarga(c.iso!)}${numeroDe(c)}`
      return `${con}${c.cita}${publicacion ? ` (contado desde la publicación, ${fechaLarga(publicacion)})` : ' (falta la fecha de publicación para calcularlo)'}${numeroDe(c)}`
    })
  return {
    ...base,
    clase: 'escalonada',
    resumen:
      `No entra en vigor en un solo tramo: ${items.join('; ')}. Es lo que dice el texto, y cada tramo tiene su fecha: ` +
      `para el detalle, lee el artículo ${elegido.numero} tal como se transcribe, y si buscas la suerte de un artículo ` +
      'concreto, ten en cuenta que puede estar en cualquiera de los tramos.',
  }
}

/** ¿A `hoy`, la norma sigue en vacancia? true/false, o null si no se puede afirmar. */
export function enVacancia(v: Vacancia, hoy: Date = new Date()): boolean | null {
  if (v.clase === 'inmediata') return false
  if (!v.desde) return null
  return fechaBogota(hoy) < v.desde
}
