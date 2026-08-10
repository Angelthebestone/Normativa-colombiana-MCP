/**
 * Herramienta `expediente(accion)`: crear, agregar y leer el expediente
 * temporal de investigación (src/nucleo/expediente.ts). Antes eran tres tools
 * (expediente_crear/agregar/leer) para un feature desactivado por defecto;
 * aquí una sola con el discriminador `accion`. Vive en memoria y se enciende
 * con EXPEDIENTES=1.
 */
import { z } from 'zod'
import { agregar, crear, habilitado, leer, type Expediente } from '../nucleo/expediente.ts'

const AVISO_DESACTIVADO =
  'La capacidad de expedientes está desactivada en esta instalación. Se activa con la ' +
  'variable de entorno EXPEDIENTES=1. No es un fallo: es una capacidad ausente.'

export const TITULO = 'Expediente temporal de investigación'

export const DESCRIPCION =
  'Crea, agrega o lee un expediente EN MEMORIA para agrupar consultas, citas y observaciones de una ' +
  'investigación. Es TEMPORAL (expira en 6 h, se pierde al reiniciar el servidor) y está DESACTIVADO por ' +
  'defecto (se activa con EXPEDIENTES=1). accion="crear" devuelve el id; accion="agregar" guarda una entrada ' +
  'en la sección indicada de un expediente YA CREADO; accion="leer" devuelve el contenido agrupado por sección.'

export const schema = z.object({
  accion: z
    .enum(['crear', 'agregar', 'leer'])
    .describe('Qué hacer: crear un expediente, agregar una entrada o leer su contenido'),
  id: z.string().optional().describe('Id del expediente (obligatorio para agregar y leer)'),
  campo: z
    .enum(['preguntas', 'fuentes', 'documentos', 'citas', 'decisiones', 'observaciones'])
    .optional()
    .describe('Sección donde guardar la entrada (solo accion="agregar")'),
  texto: z.string().optional().describe('Contenido de la entrada a guardar (solo accion="agregar")'),
})

export async function escribir(args: {
  accion: 'crear' | 'agregar' | 'leer'
  id?: string
  campo?: keyof Expediente
  texto?: string
}): Promise<string> {
  if (!habilitado()) return AVISO_DESACTIVADO

  if (args.accion === 'crear') {
    const id = crear()
    return (
      `Expediente ${id} creado. Expira en 6 horas y vive solo en la memoria de este proceso: ` +
      'se pierde al reiniciar. Usa expediente con accion="agregar" para guardar preguntas, citas y observaciones.'
    )
  }

  if (args.accion === 'agregar') {
    if (!args.id || !args.campo || !args.texto) {
      return 'Para accion="agregar" hacen falta id, campo y texto.'
    }
    if (!agregar(args.id, args.campo, args.texto)) {
      return `No existe un expediente con id ${args.id}, o ya expiró. Créalo de nuevo con accion="crear".`
    }
    return `Agregado a ${args.campo} del expediente ${args.id}.`
  }

  if (args.accion === 'leer') {
    if (!args.id) return 'Para accion="leer" hace falta id.'
    const datos = leer(args.id)
    if (!datos) return `No existe un expediente con id ${args.id}, o ya expiró.`
    const bloques: string[] = []
    for (const [campo, textos] of Object.entries(datos)) {
      if (textos.length) bloques.push(`${campo}:\n- ${textos.join('\n- ')}`)
    }
    return bloques.length ? bloques.join('\n') : `Expediente ${args.id} vacío.`
  }

  return AVISO_DESACTIVADO
}
