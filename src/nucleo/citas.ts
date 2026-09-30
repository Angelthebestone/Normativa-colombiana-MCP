/**
 * Parser de citas normativas colombianas.
 *
 * Es la consulta más frecuente ("¿qué dice la Ley 909 de 2004?") y el buscador
 * del portal la resuelve mal, porque une los términos con OR. En cambio
 * tipo+número+año devuelve exactamente un resultado, así que vale la pena
 * detectar la cita y saltarse el buscador.
 */
import { codigoCitado } from './codigos.ts'

export type Cita = {
  tipo: string
  numero: string
  anio?: string | undefined
  articulo?: string | undefined
  /** Forma canónica de la Corte Constitucional: C-337/11, T-099/24, SU-123/20. */
  sentencia?: string | undefined
  /** Nombre del código cuando la cita llegó por su nombre: "Código de Comercio". */
  codigo?: string | undefined
}

/** Ids de `tipdoc` en el Gestor, para no depender del catálogo en la ruta rápida. */
const TIPOS: Record<string, number> = {
  'acto legislativo': 2,
  acuerdo: 3,
  auto: 1205,
  circular: 6,
  'circular conjunta': 184,
  'circular externa': 825,
  'circular unificada': 845,
  concepto: 7,
  'concepto marco': 785,
  'constitucion politica': 8,
  'criterio unificado': 988,
  decreto: 11,
  'decreto ley': 986,
  directiva: 13,
  'documento conpes': 985,
  estatutos: 905,
  ley: 18,
  reglamento: 989,
  resolucion: 29,
  sentencia: 30,
}

const NOMBRES_TIPO =
  'acto legislativo|circular conjunta|circular externa|circular unificada|constituci[oó]n pol[ií]tica|concepto marco|criterio unificado|decreto ley|documento conpes|acuerdo|auto|circular|concepto|decreto|directiva|estatutos|ley|reglamento|resoluci[oó]n|sentencia'

const normaliza = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

/** 92 → 1992, 24 → 2024. La Corte Constitucional existe desde 1991. */
const expandirAnio = (yy: string): string => {
  const n = Number(yy)
  return String(n >= 50 ? 1900 + n : 2000 + n)
}

// El guion es parte del número en el Estatuto Tributario ("art. 771-5", la
// bancarización) y en los códigos con adiciones: quedarse con "771" devolvía
// otro artículo con toda la apariencia de ser el pedido.
const RE_ARTICULO = /\bart(?:[íi]culo|\.)?\s*([\d]+(?:[.-][\d]+)*[A-Za-z]?)/i
// Admite "C-337/11", "C-351 de 2013" y "T-099-24": las tres formas circulan.
const RE_SENTENCIA = /\b(C|T|SU|A)[\s.-]*(\d{1,4})\s*(?:[/-]|\s+de\s+)\s*(\d{2,4})\b/i
// El número se toma entero, sin tope de dígitos: con `\d{1,5}` una cita como
// "Ley 99999999 de 1800" se partía en "Ley 99999" y el año quedaba fuera, así
// que el error acababa pidiendo un año que sí se había indicado.
const RE_TIPO_NUM = new RegExp(`\\b(${NOMBRES_TIPO})\\s*(?:n[ºo°.]?\\s*)?(\\d+)(?:\\s*(?:de|del|/)\\s*(\\d{4}|\\d{2}))?`, 'i')
// «Constitución», «… Política», «… de Colombia», «… de 1991». No casa con «Constitucional»
// (Corte Constitucional) ni con «inconstitucional»: exige «ción», no «cional».
const RE_CONSTITUCION = /\bconstituci[oó]n\b/i

export function parsearCita(texto: string): Cita | null {
  const art = texto.match(RE_ARTICULO)?.[1]

  // Sentencias: C-337/11, T-099 de 2024, SU-123/20.
  const s = texto.match(RE_SENTENCIA)
  if (s) {
    const letra = s[1]!.toUpperCase()
    const num = s[2]!
    const anio = s[3]!.length === 4 ? s[3]! : expandirAnio(s[3]!)
    return {
      tipo: letra === 'A' ? 'Auto' : 'Sentencia',
      numero: num,
      anio,
      articulo: art,
      sentencia: `${letra}-${num.padStart(3, '0')}/${anio.slice(-2)}`,
    }
  }

  const m = texto.match(RE_TIPO_NUM)

  /**
   * "Art. 191 del Código de Comercio" y "art. 191 del Decreto 410 de 1971" son
   * la misma cita, y solo la segunda resolvía. Cuando el texto trae las dos
   * referencias gana la que aparece ANTES: en "art. 217 del Código Civil,
   * modificado por la Ley 1060 de 2006" se cita el Código, y en "art. 5 de la
   * Ley 1060 de 2006, que modifica el Código Civil" se cita la ley.
   */
  const cod = codigoCitado(texto)
  // La Constitución se cita por su nombre como un código, pero no es un código
  // (no está contenida en nada) y por eso no vive en CODIGOS. Misma precedencia:
  // gana lo que aparece antes en el texto.
  const con = texto.match(RE_CONSTITUCION)?.index
  if (con !== undefined && con < (cod?.indice ?? Infinity) && con < (m?.index ?? Infinity)) {
    return { tipo: 'constitucion politica', numero: '1', anio: '1991', articulo: art }
  }
  if (cod && (!m || m.index === undefined || cod.indice < m.index)) {
    return {
      tipo: cod.codigo.tipo,
      numero: cod.codigo.numero,
      anio: cod.codigo.anio,
      articulo: art,
      codigo: cod.codigo.nombre,
    }
  }

  if (!m) return null

  const tipoTexto = normaliza(m[1]!)
  const anioBruto = m[3]
  return {
    tipo: tipoTexto,
    numero: String(Number(m[2])),
    anio: anioBruto ? (anioBruto.length === 4 ? anioBruto : expandirAnio(anioBruto)) : undefined,
    articulo: art,
  }
}

/** Id de `tipdoc` para una cita; `undefined` si el nombre no está en la tabla. */
export const idTipo = (tipo: string): number | undefined => TIPOS[normaliza(tipo)]

/**
 * Si la cita vino SIN año, el número no identifica la norma: "Decreto 1072"
 * existe en 2025, 2015, 2004 y 1999, y el Gestor devuelve primero el más
 * reciente. Entregar ese como si fuera "el" Decreto 1072 es el error caro.
 * Devuelve una lista de candidatos { titulo, id, anio, url } cuando hay varios
 * años, o vacío si la cita ya trae año o no hay ambigüedad. Las herramientas V2
 * la usan para pedir el año en vez de elegir en silencio.
 */
export function candidatosAmbiguos(items: { titulo: string; id: string; url: string }[]): { titulo: string; id: string; anio: string; url: string }[] {
  const conAnio = items
    .map((i) => ({ ...i, anio: i.titulo.match(/\bde\s+(\d{4})\b/i)?.[1] ?? '' }))
    .filter((x) => x.anio)
  return new Set(conAnio.map((x) => x.anio)).size > 1 ? conAnio : []
}

/**
 * Ruta de la relatoría para una cita de sentencia: "C-337/11" → "2011/C-337-11.htm".
 * ponytail: se construye por convención de nombres, que es la que sigue el
 * sitio; si alguna providencia se sale del patrón, obtenerTexto la reporta como
 * inexistente y queda buscar_jurisprudencia, que devuelve la ruta literal.
 */
export function rutaDeSentencia(texto: string): string | null {
  const c = parsearCita(texto)
  if (!c?.sentencia || !c.anio) return null
  return `${c.anio}/${c.sentencia.replace('/', '-')}.htm`
}

// --- Radicado Judicial Único de 23 dígitos --------------------------------

/**
 * Los procesos judiciales colombianos se identifican con 23 dígitos: 5 del DANE
 * (departamento + municipio) · 2 de especialidad/jurisdicción · 2 de
 * sala/sección · 3 de despacho · 4 del año · 5 del consecutivo · 2 de
 * instancia. Circula con guiones, con espacios o de corrido, y la relatoría le
 * pega «(AC)» cuando es una acción de tutela.
 *
 * `parsearCita` no lo entiende y esa cita cae al buscador, que une los términos
 * con OR y devuelve otra cosa. Reconocerlo aquí permite ir directo al proceso.
 */
export type Corporacion = 'consejo-de-estado' | 'corte-suprema' | 'desconocida'

export type Radicado = {
  /** Los 23 dígitos sin separadores. */
  radicado: string
  /** 11001-03-15-000-2020-00123-00 */
  formateado: string
  /** Los 5 primeros dígitos: municipio (departamento + municipio, DANE). */
  dane: string
  /** Nombre del departamento por sus 2 primeros dígitos; '' si no está en la tabla. */
  departamento: string
  /** Dígitos 6-7. */
  especialidad: string
  /** Dígitos 8-9. */
  sala: string
  /** Dígitos 10-12. */
  despacho: string
  /** Dígitos 13-16. */
  anio: string
  /** Dígitos 17-21. */
  consecutivo: string
  /** Dígitos 22-23: instancia o recurso. */
  recurso: string
  corporacion: Corporacion
  /** Lo que se sabe de la sala/sección por los dígitos 6-9; '' si no hay evidencia medida. */
  etiqueta: string
}

/**
 * Departamentos por los 2 primeros dígitos del DANE (33 entradas). Solo hacen
 * falta ellos: los 5 dígitos del radicado codifican el municipio, pero para
 * situar una providencia basta el departamento, y la tabla de municipios entera
 * (1.122 entradas) no aporta nada que la búsqueda no diga ya.
 */
const DEPARTAMENTOS: Record<string, string> = {
  '05': 'Antioquia',
  '08': 'Atlántico',
  '11': 'Bogotá D.C.',
  '13': 'Bolívar',
  '15': 'Boyacá',
  '17': 'Caldas',
  '18': 'Caquetá',
  '19': 'Cauca',
  '20': 'Cesar',
  '23': 'Córdoba',
  '25': 'Cundinamarca',
  '27': 'Chocó',
  '41': 'Huila',
  '44': 'La Guajira',
  '47': 'Magdalena',
  '50': 'Meta',
  '52': 'Nariño',
  '54': 'Norte de Santander',
  '63': 'Quindío',
  '66': 'Risaralda',
  '68': 'Santander',
  '70': 'Sucre',
  '73': 'Tolima',
  '76': 'Valle del Cauca',
  '81': 'Arauca',
  '85': 'Casanare',
  '86': 'Putumayo',
  '88': 'Archipiélago de San Andrés, Providencia y Santa Catalina',
  '91': 'Amazonas',
  '94': 'Guainía',
  '95': 'Guaviare',
  '97': 'Vaupés',
  '99': 'Vichada',
}

/**
 * Corporación y sala/sección por los dígitos 6-9, SOLO cuando los dígitos
 * identifican por sí mismos una alta corte: las `03xx` son el Consejo de Estado
 * y la `0203`, la Corte Suprema (Sala de Casación Civil).
 *
 * POR QUÉ SOLO QUEDAN ESTAS (corregido el 2026-09-28): un radicado que ASOMA
 * dentro del texto de una alta corte es casi siempre el de ORIGEN —el juzgado o
 * tribunal donde nació el proceso, del que la corte conoce en apelación o
 * casación—, no el de la corte. Medir la corporación por dónde apareció el
 * número confundía un Juzgado 38 Civil del Circuito de Bogotá
 * (`11001-31-03-…`) o un Tribunal Administrativo (`23…`) con la Corte Suprema,
 * y eso es un error grave: se le atribuía al proceso una corporación que no es
 * la suya. Por eso se quitaron `3103`, `6000` y todas las `23xx`: sus dígitos
 * son de juzgados y tribunales de instancia, y devolver ahí una alta corte era
 * falso.
 *
 * Lo que no identifique una alta corte devuelve 'desconocida' / '', que es la
 * verdad medida. Cuántos radicados reales respaldan cada entrada que sí se
 * queda va al lado; que los dígitos no fijen la sala (0315) no es un defecto:
 * es que un mismo código de entrada lo reparten después entre varias secciones.
 */
const POR_PREFIJO: Record<string, { corporacion: Corporacion; etiqueta: string }> = {
  // Consejo de Estado — de 8 consultas temáticas a su relatoría SAMAI.
  '0315': { corporacion: 'consejo-de-estado', etiqueta: '' }, // 11, repartidos entre seis secciones: los dígitos no fijan la sala
  '0325': { corporacion: 'consejo-de-estado', etiqueta: 'Sección Segunda (Subsección B)' }, // 3, sin discrepancia
  '0328': { corporacion: 'consejo-de-estado', etiqueta: 'Sección Quinta' }, // 7, sin discrepancia
  // Corte Suprema — radicado leído en providencias de la Sala de Casación Civil.
  '0203': { corporacion: 'corte-suprema', etiqueta: 'Sala de Casación Civil' }, // 5, todos de la Sala Civil
}

/** Los 7 grupos de dígitos del radicado, en orden. */
const GRUPOS = ['\\d{5}', '\\d{2}', '\\d{2}', '\\d{3}', '\\d{4}', '\\d{5}', '\\d{2}'] as const

/**
 * Radicado de 23 dígitos. Entre grupos cabe un guion, un espacio o nada, que
 * son las tres formas en que circula el mismo número, más el sufijo opcional
 * «(AC)». Los dos extremos exigen que no haya otro dígito pegado: así no casa
 * dentro de un número más largo (un NIT, un teléfono) ni con 22 o 24 dígitos.
 *
 * ponytail: la guarda mira el dígito pegado, no un separador seguido de dígito,
 * así que un «…-00-1» pegado al radicado casaría los 23 primeros. Cubrirlo
 * exigiría rechazar el radicado seguido de espacio y cifra («…-00 2024», que sí
 * es legítimo); el salto, si aparece el caso, es exigir que el número no vaya
 * precedido de «dígito + separador».
 */
export const RE_RADICADO_23 = new RegExp(
  `(?<!\\d)(${GRUPOS[0]})[\\s-]*(${GRUPOS[1]})[\\s-]*(${GRUPOS[2]})[\\s-]*(${GRUPOS[3]})[\\s-]*` +
    `(${GRUPOS[4]})[\\s-]*(${GRUPOS[5]})[\\s-]*(${GRUPOS[6]})\\s*(?:\\(AC\\))?(?!\\d)`,
  'i',
)

/**
 * Reconoce un radicado dentro de un texto y lo descompone. `null` cuando no hay
 * ninguno o el año es imposible (fuera de 1900..año actual + 1). El año futuro
 * por uno se admite porque los portales publican providencias del año en curso
 * y del siguiente antes de que empiece.
 */
export function parsearRadicado(texto: string): Radicado | null {
  const m = texto.match(RE_RADICADO_23)
  if (!m) return null

  // El regex ya garantiza dígitos en los siete grupos; el año es el único que
  // puede ser imposible y se valida aquí.
  const [dane, especialidad, sala, despacho, anio, consecutivo, recurso] = m.slice(1, 8) as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ]
  const n = Number(anio)
  if (n < 1900 || n > new Date().getFullYear() + 1) return null

  const conocido = POR_PREFIJO[`${especialidad}${sala}`]
  return {
    radicado: `${dane}${especialidad}${sala}${despacho}${anio}${consecutivo}${recurso}`,
    formateado: `${dane}-${especialidad}-${sala}-${despacho}-${anio}-${consecutivo}-${recurso}`,
    dane,
    departamento: DEPARTAMENTOS[dane.slice(0, 2)] ?? '',
    especialidad,
    sala,
    despacho,
    anio,
    consecutivo,
    recurso,
    corporacion: conocido?.corporacion ?? 'desconocida',
    etiqueta: conocido?.etiqueta ?? '',
  }
}
