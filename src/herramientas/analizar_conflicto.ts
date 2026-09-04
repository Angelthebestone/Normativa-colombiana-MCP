/**
 * Analiza un posible conflicto entre dos normas: reúne evidencia verificable
 * (metadatos, vigencia si consta, jerarquía, reformas) para cada una.
 */
import { z } from 'zod'

import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as suin from '../fuentes/suin.ts'
import { caracterDelNivel, tipoANivel } from '../nucleo/jerarquia.ts'
import { fragmentos, historial, sinTildes } from '../nucleo/parse.ts'

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
  /** Término que de verdad casó en el texto (puede ser una variante del pedido). */
  terminoCasado?: string
  /** Otras formas probadas de la palabra, para orientar la siguiente búsqueda. */
  variantes?: string[]
  noEncontrada: boolean
  ambigua: boolean
  candidatos: { titulo: string; id: string; anio: string; url: string }[]
}

/** Variantes morfológicas mínimas: la búsqueda es literal y el plural y el singular son cadenas distintas. */
function variantesDe(termino: string): string[] {
  const t = termino.trim()
  if (!t || /\s/.test(t)) return [t]
  const plano = sinTildes(t).toLowerCase()
  const cands = new Set<string>([t])
  if (plano.endsWith('es') && plano.length > 4) cands.add(t.slice(0, -2))
  else if (plano.endsWith('s') && plano.length > 3) cands.add(t.slice(0, -1))
  else cands.add(`${t}s`)
  if (plano.endsWith('cion') || plano.endsWith('sion')) cands.add(`${t}es`)
  return [...cands].filter((v, i, a) => a.findIndex((x) => sinTildes(x).toLowerCase() === sinTildes(v).toLowerCase()) === i)
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
    if (v?.estado) {
      base.vigencia = v.estado
    } else if (/^decreto/i.test(c.tipo)) {
      // El índice de SUIN son casi solo leyes: para un decreto se intenta la
      // ficha directa. Solo se expone el estado cuando la ficha responde.
      const fd = await suin.fichaDirectaDecreto(c.tipo, c.numero, anio).catch(() => ({ ok: false as const, razon: 'ficha-caida' as const }))
      if (fd.ok && fd.vigencia.estado) base.vigencia = fd.vigencia.estado
    }
  }

  try {
    const norma = await gestor.obtenerNorma(n.id)
    const reformas = historial(norma.texto).slice(0, 5)
    if (reformas.length) {
      base.reformas = reformas.map(
        (x) => `- ${x.accion.toUpperCase()}${x.norma ? ` por ${x.norma}${x.anio ? ` de ${x.anio}` : ''}` : ''} — nota literal: «${x.literal}»`,
      )
    }
    if (sobre) {
      // La búsqueda es literal y no lematiza: "términos" no casa con
      // "término", y decir "no aparece en el texto" sería una conclusión
      // falsa sobre el documento. Se prueban singular y plural y se dice
      // cuál casó; si ninguno casa, se nombra la cadena exacta buscada.
      const variantes = variantesDe(sobre)
      for (const v of variantes) {
        const f = fragmentos(norma.texto, v, 300, 3, 1200)
        if (f.total) {
          base.pasajes = f.trozos
          base.terminoCasado = v
          base.variantes = variantes.filter((x) => x !== v)
          break
        }
      }
      if (!base.pasajes.length) base.variantes = variantes
    }
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
      const pedido = `«${sobre}»`
      const casado = ev.terminoCasado && ev.terminoCasado !== sobre ? ` (casó la variante «${ev.terminoCasado}»)` : ''
      bloques.push('', `${etiqueta} — pasajes que mencionan ${pedido}${casado}:`)
      bloques.push(
        ...(ev.pasajes.length
          ? ev.pasajes
          : [
              `  La cadena exacta ${pedido} no casó en el texto revisado (la búsqueda es literal y no lematiza: ` +
                `el plural y el singular son cadenas distintas).` +
                (ev.variantes?.length
                  ? ` También se probó sin éxito: ${ev.variantes.map((v) => `«${v}»`).join(', ')}. Prueba otras formas de la palabra.`
                  : ''),
            ]),
      )
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
