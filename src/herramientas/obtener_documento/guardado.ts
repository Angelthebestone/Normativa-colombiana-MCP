/** `obtener_documento` con entero o ruta_destino: escribir el documento a disco. */
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { trocear } from '../../nucleo/parse/fragmentos.ts'
import { descargarA, escribirSinColision } from '../../nucleo/descargas.ts'
import { adaptador } from '../../fuentes/sectorial.ts'
import * as gestor from '../../fuentes/gestor/index.ts'
import * as suin from '../../fuentes/suin/index.ts'
import * as corte from '../../fuentes/jurisprudencia/corte/index.ts'
import * as suprema from '../../fuentes/jurisprudencia/cortesuprema.ts'
import * as creg from '../../fuentes/creg.ts'
import * as dian from '../../fuentes/normograma.ts'
import type { DepsLectura, Resueltas } from './esquema.ts'

/** La URL del archivo que se puede bajar en las fuentes con enlace directo. */
function urlDeDescarga(p: Resueltas): string | null {
  if (p.fuente === 'dian') return p.link ? dian.urlDocumento(p.link) : null
  if (p.fuente === 'sectorial') return p.url ?? null
  return null
}

/** El dominio que autoriza la descarga de cada fuente. */
function dominioDe(p: Resueltas): string {
  switch (p.fuente) {
    case 'gestor':
      return 'https://www.funcionpublica.gov.co'
    case 'corte':
      return 'https://www.corteconstitucional.gov.co'
    case 'creg':
      return 'https://gestornormativo.creg.gov.co'
    case 'dian':
      return 'https://normograma.dian.gov.co'
    case 'sectorial':
      return adaptador(p.entidad ?? '')?.dominioPermitido ?? ''
    default:
      return ''
  }
}

/** Directorio temporal de una llamada: normativa-<algo>, limpio al terminar. */
async function temporal(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'normativa-'))
}

/**
 * `entero=true`: se escribe el documento a disco (con descargarA cuando hay
 * enlace directo, o reconstruyendo el texto de las fuentes de texto) y se
 * devuelve la ruta absoluta con un trozo de lectura; nunca el documento entero.
 */
export async function enteroDocumento(p: Resueltas, tope: number, deps: DepsLectura = {}): Promise<string> {
  const destino = p.ruta_destino ?? (await temporal())
  const url = urlDeDescarga(p)
  if (url) {
    const dominio = dominioDe(p)
    if (!dominio) throw new Error(`Para fuente="${p.fuente}" hace falta un enlace: usa dian con link o sectorial con url.`)
    const { rutaAbsoluta, bytes } = await descargarA(dominio, url, destino, deps.pedirBytes ? { pedirBytes: deps.pedirBytes } : {})
    return `Archivo guardado en: ${rutaAbsoluta} (${bytes} bytes).\n\nURL de origen: ${url}`
  }

  // Fuentes de texto sin enlace directo: se reconstruye el documento y se
  // escribe como texto; el trozo de lectura evita los 2 MB por stdio.
  let texto: string
  let origen = ''
  if (p.fuente === 'gestor') {
    if (!p.id) throw new Error('Para fuente="gestor" hace falta id.')
    const n = await (deps.obtenerNorma ?? gestor.obtenerNorma)(p.id)
    texto = n.texto
    origen = n.url
  } else if (p.fuente === 'suin') {
    if (!p.id) throw new Error('Para fuente="suin" hace falta id.')
    const d = await (deps.documentoSuin ?? suin.documento)(p.id)
    if (!d) throw new Error(`SUIN-Juriscol no tiene un documento con id ${p.id}: no se puede guardar.`)
    texto = d.texto
    origen = d.url
  } else if (p.fuente === 'corte') {
    if (!p.ruta) throw new Error('Para fuente="corte" hace falta ruta.')
    const d = await corte.obtenerTexto(p.ruta)
    texto = d.texto
    origen = d.url
  } else if (p.fuente === 'creg') {
    if (!p.ruta) throw new Error('Para fuente="creg" hace falta ruta.')
    const d = await creg.obtenerTexto(p.ruta)
    texto = d.texto
    origen = d.url
  } else if (p.fuente === 'suprema') {
    if (!p.ruta || !p.sala) throw new Error('Para fuente="suprema" hacen falta ruta y sala.')
    const d = await suprema.obtenerTexto(p.ruta, p.sala as (typeof suprema.SALAS)[number])
    if (!d) throw new Error(`No encontré la providencia "${p.ruta}" en la sala ${p.sala}: no se puede guardar.`)
    texto = d.texto
    origen = p.ruta
  } else {
    // El Consejo de Estado no publica un archivo descargable: su texto sale del
    // PDF del visor, que no se reconstruye aquí.
    throw new Error(
      `entero/ruta_destino no aplica a fuente="${p.fuente}": no hay archivo que guardar. ` +
        `Con fuente="consejo" pide el texto sin entero (o abre el visor); entero sí vale con gestor, suin, corte, suprema, creg, dian y sectorial.`,
    )
  }
  await mkdir(destino, { recursive: true })
  // Con sufijo si ya existe: guardar dos veces el texto de la misma fuente en la
  // misma carpeta reemplazaba en silencio el primero.
  const txt = await escribirSinColision(join(destino, `texto-${p.fuente}.txt`), texto)
  return `Archivo guardado en: ${txt} (${texto.length} caracteres).\n\nURL de origen: ${origen}\n\n--- Texto (primeros caracteres) ---\n${trocear(texto, 0, tope).texto}`
}
