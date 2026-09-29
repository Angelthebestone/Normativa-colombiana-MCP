/** Consulta temática desde el índice empaquetado: instantánea y sin depender del portal. */
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance, DESCARGO } from '../nucleo/alcance.ts'
import { conPrefijo } from '../nucleo/catalogos.ts'
import { cargarIndice, frescura } from '../nucleo/indice.ts'
import { normalizarRotulo, sinTildes } from '../nucleo/parse.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Buscar por tema y subtema'

export const DESCRIPCION =
  'Consulta temática oficial: devuelve tema, subtema y las normas, sentencias y conceptos asociados, desde ' +
  'un índice empaquetado (instantáneo, funciona aunque el portal esté caído). Cada resultado trae temsubid ' +
  '("ts-38872") y normid para pedir después explicar_relacion_tema. El prefijo "ts-" es parte del id: ' +
  'pégalo tal cual y no lo cruces con el "sub-" ni el "tema-" de listar_catalogos, que son otras dos ' +
  'taxonomías del portal con los mismos números.'

const esquema = z.object({
  texto: z.string().describe('Tema a buscar, ej. "teletrabajo", "encargo", "prima de servicios"'),
  limite: z.coerce.number().int().min(1).max(50).default(15),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ texto, limite }: Params): Promise<string> {
  const idx = cargarIndice()
  const q = sinTildes(texto).toLowerCase().trim()

  if (idx) {
    const filas = idx.filas.filter(
      (f) => sinTildes(f.t).toLowerCase().includes(q) || sinTildes(f.s).toLowerCase().includes(q)
    )
    if (filas.length) {
      const salida = filas
        .slice(0, limite)
        .map(
          (f) =>
            `- ${normalizarRotulo(f.t)} / ${normalizarRotulo(f.s)} (temsubid ${conPrefijo('ts', f.ts)})\n` +
            f.n.slice(0, 8).map(([id, tit]) => `    · ${tit} (normid ${id})`).join('\n') +
            (f.n.length > 8 ? `\n    … y ${f.n.length - 8} más` : '')
        )
        .join('\n')
      return (
        `${alcance([{ clave: 'gestor', detalle: 'índice temático empaquetado, sin red' }])}\n\n` +
          `${filas.length} tema(s)/subtema(s) coinciden con "${texto}".\n\n${salida}` +
          (filas.length > limite ? `\n\nSe muestran ${limite} de ${filas.length}.` : '') +
          frescura(idx.generado) +
          `\n\nÍndice generado el ${idx.generado}. ${DESCARGO}`
      )
    }
  }

  const filas = await gestor.tematica(texto)
  if (!filas.length) return vacio(`temas relacionados con "${texto}"`, 'Prueba un término más general o usa buscar_normas.')
  const salida = filas
    .slice(0, limite)
    .map(
      (f) =>
        `- ${normalizarRotulo(f.tema)} / ${normalizarRotulo(f.subtema)} (temsubid ${conPrefijo('ts', f.temsubid)})\n` +
        f.documentos.slice(0, 8).map((d) => `    · ${d.titulo} (normid ${d.normid})`).join('\n')
    )
    .join('\n')
  return (`${filas.length} resultado(s) para "${texto}".\n\n${salida}`)
}
