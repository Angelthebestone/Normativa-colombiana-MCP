/**
 * Jerarquía normativa colombiana: mapea tipos de documento a niveles y
 * describe el carácter de cada uno (vinculante, orientador o informativo).
 */

export const NIVELES = ['constitucion', 'ley', 'decreto', 'resolucion', 'concepto', 'jurisprudencia'] as const

export type Nivel = (typeof NIVELES)[number]

const normaliza = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

/** Cobertura de los TIPOS de src/citas.ts; lo que no está cae en 'resolucion'. */
const TIPO_A_NIVEL: Record<string, Nivel> = {
  'constitucion politica': 'constitucion',
  ley: 'ley',
  'acto legislativo': 'ley',
  decreto: 'decreto',
  'decreto ley': 'decreto',
  reglamento: 'decreto',
  resolucion: 'resolucion',
  circular: 'resolucion',
  'circular conjunta': 'resolucion',
  'circular externa': 'resolucion',
  'circular unificada': 'resolucion',
  acuerdo: 'resolucion',
  directiva: 'resolucion',
  estatutos: 'resolucion',
  'documento conpes': 'concepto',
  concepto: 'concepto',
  'concepto marco': 'concepto',
  'criterio unificado': 'concepto',
  sentencia: 'jurisprudencia',
  auto: 'jurisprudencia',
}

export function tipoANivel(tipo: string): Nivel {
  const clave = normaliza(tipo)
  // El tipo llega a veces con el número de la norma ("Sentencia C-337"):
  // se busca la entrada completa y, si no está, la primera palabra.
  return TIPO_A_NIVEL[clave] ?? TIPO_A_NIVEL[clave.split(' ')[0] ?? ''] ?? 'resolucion'
}

const CARACTER: Record<Nivel, string> = {
  constitucion: 'La Constitución es la norma de normas: de rango supremo y carácter vinculante para todas las autoridades.',
  ley: 'Las leyes y los actos legislativos son de carácter vinculante y de rango superior a los decretos y resoluciones.',
  decreto: 'Los decretos reglamentan la ley: son vinculantes, pero están subordinados a ella.',
  resolucion: 'Las resoluciones y circulares son actos administrativos de carácter vinculante para sus destinatarios, subordinados a la ley y al decreto.',
  concepto: 'Los conceptos son doctrina de la entidad que los emite: de carácter orientador, no vinculante.',
  jurisprudencia: 'La jurisprudencia es precedente interpretativo de los tribunales: de carácter informativo en esta consulta; no es una norma.',
}

export function caracterDelNivel(nivel: Nivel): string {
  return CARACTER[nivel]
}
