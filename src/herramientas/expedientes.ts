/**
 * Herramientas del expediente temporal de investigación (src/expediente.ts):
 * crear, agregar y leer. El feature vive en memoria y se enciende con EXPEDIENTES=1.
 */
import { z } from 'zod'
import { agregar, crear, habilitado, leer, type Expediente } from '../expediente.ts'

const AVISO_DESACTIVADO =
  'La capacidad de expedientes está desactivada en esta instalación. Se activa con la ' +
  'variable de entorno EXPEDIENTES=1. No es un fallo: es una capacidad ausente.'

const ADVERTENCIA_TEMPORAL =
  ' crea un expediente EN MEMORIA para agrupar consultas, citas y observaciones de una ' +
  'investigación; es TEMPORAL (expira en 6 h, se pierde al reiniciar el servidor) y está ' +
  'DESACTIVADO por defecto (se activa con EXPEDIENTES=1).'

export const expedienteCrearTITULO = 'Crear un expediente temporal de investigación'
export const expedienteCrearDESCRIPCION = 'Crea un expediente EN MEMORIA para agrupar consultas, citas y observaciones de una investigación; es TEMPORAL (expira en 6 h, se pierde al reiniciar el servidor) y está DESACTIVADO por defecto (se activa con EXPEDIENTES=1).'
export const expedienteCrearSchema = z.object({})
export function expedienteCrearEscribir(): string {
  if (!habilitado()) return AVISO_DESACTIVADO
  const id = crear()
  return (
    `Expediente ${id} creado. Expira en 6 horas y vive solo en la memoria de este proceso: ` +
    'se pierde al reiniciar. Usa expediente_agregar para guardar preguntas, citas y observaciones.'
  )
}

export const expedienteAgregarTITULO = 'Agregar una entrada a un expediente'
export const expedienteAgregarDESCRIPCION =
  'Agrega una pregunta, fuente, documento, cita, decisión u observación a un expediente' + ADVERTENCIA_TEMPORAL
export const expedienteAgregarSchema = z.object({
  id: z.string().describe('Id devuelto por expediente_crear'),
  campo: z.enum(['preguntas', 'fuentes', 'documentos', 'citas', 'decisiones', 'observaciones']),
  texto: z.string().min(1),
})
export function expedienteAgregarEscribir(args: { id: string; campo: keyof Expediente; texto: string }): string {
  if (!habilitado()) return AVISO_DESACTIVADO
  if (!agregar(args.id, args.campo, args.texto)) {
    return `No existe un expediente con id ${args.id}, o ya expiró. Créalo de nuevo con expediente_crear.`
  }
  return `Agregado a ${args.campo} del expediente ${args.id}.`
}

export const expedienteLeerTITULO = 'Leer un expediente temporal'
export const expedienteLeerDESCRIPCION =
  'Lee el contenido de un expediente creado con expediente_crear:' + ADVERTENCIA_TEMPORAL
export const expedienteLeerSchema = z.object({ id: z.string() })
export function expedienteLeerEscribir(args: { id: string }): string {
  if (!habilitado()) return AVISO_DESACTIVADO
  const datos = leer(args.id)
  if (!datos) return `No existe un expediente con id ${args.id}, o ya expiró.`
  const bloques: string[] = []
  for (const [campo, textos] of Object.entries(datos)) {
    if (textos.length) bloques.push(`${campo}:\n- ${textos.join('\n- ')}`)
  }
  return bloques.length ? bloques.join('\n') : `Expediente ${args.id} vacío.`
}
