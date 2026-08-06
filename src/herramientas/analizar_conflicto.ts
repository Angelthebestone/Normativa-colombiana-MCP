/**
 * Analiza un posible conflicto entre dos normas: reúne evidencia verificable
 * (metadatos, vigencia si consta, jerarquía, reformas) para cada una.
 */
import { z } from 'zod'

import { idTipo, parsearCita, candidatosAmbiguos } from '../citas.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as suin from '../fuentes/suin.ts'
import { caracterDelNivel, tipoANivel } from '../jerarquia.ts'
import { fragmentos, historial } from '../parse.ts'

export const TITULO = 'Analizar un posible conflicto entre dos normas'

export const DESCRIPCION =
  'Reúne para dos normas la EVIDENCIA de un posible conflicto: identificación en el Gestor, vigencia según ' +
  'SUIN cuando consta, nivel en la jerarquía y carácter, reformas anotadas en el texto y pasajes que mencionan ' +
  'un tema. NO detecta contradicciones semánticas: el resultado es un conflicto POTENCIAL, no una conclusión ' +
  'jurídica; verifica en los enlaces antes de actuar.'

export const schema = {
  norma_a: z.string().describe('Cita de la primera norma, ej. "Ley 909 de 2004"'),
  norma_b: z.string().describe('Cita de la segunda norma'),
  sobre: z.string().optional().describe('Tema opcional para buscar artículos de ambas que lo mencionen'),
}

export type Evidencia = {
  cita: string
  parseada: boolean
  titulo: string
  url: string
  nivel: string
  caracter: string
  vigencia: string
  reformas: string[]
  pasajes: string[]
  noEncontrada: boolean
  ambigua: boolean
  candidatos: { titulo: string; id: string; anio: string; url: string }[]
}

export async function evidenciaDe(cita: string, sobre?: string): Promise<Evidencia> {
  const c = parsearCita(cita)
  const base: Evidencia = {
    cita,
    parseada: false,
    titulo: '',
    url: '',
    nivel: '',
    caracter: '',
    vigencia: '',
    reformas: [],
    pasajes: [],
    noEncontrada: false,
    ambigua: false,
    candidatos: [],
  }
  if (!c) return base

  base.parseada = true
  const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      base.ambigua = true
      base.candidatos = ambiguos
      return base
    }
  }
  const n = r.items[0]
  if (!n) {
    base.noEncontrada = true
    return base
  }

  const nivel = tipoANivel(c.tipo)
  base.titulo = n.titulo
  base.url = n.url
  base.nivel = nivel
  base.caracter = caracterDelNivel(nivel)

  const anio = c.anio ?? n.titulo.match(/\bde\s+(\d{4})\b/i)?.[1]
  if (anio) {
    const v = await suin.vigencia(c.tipo, c.numero, anio).catch(() => null)
    if (v?.estado) base.vigencia = v.estado
  }

  try {
    const norma = await gestor.obtenerNorma(n.id)
    const reformas = historial(norma.texto).slice(0, 5)
    if (reformas.length) {
      base.reformas = reformas.map(
        (x) => `- ${x.accion.toUpperCase()}${x.norma ? ` por ${x.norma}${x.anio ? ` de ${x.anio}` : ''}` : ''} — nota literal: «${x.literal}»`,
      )
    }
    if (sobre) base.pasajes = fragmentos(norma.texto, sobre, 300, 3, 1200).trozos
  } catch {
    /* el texto es un complemento de la evidencia; sin él, seguimos con lo demás */
  }
  return base
}

function encabezado(ev: Evidencia): string {
  if (!ev.parseada) {
    return `${ev.cita}\n  No se pudo interpretar la cita: pídela como "Ley 909 de 2004", "Decreto 1083 de 2015" o "C-337/11".`
  }
  if (ev.ambigua) {
    return (
      `${ev.cita}\n  La cita es AMBIGUA: el Gestor tiene ${ev.candidatos.length} normas con ese tipo y número, de ` +
      `años distintos. No se elige una por ti:\n` +
      ev.candidatos
        .sort((a, b) => Number(b.anio) - Number(a.anio))
        .map((x) => `    - ${x.titulo} (id ${x.id})\n      ${x.url}`)
        .join('\n') +
      `\n  Repite con el año, por ejemplo "${ev.candidatos[0]?.titulo}".`
    )
  }
  if (ev.noEncontrada) {
    return `${ev.cita}\n  No se encontró en el Gestor; no concluyas que no existe: su corpus no cubre todo el país.`
  }
  const lineas = [`${ev.titulo}`, `  URL: ${ev.url}`, `  Nivel: ${ev.nivel}`, `  Carácter: ${ev.caracter}`]
  if (ev.vigencia) lineas.push(`  Estado de vigencia según SUIN-Juriscol: ${ev.vigencia}`)
  return lineas.join('\n')
}

export function formatear(evA: Evidencia, evB: Evidencia, sobre?: string): string {
  const bloques = ['## Norma A', encabezado(evA), '', '## Norma B', encabezado(evB)]
  for (const [etiqueta, ev] of [
    ['Norma A', evA],
    ['Norma B', evB],
  ] as const) {
    if (ev.noEncontrada || ev.ambigua || !ev.parseada) continue
    if (ev.reformas.length) bloques.push('', `${etiqueta} — reformas anotadas en el texto (primeras 5):`, ...ev.reformas)
    if (sobre) {
      bloques.push('', `${etiqueta} — pasajes que mencionan «${sobre}»:`)
      bloques.push(...(ev.pasajes.length ? ev.pasajes : [`  «${sobre}» no aparece en el texto.`]))
    }
  }
  bloques.push(
    '',
    'Conflicto POTENCIAL, no conclusión jurídica: esto es evidencia reunida, no un análisis de contradicciones. Verifica en los enlaces antes de actuar.',
    'Las sentencias citadas en las notas se resuelven con resolver_cita (ej. "C-1230/05").',
  )
  return bloques.join('\n')
}

export async function escribir(params: z.infer<ReturnType<typeof z.object<typeof schema>>>): Promise<string> {
  const { norma_a, norma_b, sobre } = params
  const [evA, evB] = await Promise.all([evidenciaDe(norma_a, sobre), evidenciaDe(norma_b, sobre)])
  return formatear(evA, evB, sobre)
}
