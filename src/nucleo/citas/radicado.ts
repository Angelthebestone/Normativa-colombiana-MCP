import { anioBogota } from '../fecha.ts'

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
  if (n < 1900 || n > anioBogota() + 1) return null

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
