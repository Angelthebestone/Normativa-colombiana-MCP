export const BASE = 'https://svrpubindc.imprenta.gov.co/diario/index.xhtml'

/**
 * Valores del `<select name="tipoNorma_input">`, leídos del formulario el
 * 2026-09-28. Son los del propio portal y **no** son un catálogo de tipos
 * documentales legibles: «OTROS» es 9999 y «PROYECTO» es 2708.
 */
export const TIPOS = {
  ACTA: '10',
  ACUERDO: '16',
  AUTO: '17',
  AVISO: '15',
  CIRCULAR: '13',
  CONCEPTO: '08',
  CONTRATOS: '33',
  DECRETO: '02',
  DIRECTIVA: '07',
  EDICTO: '05',
  EXTRACTOS: '47',
  LEY: '01',
  'LICITACIÓN': '11',
  'OBJECIÓN': '06',
  OTROS: '9999',
  PROYECTO: '2708',
  'PROYECTO DE ACTO LEGISLATIVO': '39',
  'RESOLUCIÓN': '03',
  'RESOLUCIÓN EJECUTIVA': '04',
} as const
export type TipoNorma = keyof typeof TIPOS

export type Diario = {
  /** «53.640», como lo numera la Imprenta. */
  numero: string
  /** Ordinaria, Extraordinaria, Especial, Oficio o Tributario. */
  tipoEdicion: string
  /** dd/MM/yyyy, tal como lo sirve el portal. */
  fecha: string
}

export type Opciones = {
  /** Número de diario, «53.640». Identifica uno solo. */
  numero?: string | undefined
  /** Fecha inicial dd/MM/yyyy. */
  desde?: string | undefined
  /** Fecha final dd/MM/yyyy. */
  hasta?: string | undefined
  /** Tipo de norma; solo filtra si va acompañado de `numeroNorma`. */
  tipo?: TipoNorma | undefined
  /** Número de la norma (sin el año). Con `tipo`, encuentra el diario que la publicó. */
  numeroNorma?: string | undefined
  /** Cuántos diarios devolver; el portal sirve de 10 en 10. */
  limite?: number | undefined
}

export type Resultado = { items: Diario[]; total: number }

/** Filas por página del portal: no se puede pedir otra cosa (medido). */
export const POR_PAGINA = 10
/** Tope de filas por llamada: cinco páginas, cinco peticiones extras como mucho. */
export const MAXIMO = 50
