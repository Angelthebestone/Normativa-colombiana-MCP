/**
 * `buscar_jurisprudencia_suprema`: providencias de la Corte Suprema de Justicia por
 * sala. Reutiliza `buscar` de `fuentes/jurisprudencia/cortesuprema.ts`, que es quien
 * habla con su buscador; aquí solo van el esquema y el texto de la respuesta.
 */
import { z } from 'zod'

import { alcance } from '../nucleo/alcance.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as suprema from '../fuentes/jurisprudencia/cortesuprema.ts'

export const TITULO = 'Buscar jurisprudencia de la Corte Suprema de Justicia'

export const DESCRIPCION =
  'Providencias de la Corte Suprema por sala: Tutelas, Civil, Laboral o Penal, desde 1991. Complementa a ' +
  'buscar_jurisprudencia, que es de la Corte CONSTITUCIONAL: son tribunales distintos. Cada resultado trae ' +
  'las NORMAS QUE CITA (resolubles con resolver_cita) y una RUTA con la que obtener_documento con ' +
  'fuente="suprema" devuelve el texto. ' +
  'CÓMO BUSCA: sobre el texto completo y sin descartar palabras comunes, así que "de" devuelve 69.454 ' +
  'resultados; por eso busca la FRASE EXACTA por defecto. Usa términos distintivos.'

const esquema = z.object({
  texto: z.string().describe('Términos a buscar, ej. "despido sin justa causa"'),
  sala: z.enum(suprema.SALAS).default('Tutelas').describe('Sala de la Corte. Obligatoria: sin ella el buscador no responde.'),
  anio: z.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos'),
  magistrado: z.string().optional().describe('Nombre del magistrado ponente'),
  exacto: z
    .boolean()
    .default(true)
    .describe(
      'Frase exacta (activado). Con false el buscador une con OR: "despido sin justa causa" pasa de 20.233 a ' +
        '176.012 providencias y en la sala Penal es inservible. Ponlo en false solo para ampliar a propósito.',
    ),
  desde: z.coerce.number().int().min(0).default(0).describe('Cuántas saltarse antes de empezar'),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(10)
    .default(10)
    .describe('Cuántas mostrar. El buscador entrega páginas de 10 como máximo; para ver más, usa desde.'),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export async function escribir({ texto, sala, anio, magistrado, exacto, desde, limite }: Params): Promise<string> {
  let r = await suprema.buscar({ texto, sala, anio, magistrado, exacto, desde, limite })

  // Escalera de precisión: la frase exacta primero y, solo si no devuelve
  // nada, se amplía a OR — y se dice que se amplió. Sin esto, poner exacto
  // por defecto convierte "no existe esa frase" en "no hay nada sobre esto",
  // que son cosas distintas y la segunda es falsa.
  let ampliada = false
  if (!r.items.length && exacto && texto.trim().split(/\s+/).length > 1) {
    r = await suprema.buscar({ texto, sala, anio, magistrado, exacto: false, desde, limite })
    ampliada = r.items.length > 0
  }

  if (!r.items.length) {
    return vacio(
      `providencias de la sala ${sala} sobre "${texto}"`,
      (exacto ? 'Se buscó la frase exacta y también, al no haber nada, uniendo las palabras con OR. ' : '') +
        'Prueba otra sala (Tutelas, Civil, Laboral, Penal), un término más general o quita el año.',
    )
  }
  const fin = desde + r.items.length
  // El backend cuenta con OR entre las palabras sueltas, así que su total se
  // acerca al tamaño del corpus de la sala, no a los resultados pertinentes.
  // Darlo como "coinciden" hace creer que hay una precisión que no existe.
  const recuento = r.exacto
    ? `${r.total} providencia(s) contienen la frase exacta`
    : `~${r.total} providencia(s) con alguna de las palabras (el buscador las une con OR, así que este número ` +
      `NO mide pertinencia; repite con exacto=true para contar la frase)`
  // El índice repite el mismo fallo por cada archivo (.docx, .pdf, grafías
  // distintas del ponente). Callarlo haría creer que "quedan N" son N
  // documentos nuevos, cuando buena parte son copias.
  const repetidas =
    r.brutos > r.items.length
      ? `\n\nEsta página del buscador traía ${r.brutos} entradas y solo ${r.items.length} providencia(s) distintas: ` +
        `su índice guarda una entrada por ARCHIVO (.docx y .pdf, y a veces el ponente escrito de dos formas). ` +
        `Por eso avanzar con desde rinde menos documentos nuevos de lo que sugiere el total.`
      : ''
  // Una búsqueda ampliada no puede presentarse como si fuera la que se pidió.
  const aviso = ampliada
    ? `AVISO: la frase exacta "${texto}" no aparece en ninguna providencia de esta sala. Lo que sigue es una ` +
      `búsqueda AMPLIADA, con las palabras unidas por OR, así que puede incluir providencias que solo comparten ` +
      `alguna palabra suelta. Verifica la pertinencia de cada una antes de citarla.\n\n`
    : ''
  return (
    `${alcance([{ clave: 'suprema', detalle: `${r.items.length} providencia(s)` }])}\n\n` +
      `${aviso}${recuento}, sala ${sala}; se muestran ${desde + 1}–${fin}.${repetidas}\n\n` +
      r.items
        .map(
          (p) =>
            `- ${p.titulo} (${p.clase || 'providencia'}, ${p.fecha})\n` +
            (p.magistrado ? `  Ponente: ${p.magistrado}\n` : '') +
            (p.normasCitadas.length
              ? `  Normas citadas (resolubles con resolver_cita): ${p.normasCitadas.slice(0, 8).join(' · ')}` +
                (p.normasCitadas.length > 8 ? ` … y ${p.normasCitadas.length - 8} más` : '') +
                '\n'
              : '  (no declara normas citadas)\n') +
            `  Texto completo: obtener_documento con fuente="suprema" y sala="${sala}" y ruta="${p.ruta}"`,
        )
        .join('\n') +
      (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : '')
  )
}
