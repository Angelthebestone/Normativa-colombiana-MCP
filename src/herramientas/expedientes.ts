/**
 * Herramienta `expediente(accion)`: crear, agregar, leer y exportar el
 * expediente de investigación (src/nucleo/expediente.ts). Una sola tool con el
 * discriminador `accion`. Se enciende con EXPEDIENTES=1; con EXPEDIENTES_DIR
 * persiste en disco (y entonces no expira por TTL fijo ni se pierde al reiniciar).
 */
import { stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'

import { agregar, crear, enDisco, habilitado, leer, type Expediente } from '../nucleo/expediente.ts'

const AVISO_DESACTIVADO =
  'La capacidad de expedientes está desactivada en esta instalación. Se activa con la ' +
  'variable de entorno EXPEDIENTES=1. Con EXPEDIENTES_DIR los expedientes se guardan en disco: ' +
  'no se pierden al reiniciar el servidor ni expiran por un TTL fijo. No es un fallo: es una ' +
  'capacidad ausente.'

/**
 * Línea de alcance: el expediente es memoria del propio servidor, así que ninguna
 * de sus acciones consulta una fuente normativa. Va en todas las respuestas para
 * que su forma quede declarada antes de leerlas.
 */
const ALCANCE =
  'Alcance: sin consultar ninguna fuente (el expediente vive en el servidor; no se consulta ninguna fuente normativa).'

export const TITULO = 'Expediente temporal de investigación'

export const DESCRIPCION =
  'Crea, agrega, lee o exporta un expediente para agrupar consultas, citas y observaciones de una ' +
  'investigación. Se activa con EXPEDIENTES=1 (DESACTIVADO por defecto). En memoria es TEMPORAL ' +
  '(expira según EXPEDIENTES_TTL_MS; por defecto no expira); con EXPEDIENTES_DIR persiste en disco y ' +
  'sobrevive a reinicios. accion="crear" devuelve el id; "agregar" guarda una entrada en la sección ' +
  'de un expediente YA CREADO; "leer" lo devuelve agrupado; "exportar" lo escribe como markdown en ' +
  'la ruta pedida.'

export const schema = z.object({
  accion: z
    .enum(['crear', 'agregar', 'leer', 'exportar'])
    .describe('Qué hacer: crear un expediente, agregar una entrada, leer su contenido o exportarlo'),
  id: z.string().optional().describe('Id del expediente (obligatorio para agregar, leer y exportar)'),
  campo: z
    .enum(['preguntas', 'fuentes', 'documentos', 'citas', 'decisiones', 'observaciones'])
    .optional()
    .describe('Sección donde guardar la entrada (solo accion="agregar")'),
  texto: z.string().optional().describe('Contenido de la entrada a guardar (solo accion="agregar")'),
  ruta: z
    .string()
    .optional()
    .describe('Dónde escribir la exportación: un archivo o un directorio (solo accion="exportar")'),
})

export const exportar = (datos: Expediente, id: string): string =>
  [
    `# Expediente ${id}`,
    ...Object.entries(datos).map(
      ([seccion, textos]) =>
        `\n## ${seccion}\n` + (textos.length ? textos.map((t) => `- ${t}`).join('\n') : '_vacío_'),
    ),
  ].join('\n')

/** Nombre de archivo seguro a partir del id. */
function nombreSeguro(id: string): string {
  const s = id.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return s || 'expediente'
}

async function esDirectorio(ruta: string): Promise<boolean> {
  try {
    return (await stat(ruta)).isDirectory()
  } catch {
    return false
  }
}

/** Argumentos de `escribir`, ya resueltos por el esquema del SDK. */
type Args = {
  accion: 'crear' | 'agregar' | 'leer' | 'exportar'
  id?: string
  campo?: keyof Expediente
  texto?: string
  ruta?: string
}

export async function escribir(args: Args): Promise<string> {
  return `${ALCANCE}\n\n${await cuerpo(args)}`
}

async function cuerpo(args: Args): Promise<string> {
  if (!habilitado()) return AVISO_DESACTIVADO

  if (args.accion === 'crear') {
    // Un id junto a "crear" es una confusión de quien llama: crear no recibe id
    // y antes lo ignoraba, así que nacía un expediente nuevo y la llamada
    // parecía haber acertado sobre el que se creía existente.
    if (args.id !== undefined) {
      return (
        `No existe un expediente con id "${args.id}": los ids los crea accion="crear" sin id y los devuelve su ` +
        `propia respuesta. Llama con accion="crear" y usa el id que devuelva para accion="agregar", "leer" o "exportar".`
      )
    }
    const id = crear()
    const persistente = enDisco()
    const final = persistente
      ? 'Se guarda en disco (EXPEDIENTES_DIR) y no expira por TTL fijo: sobrevive a reinicios.'
      : 'Vive en la memoria de este proceso: se pierde al reiniciar.'
    return `Expediente ${id} creado. ${final} Usa expediente con accion="agregar" para guardar preguntas, citas y observaciones.`
  }

  if (args.accion === 'agregar') {
    if (!args.id || !args.campo || !args.texto) {
      return 'Para accion="agregar" hacen falta id, campo y texto.'
    }
    if (!agregar(args.id, args.campo, args.texto)) {
      return (
        `No existe un expediente con id ${args.id} (o ya expiró). Los ids los crea accion="crear" sin id y los ` +
        `devuelve su propia respuesta; créalo de nuevo y usa el que devuelva.`
      )
    }
    return `Agregado a ${args.campo} del expediente ${args.id}.`
  }

  if (args.accion === 'leer') {
    if (!args.id) return 'Para accion="leer" hace falta id.'
    const datos = leer(args.id)
    if (!datos) {
      return (
        `No existe un expediente con id ${args.id} (o ya expiró). Los ids los crea accion="crear" sin id y los ` +
        `devuelve su propia respuesta.`
      )
    }
    const bloques: string[] = []
    for (const [campo, textos] of Object.entries(datos)) {
      if (textos.length) bloques.push(`${campo}:\n- ${textos.join('\n- ')}`)
    }
    return bloques.length ? bloques.join('\n') : `Expediente ${args.id} vacío.`
  }

  if (args.accion === 'exportar') {
    if (!args.id || !args.ruta) return 'Para accion="exportar" hacen falta id y ruta.'
    const datos = leer(args.id)
    if (!datos) {
      return (
        `No existe un expediente con id ${args.id} (o ya expiró). No se creó ningún archivo. Los ids los crea ` +
        `accion="crear" sin id y los devuelve su propia respuesta.`
      )
    }
    const destino = (await esDirectorio(args.ruta))
      ? path.join(args.ruta, `${nombreSeguro(args.id)}.md`)
      : args.ruta
    const padre = path.dirname(destino)
    if (!(await esDirectorio(padre))) {
      return `No existe el directorio ${padre} para exportar. Créalo antes o pasa otra ruta. No se creó ningún archivo.`
    }
    try {
      await writeFile(destino, exportar(datos, args.id), 'utf8')
    } catch {
      return `No se pudo escribir el expediente ${args.id} en ${destino}. No se creó ningún archivo.`
    }
    return `Expediente ${args.id} exportado a ${path.resolve(destino)} (${(await stat(destino)).size} bytes).`
  }

  return AVISO_DESACTIVADO
}
