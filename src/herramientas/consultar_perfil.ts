/**
 * Herramienta de perfiles: ejecuta la consulta del usuario con la fuente y los
 * filtros que el perfil trae preconfigurados.
 */
import { z } from 'zod'
import { alcance, proyectar } from '../nucleo/alcance.ts'
import { perfil, perfiles } from '../nucleo/perfiles.ts'

export const TITULO = 'Consultar un perfil sectorial preconfigurado'

export const DESCRIPCION =
  'Ejecuta la consulta con las fuentes y los filtros preconfigurados de un perfil sectorial (laboral, ' +
  'tributario, ambiental, contratación estatal o energía) y devuelve los resultados con el sector y la ' +
  'advertencia del perfil, que es lo que declara sus límites. NO uses un perfil para lo que no cubre: si ' +
  'la materia es otra, usa buscar_normas o resolver_cita.'

/**
 * Los ids salen del registro de perfiles: no se escriben a mano, no se
 * desincronizan. Y solo los de fuentes encendidas (FUENTES): el perfil de
 * energía con la CREG apagada no se puede ni pedir.
 */
const IDS = proyectar(
  perfiles().map((p) => p.id),
  (id) => perfil(id)!.fuente,
)

export const schema = {
  perfil: z.enum(IDS).describe('Id del perfil, de describir_fuentes'),
  texto: z.string().describe('Consulta dentro del perfil, ej. "teletrabajo"'),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe('Cuántos resultados devolver (máximo 20; por defecto 10)'),
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
  // El canario nunca devuelve un vacío en silencio: si el perfil no encontró
  // nada, se dice y se orienta, en vez de dejar una línea en blanco arriba.
  const cuerpo = resultado.trim()
    ? resultado
    : `No encontré resultados para esta consulta en el perfil "${id}". Prueba otro término o usa resolver_cita para una norma concreta.`
  return (
    `${cuerpo}\n\nPerfil: ${nombre} — ${sector}\n` +
    `Advertencia: ${advertencia}\n` +
    'Esto no es asesoría jurídica; verifica en el enlace antes de actuar.'
  )
}

export async function escribir({ perfil: id, texto, limite }: Parametros): Promise<string> {
  const p = perfil(id)
  if (!p) return `Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).\n\n${formatear(id, IDS, null, '', '', '')}`
  const resultado = await p.consultar(texto, limite)
  const n = resultado.split('\n').filter((l) => l.startsWith('- ')).length
  return `${alcance([{ clave: p.fuente, detalle: `perfil ${p.id}: ${n} resultado(s)` }])}\n\n${formatear(id, IDS, resultado, p.nombre, p.sector, p.advertencia)}`
}
