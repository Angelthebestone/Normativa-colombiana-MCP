/**
 * cambios_desde.ts: cambios que el Gestor anota sobre una lista de normas,
 * filtrados por el año de la norma modificadora.
 */
import { z } from 'zod'
import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import * as gestor from '../fuentes/gestor.ts'
import { historial, type Cambio } from '../nucleo/parse.ts'

export const TITULO = 'Cambios registrados sobre normas desde una fecha'

export const DESCRIPCION =
  'Resume los cambios (modificación, derogación, adición) que el Gestor anota sobre LAS NORMAS QUE SE LISTAN, ' +
  'filtrándolos por el año de la norma modificadora. NO rastrea novedades automáticamente ni descubre normas nuevas.'

export const schema = {
  normas: z.array(z.string()).min(1).describe('Citas de normas a revisar, ej. ["Ley 909 de 2004"]'),
  desde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Fecha AAAA-MM-DD; se filtra por el AÑO de la norma modificadora'),
}

type Parametros = { normas: string[]; desde: string }

const CIERRE =
  '\n\nEsto es un resumen de los cambios que el Gestor anota; NO es un rastreo de novedades: ' +
  'no descubre normas nuevas por su cuenta.'

/** - MODIFICADO por Ley 1960 de 2019, artículo 1, con la nota literal del portal. */
export function formatearCambio(c: Cambio): string {
  return (
    `- ${c.accion.toUpperCase()}${c.norma ? ` por ${c.norma} de ${c.anio}` : ''}` +
    `${c.articulo ? `, artículo ${c.articulo}` : ''}\n  Nota literal: «${c.literal}»`
  )
}

/** Conserva los cambios cuya norma modificadora es del año mínimo o posterior; los sin año se descartan. */
export function filtrarPorAnio(cambios: Cambio[], anioMinimo: number): Cambio[] {
  return cambios.filter((c) => c.anio !== '' && Number(c.anio) >= anioMinimo)
}

/** Une las secciones por norma y añade el cierre fijo. */
export function formatear(secciones: string[]): string {
  return `${secciones.join('\n')}${CIERRE}`
}

/**
 * Sección de una cita: título e id de la norma, cambios filtrados y avisos.
 * No lanza: cada problema se anota en la sección y se sigue con la siguiente.
 */
async function cambiosDe(cita: string, desde: string): Promise<string> {
  const c = parsearCita(cita)
  if (!c) return `- ${cita}: no se pudo parsear como cita de norma.`

  const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  const item = r.items[0]
  if (!item) return `- ${cita}: no se encontró en el Gestor.`

  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return (
        `- La cita "${cita}" es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años ` +
        `distintos. No se elige una por ti:\n` +
        ambiguos
          .sort((a, b) => Number(b.anio) - Number(a.anio))
          .map((x) => `  - ${x.titulo} (id ${x.id})\n    ${x.url}`)
          .join('\n') +
        `\n  Repite con el año ("${c.tipo} ${c.numero} de ${ambiguos[0]!.anio}").`
      )
    }
  }

  const cambios = historial((await gestor.obtenerNorma(item.id)).texto)
  const anioMinimo = Number(desde.slice(0, 4))
  const filtrados = filtrarPorAnio(cambios, anioMinimo)
  const sinAnio = cambios.filter((c) => c.anio === '').length
  const avisoSinAnio = sinAnio ? `\n${sinAnio} cambio(s) anotado(s) sin año, no se puede fechar.` : ''
  const encabezado = `${item.titulo} (id ${item.id})`

  if (!filtrados.length) {
    return (
      `${encabezado}\n- sin cambios registrados desde ${desde}: el Gestor no siempre anota las reformas.` +
      avisoSinAnio
    )
  }
  return `${encabezado}\n${filtrados.map(formatearCambio).join('\n')}${avisoSinAnio}`
}

export async function escribir({ normas, desde }: Parametros): Promise<string> {
  const secciones: string[] = []
  for (const cita of normas) secciones.push(await cambiosDe(cita, desde))
  return formatear(secciones)
}
