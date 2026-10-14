/**
 * Expediente de investigación: agrupa preguntas, fuentes, documentos, citas,
 * decisiones y observaciones de una sesión. Vive en memoria; si EXPEDIENTES_DIR
 * apunta a un directorio, cada expediente se persiste como `<id>.json` (se carga
 * al arrancar y se escribe en cada mutación). Una mutación que no llega a disco
 * lanza y no se aplica en memoria: lo que se confirma es lo que sobrevive.
 */

import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import * as path from 'node:path'

export type Expediente = {
  preguntas: string[]
  fuentes: string[]
  documentos: string[]
  citas: string[]
  decisiones: string[]
  observaciones: string[]
}

const CAMPOS = ['preguntas', 'fuentes', 'documentos', 'citas', 'decisiones', 'observaciones'] as const

/** El feature se enciende con EXPEDIENTES=1; se relee en cada llamada. */
export function habilitado(): boolean {
  return process.env['EXPEDIENTES'] === '1'
}

/** Directorio de persistencia, o null si la persistencia está apagada. */
function direccion(): string | null {
  const dir = process.env['EXPEDIENTES_DIR']
  return dir ? dir : null
}

/** true si la persistencia en disco está configurada (EXPEDIENTES_DIR). */
export function enDisco(): boolean {
  return direccion() !== null
}

/** TTL por defecto (ms) desde EXPEDIENTES_TTL_MS; 0 = sin expiración. */
function ttlPorDefecto(): number {
  const ms = Number(process.env['EXPEDIENTES_TTL_MS'])
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** true si `x` es un expediente válido recién leído de disco. */
function esExpediente(x: unknown): x is { datos: Expediente; creado: number } {
  const e = x as { datos?: Record<string, unknown>; creado?: unknown } | null
  if (!e || typeof e.creado !== 'number' || typeof e.datos !== 'object' || e.datos === null) return false
  const datos = e.datos
  return CAMPOS.every((c) => {
    const v = datos[c]
    return Array.isArray(v) && v.every((t) => typeof t === 'string')
  })
}

/**
 * Un almacén de expedientes con su propio estado. El servidor usa uno solo, el
 * que crea este módulo al final y vive lo que vive el proceso; las pruebas
 * crean los suyos y no se pisan entre sí.
 */
export function crearExpedientes() {
  const expedientes = new Map<string, { datos: Expediente; creado: number }>()

  // TTL por entrada distinto del configurado: solo lo usan las pruebas.
  const ttlEspecial = new Map<string, number>()

  // Marca si ya se intentó cargar el directorio de persistencia.
  let cargado = false

  const ttlDe = (id: string): number => ttlEspecial.get(id) ?? ttlPorDefecto()

  /**
   * Relee `<dir>/*.json` en un mapa limpio (equivale a un arranque nuevo). Los
   * archivos corruptos o ilegibles se ignoran sin tumbar el proceso.
   */
  function recargar(): number {
    cargado = true
    expedientes.clear()
    ttlEspecial.clear()
    const dir = direccion()
    if (!dir) return 0
    let n = 0
    try {
      for (const archivo of readdirSync(dir)) {
        if (!archivo.endsWith('.json')) continue
        try {
          const e: unknown = JSON.parse(readFileSync(path.join(dir, archivo), 'utf8'))
          if (!esExpediente(e)) continue
          expedientes.set(archivo.slice(0, -'.json'.length), e)
          n++
        } catch {
          // Archivo corrupto: se ignora y se sigue con el resto.
        }
      }
    } catch {
      // Directorio inexistente o ilegible: se queda en memoria.
    }
    return n
  }

  /** Carga el directorio una sola vez, en el primer acceso. */
  function asegurarCargado(): void {
    if (!cargado) recargar()
  }

  /**
   * Persiste `e` en disco si EXPEDIENTES_DIR está configurado. Escribe en un
   * temporal, lo sincroniza y lo renombra sobre `<id>.json`: un cierre a mitad
   * deja el archivo anterior intacto, nunca uno truncado. Si falla, lanza.
   */
  function persistir(id: string, e: { datos: Expediente; creado: number }): void {
    const dir = direccion()
    if (!dir) return
    const final = path.join(dir, `${id}.json`)
    const temporal = `${final}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    let creado = false
    try {
      mkdirSync(dir, { recursive: true })
      const fd = openSync(temporal, 'wx')
      creado = true
      try {
        writeSync(fd, JSON.stringify(e))
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      renameSync(temporal, final)
    } catch (err) {
      if (creado) rmSync(temporal, { force: true })
      throw new Error(
        `No se pudo guardar el expediente ${id} en ${dir}: ${(err as Error).message}. El cambio no se aplicó.`,
        { cause: err },
      )
    }
  }

  /** Entrada viva, o null si no existe o expiró (barrido perezoso al tocarla). */
  function vivo(id: string): { datos: Expediente; creado: number } | null {
    asegurarCargado()
    const e = expedientes.get(id)
    if (!e) return null
    // Sin persistencia y con TTL positivo, barrido perezoso: se borra al tocar.
    const ttl = ttlDe(id)
    if (!direccion() && ttl > 0 && Date.now() - e.creado > ttl) {
      expedientes.delete(id)
      ttlEspecial.delete(id)
      return null
    }
    return e
  }

  /** Crea un expediente vacío; lanza si EXPEDIENTES_DIR está configurado y no se pudo guardar. */
  function crear(ttlMs?: number): string {
    asegurarCargado()
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    const e = {
      datos: { preguntas: [], fuentes: [], documentos: [], citas: [], decisiones: [], observaciones: [] },
      creado: Date.now(),
    }
    persistir(id, e)
    expedientes.set(id, e)
    if (ttlMs !== undefined) ttlEspecial.set(id, ttlMs)
    return id
  }

  /** Agrega `texto` a `campo`; false si el id no existe. Lanza si no se pudo guardar en disco. */
  function agregar(id: string, campo: keyof Expediente, texto: string): boolean {
    if (!texto) return false
    const e = vivo(id)
    if (!e) return false
    const nuevo = { creado: e.creado, datos: { ...e.datos, [campo]: [...e.datos[campo], texto] } }
    persistir(id, nuevo)
    expedientes.set(id, nuevo)
    return true
  }

  function leer(id: string): Expediente | null {
    const e = vivo(id)
    return e ? e.datos : null
  }

  return { recargar, crear, agregar, leer }
}

/** El almacén del proceso: el único que usa el servidor. */
const almacen = crearExpedientes()
export const { recargar, crear, agregar, leer } = almacen
