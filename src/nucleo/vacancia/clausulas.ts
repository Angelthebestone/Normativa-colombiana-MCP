import { sinTildes } from '../parse/texto.ts'
import { MES_TXT, MESES, PALABRAS_NUMERO, buscarFecha, fechaLarga, isoValido, numeroEnLetras } from './fechas.ts'

/**
 * Entrada en vigor de la propia norma dicha en prosa, sin título que la anuncie.
 * El sujeto tiene que ser la norma misma y empezar oración: «El presente Código
 * comenzará a regir el dos (2) de julio del año 2012». Sin esa exigencia, un
 * parágrafo que diga «el reglamento entrará en vigencia seis meses después» o
 * «lo dispuesto en el presente artículo entrará en vigencia…» pasaría por la
 * cláusula de la ley.
 */
export const VERBO_ENTRADA =
  String.raw`(?:rige|rigen|regir(?:a|an|e|en|ia|ian)?|entrar(?:a|an|on)?\s+(?:en\s+vigor|en\s+vigencia|a\s+regir)|entra(?:n)?\s+(?:en\s+vigor|en\s+vigencia|a\s+regir)|(?:empezar|comenzar|principiar)(?:a|an|o|on)?\s+a\s+regir)`

/** Los sujetos genéricos no aportan nada al enumerar: «la presente ley, desde su publicación». */
export const SUJETO_GENERICO =
  /^(?:la presente ley|esta ley|el presente codigo|el presente decreto|el presente acto legislativo|el presente estatuto|la presente resolucion|el presente acuerdo|la presente ordenanza|el presente reglamento)$/i

export const RE_FORMULA_PROPIA = new RegExp(
  String.raw`(?:^|[\n.;:”"'’]\s*)(?:la\s+presente\s+ley|esta\s+ley|el\s+presente\s+codigo|el\s+presente\s+decreto|el\s+presente\s+acto\s+legislativo|el\s+presente\s+estatuto|la\s+presente\s+resolucion|el\s+presente\s+acuerdo|la\s+presente\s+ordenanza|el\s+presente\s+reglamento)\s[^.;:]{0,140}?\b${VERBO_ENTRADA}\b`,
  'i',
)

export const RE_VERBO_VIGENCIA = new RegExp(String.raw`\b${VERBO_ENTRADA}\b`, 'gi')

/** «su publicación», «la promulgación»: el ancla de la que cuelga la entrada en vigor. */
export const ANCLA: Record<string, string> = {
  publicacion: 'la publicación',
  promulgacion: 'la promulgación',
  sancion: 'la sanción',
  expedicion: 'la expedición',
}

export const RE_INMEDIATA = /(su|la)\s+(publicacion|promulgacion|sancion|expedicion)/i
export const RE_RELATIVA = new RegExp(
  String.raw`(?:\((\d{1,3})\)|(\d{1,3})|(${PALABRAS_NUMERO}))\s*(?:\((\d{1,3})\)\s*)?(mes(?:es)?|anos?|dias?)\s*(?:despues\s+de|siguientes?(?:\s+(?:a|al|de))?|contados?\s+a\s+partir\s+de|de)\s+(?:su\s+|la\s+|el\s+)?(publicacion|promulgacion|sancion|expedicion|entrada\s+en\s+vigencia)`,
  'i',
)

/** Lo que frena una fecha: no es entrada en vigor sino un vencimiento. */
export const RE_VENCIMIENTO = /(?:hasta|antes\s+de(?:l)?|a\s+mas\s+tardar)\s*(?:el\s+|la\s+|los\s+|las\s+)?$/i

export type Clausula = {
  tipo: 'inmediata' | 'fecha' | 'relativa'
  /** ISO, solo en `fecha`. */
  iso?: string
  /** Plazo en meses (los años se convierten) o en días, solo en `relativa`. */
  plazo?: number
  unidad?: 'meses' | 'dias'
  /** «su publicación»: de dónde cuelga la entrada en vigor. */
  ancla: string
  /** Sujeto que encabeza la cláusula, si se pudo aislar. */
  sujeto: string
  /** Cita literal de la cláusula, desde el verbo. */
  cita: string
}

/** El sujeto que precede al verbo, si es un sintagma limpio y corto. */
export function sujetoAntes(texto: string, verbo: number): string {
  const corte = Math.max(
    texto.lastIndexOf('.', verbo - 1),
    texto.lastIndexOf(';', verbo - 1),
    texto.lastIndexOf('\n', verbo - 1),
  )
  const trozo = texto.slice(corte + 1, verbo).replace(/\s+/g, ' ').trim().replace(/[,;:.]+$/, '')
  if (trozo.length < 8 || trozo.length > 130 || SUJETO_GENERICO.test(sinTildes(trozo))) return ''
  return /^(?:El|La|Los|Las|Lo)\s/.test(trozo) ? trozo : ''
}

/** Las determinaciones de entrada en vigor que contiene el artículo de vigencia. */
export function clausulasDe(plano: string, texto: string): Clausula[] {
  const clausulas: Clausula[] = []
  const cita = (a: number, b: number): string => texto.slice(a, b).replace(/\s+/g, ' ').trim()
  for (const v of plano.matchAll(RE_VERBO_VIGENCIA)) {
    const ini = v.index!
    if (/\bse\s+$/i.test(plano.slice(Math.max(0, ini - 3), ini))) continue // «se regirá por…» remite, no fecha
    const tras = ini + v[0].length
    // ponytail: la determinación se busca en los 280 caracteres que siguen al
    // verbo, que es donde cae en todo lo medido (la más lejana, «rige a partir
    // del primero (1) de noviembre de 2023» precedida del nombre del impuesto,
    // cabe en ~230). Techo: una cláusula que enumere dos párrafos entre el verbo
    // y su fecha; el salto sería analizar por oración, no por ventana.
    const ventana = plano.slice(tras, tras + 280)
    const rel = ventana.match(RE_RELATIVA)
    const inm = ventana.match(RE_INMEDIATA)
    const fec = buscarFecha(ventana)
    // Gana lo que el texto pone primero después del verbo: en «rige desde su
    // publicación, salvo el artículo 5, que rige desde el 1 de enero de 2026»
    // cada verbo se queda con su propia determinación.
    const opciones: { pos: number; c: Clausula }[] = []
    if (rel && rel.index !== undefined) {
      const n = Number(rel[1] ?? rel[2] ?? '') || numeroEnLetras(rel[3] ?? '') || Number(rel[4] ?? '')
      const palabra = rel[5] ?? ''
      const esAnio = palabra.startsWith('ano')
      if (n > 0) {
        opciones.push({
          pos: rel.index,
          c: {
            tipo: 'relativa',
            plazo: esAnio ? n * 12 : n,
            unidad: palabra.startsWith('dia') ? 'dias' : 'meses',
            ancla: `su ${rel[6] ?? ''}`,
            sujeto: sujetoAntes(texto, ini),
            cita: cita(ini, tras + rel.index + rel[0].length),
          },
        })
      }
    }
    if (inm && inm.index !== undefined) {
      opciones.push({
        pos: inm.index,
        c: {
          tipo: 'inmediata',
          ancla: ANCLA[inm[2]!] ?? 'su publicación',
          sujeto: sujetoAntes(texto, ini),
          cita: cita(ini, tras + inm.index + inm[0].length),
        },
      })
    }
    if (fec && !RE_VENCIMIENTO.test(ventana.slice(Math.max(0, fec.inicio - 40), fec.inicio))) {
      opciones.push({
        pos: fec.inicio,
        c: {
          tipo: 'fecha',
          iso: fec.iso,
          ancla: fechaLarga(fec.iso),
          sujeto: sujetoAntes(texto, ini),
          cita: cita(ini, tras + fec.fin),
        },
      })
    }
    if (opciones.length) clausulas.push(opciones.sort((a, b) => a.pos - b.pos)[0]!.c)
  }
  return clausulas
}

/** La nota del portal con la que algunas normas cierran: «NOTA: Publicada en el Diario Oficial 47.956 de enero 18 de 2011». */
export function publicacionEnNota(plano: string): string | null {
  for (const m of plano.matchAll(/nota:\s*publicad[oa]\s+en\s+el\s+diario\s+oficial[^\n]{0,140}/gi)) {
    const f = buscarFecha(m[0])
    if (f) return f.iso
    // «Diario Oficial 48489 de julio 12 de 2012»: día y mes al revés.
    const r = m[0].match(new RegExp(String.raw`\b(${MES_TXT})\s+(\d{1,2})\s+de\s+(\d{4})`, 'i'))
    const iso = r ? isoValido(Number(r[3]), MESES[r[1]!.toLowerCase()]!, Number(r[2])) : null
    if (iso) return iso
  }
  return null
}

export const isoCanonico = (s: string | undefined): string | undefined => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim())
  return m ? (isoValido(Number(m[1]), Number(m[2]), Number(m[3])) ?? undefined) : undefined
}
