/**
 * Herramienta de perfiles: ejecuta la consulta del usuario con la fuente y los
 * filtros que el perfil trae preconfigurados.
 */
import { z } from 'zod'
import { perfil, perfiles } from '../perfiles.ts'

export const TITULO = 'Consultar un perfil sectorial preconfigurado'

export const DESCRIPCION =
  'Ejecuta una consulta con las fuentes y los filtros preconfigurados de un perfil: laboral, tributario, ' +
  'ambiental, contratación estatal o energía. Cada perfil declara su sector y sus límites; para el listado de ' +
  'perfiles disponibles usa describir_fuentes o pide el listado. NO uses un perfil para lo que no cubre.'

export const schema = {
  perfil: z.string().describe('Id del perfil: laboral, tributario, ambiental, contratacion_estatal, energia'),
  texto: z.string().describe('Consulta dentro del perfil, ej. "teletrabajo"'),
  limite: z.coerce.number().int().min(1).max(20).default(10),
}

/** El schema como ZodObject: de él se deriva el tipo de los parámetros resueltos. */
const schemaCompleto = z.object(schema)
type Parametros = z.infer<typeof schemaCompleto>

/**
 * Da forma a la respuesta sin tocar la red: `resultado` null es un perfil que
 * no existe; si no, se pega el resultado y el bloque del perfil, con su
 * advertencia y el descargo, que van SIEMPRE.
 */
export function formatear(
  id: string,
  disponibles: string[],
  resultado: string | null,
  nombre: string,
  sector: string,
  advertencia: string,
): string {
  if (resultado === null) {
    return `No existe un perfil llamado "${id}". Disponibles: ${disponibles.join(', ')}.`
  }
  return (
    `${resultado}\n\nPerfil: ${nombre} — ${sector}\n` +
    `Advertencia: ${advertencia}\n` +
    'Esto no es asesoría jurídica; verifica en el enlace antes de actuar.'
  )
}

export async function escribir({ perfil: id, texto, limite }: Parametros): Promise<string> {
  const p = perfil(id)
  if (!p) return formatear(id, perfiles().map((x) => x.id), null, '', '', '')
  return formatear(id, perfiles().map((x) => x.id), await p.consultar(texto, limite), p.nombre, p.sector, p.advertencia)
}
