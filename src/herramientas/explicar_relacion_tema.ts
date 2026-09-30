/** El restrictor: por qué una norma es pertinente para ESE subtema y no para otro. */
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
import { alcance } from '../nucleo/alcance.ts'
import { conPrefijo, sinPrefijo } from '../nucleo/catalogos.ts'
import { cargarIndice } from '../nucleo/indice.ts'
import { normalizarRotulo } from '../nucleo/parse.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as gestor from '../fuentes/gestor.ts'

export const TITULO = 'Explicar por qué una norma aplica a un subtema'

export const DESCRIPCION =
  'Devuelve el "restrictor": el extracto que explica por qué esa norma es pertinente para ESE subtema en ' +
  'concreto. Ambos identificadores deben salir de la MISMA fila de buscar_por_tema, y el temsubid va con su ' +
  'prefijo ("ts-38872"): un id de listar_catalogos (catalogo="subtemas") o de otros catálogos se rechaza aquí. Para ver todos los ' +
  'restrictores de una norma de una vez, usa obtener_documento con fuente="gestor" y mira su bloque "Temas asociados".'

const esquema = z.object({
  temsubid: z.string().describe('temsubid de buscar_por_tema, con su prefijo: "ts-38872"'),
  normid: z.coerce.string().regex(/^\d+$/).describe('normid de la misma fila de buscar_por_tema'),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ temsubid: temsubidCrudo, normid }: Params): Promise<string> {
  const temsubid = sinPrefijo('ts', temsubidCrudo)
  // Se recupera el par del índice para poder decir a qué tema corresponde:
  // sin eso el usuario no puede verificar que la respuesta sea la que pidió.
  const fila = cargarIndice()?.filas.find((f) => f.ts === temsubid)
  const rotulo = fila ? `${normalizarRotulo(fila.t)} / ${normalizarRotulo(fila.s)}` : '(subtema no encontrado en el índice)'
  const enElIndice = fila?.n.some(([id]) => id === normid) ?? false

  const r = await gestor.restrictor(temsubid, normid)
  if (!r) {
    return vacio(
      `un restrictor para la norma ${normid} bajo "${rotulo}"`,
      enElIndice
        ? 'El índice sí relaciona esa norma con ese subtema, pero el portal no publica el extracto. Usa obtener_documento con fuente="gestor" para ver los restrictores que sí tiene.'
        : 'Esa norma no está clasificada bajo ese subtema. Verifica que temsubid y normid vengan de la misma ' +
          'fila de buscar_por_tema; si el rótulo de arriba no es el subtema que buscabas, el id es de otra fila.'
    )
  }
  return (
    `${alcance([{ clave: 'gestor', detalle: 'restrictor del subtema' }])}\n\n` +
      `Tema / subtema: ${rotulo} (temsubid ${conPrefijo('ts', temsubid)})\nNorma: ${normid}\n\n` +
      `Por qué aplica:\n${r}\n\n` +
      `Norma completa: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=${normid}\n` +
      `Este es el restrictor de ESTE subtema; la norma puede tener otros distintos bajo otros temas (obtener_documento con fuente="gestor" los lista todos).`
  )
}
