import { z } from 'zod'

import { idTipo, parsearCita } from '../citas.ts'
import { clasificarValidacion, validarArticulo, validarNumeroAnio, validarUrl } from '../evidencia.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Validar una cita y su enlace'

export const DESCRIPCION =
  'Comprueba que la cita (tipo, número, año y artículo, si se indica) coincide con lo que devuelve el Gestor ' +
  'Normativo y que el dominio del enlace es el esperado (funcionpublica.gov.co). Clasifica el resultado en ' +
  '"cita validada", "cita parcialmente validada" o "no fue posible validar". NUNCA afirma vigencia: para el ' +
  'estado de una norma usa resolver_cita.'

export const schema = {
  cita: z.string().describe('Cita a validar, ej. "Ley 909 de 2004"'),
  url: z.string().url().optional().describe('Enlace a comprobar; si no se da, se usa el de la fuente'),
}

export const SIN_FORMA =
  'No fue posible validar: la cita no tiene forma de cita colombiana. Escríbela como "Ley 909 de 2004" o "C-337/11".'

/** El aviso de forma si `cita` no parsea; texto vacío si sí. */
export function sinForma(cita: string): string {
  return parsearCita(cita) ? '' : SIN_FORMA
}

/** Texto puro de un resultado de validación, inyectable para las pruebas. */
export function formatear(
  _cita: string,
  resultado: string,
  comprobaciones: { nombre: string; ok: boolean }[],
  encontrada?: { titulo: string; url: string },
): string {
  const lineas = comprobaciones.map((c) => `- ${c.nombre}: ${c.ok ? '✓' : '✗'}`)
  const cuerpo = encontrada
    ? [encontrada.titulo, encontrada.url]
    : ['Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.']
  return [`Resultado: ${resultado}`, ...lineas, ...cuerpo].join('\n')
}

export async function escribir({ cita, url }: z.infer<ReturnType<typeof z.object<typeof schema>>>): Promise<string> {
  const aviso = sinForma(cita)
  if (aviso) return aviso

  const c = parsearCita(cita)!
  const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  const item = r.items[0]
  if (!item) {
    return 'No fue posible validar: la cita no se encontró en el Gestor Normativo. Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.'
  }

  const comprobaciones: { nombre: string; ok: boolean }[] = [
    { nombre: 'número y año', ok: validarNumeroAnio(item.titulo, c.numero, c.anio) },
    { nombre: 'dominio del enlace', ok: validarUrl(url ?? item.url, 'funcionpublica.gov.co') },
  ]
  if (c.articulo) {
    const norma = await gestor.obtenerNorma(item.id)
    comprobaciones.push({ nombre: 'artículo', ok: validarArticulo(norma.texto, c.articulo) })
  }
  return formatear(cita, clasificarValidacion(comprobaciones), comprobaciones, { titulo: item.titulo, url: item.url })
}
