import { NoExisteError } from '../../nucleo/parse/errores.ts'
import { pedir } from '../../nucleo/http.ts'

// El ritmo y la serialización por dominio los gobierna `pedir`.
export async function traer(url: string): Promise<string> {
  let res: Awaited<ReturnType<typeof pedir>>
  try {
    res = await pedir(url) // 60 s por defecto: el Decreto 1083 tarda ~8 s
  } catch (e) {
    throw new Error(
      `No se pudo contactar el Gestor Normativo (${(e as Error).message}). ` +
        `Revisa tu conexión o intenta más tarde: el portal a veces está en mantenimiento.`,
    )
  }
  // Un id inexistente redirige en vez de dar 404.
  if (res.status >= 300 && res.status < 400) throw new NoExisteError(url.replace(/^.*i=/, ''))
  if (res.status === 500) {
    throw new Error(
      'El portal rechazó la consulta (error 500). Suele pasar con comillas o caracteres raros en los términos; ' +
        'intenta con palabras sencillas, sin comillas.',
    )
  }
  if (res.status !== 200) throw new Error(`El portal respondió ${res.status}.`)
  return res.cuerpo
}

export const entero = (v: unknown): string | undefined => {
  if (v === undefined || v === null || v === '') return undefined
  const n = Number(String(v).replace(/\D/g, ''))
  return Number.isInteger(n) && n > 0 ? String(n) : undefined
}
