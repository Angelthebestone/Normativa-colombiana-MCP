const HORA_MS = 3600 * 1000
const DIA_MS = 24 * HORA_MS

export type ClaseNorma = 'constitucion' | 'antigua' | 'media' | 'reciente' | 'actual' | 'desconocida'

/**
 * Minúsculas sin tildes. No se importa `sinTildes` de `parse.ts` a propósito:
 * este módulo lo carga la capa de transporte y `parse.ts` arrastra cheerio.
 */
const plano = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/** Clase según tipo y año; `desconocida` cuando el año no es utilizable. */
export function claseDeNorma(tipo: string, anio: number | string | undefined, ahora = Date.now()): ClaseNorma {
  if (/constitucion/.test(plano(tipo ?? ''))) return 'constitucion'
  const a = Number(String(anio ?? '').replace(/\D/g, '').slice(0, 4))
  if (!a || a < 1900 || a > 2200) return 'desconocida'
  const actual = new Date(ahora).getUTCFullYear()
  if (a === actual) return 'actual'
  if (a === actual - 1) return 'reciente'
  if (a >= actual - 4) return 'media'
  return 'antigua'
}

/**
 * TTL en ms por clase. No mide "cuánto tarda en cambiar" —eso no se puede
 * medir— sino cuánto se tolera servir la copia sin volver a preguntar.
 */
export function ttlDeNorma(tipo: string, anio: number | string | undefined, ahora = Date.now()): number {
  switch (claseDeNorma(tipo, anio, ahora)) {
    case 'constitucion':
      return 30 * DIA_MS
    case 'antigua':
      return 7 * DIA_MS
    case 'media':
      return 48 * HORA_MS
    case 'reciente':
      return 12 * HORA_MS
    case 'actual':
      return HORA_MS
    case 'desconocida':
      return 6 * HORA_MS
  }
}

export type Identidad = { tipo: string; anio: string }

/**
 * Tipo y año, del nombre del archivo si los lleva (`decreto_1235_2023.htm`) y,
 * si no, del encabezado del propio texto (`LEY 1437 DE 2011`). Se lee sobre una
 * muestra porque el cuerpo entero de una norma son cientos de miles de
 * caracteres y la identidad está en las primeras líneas.
 */
export function identidadDeNorma(url: string, muestra = ''): Identidad {
  const nombre = plano(url.split(/[?#]/)[0]!.split('/').pop() ?? '')
  const enUrl = /(ley|decreto|resolucion|acuerdo|circular)[-_]?(\d{1,6})[-_]((?:19|20)\d{2})/.exec(nombre)
  if (enUrl) return { tipo: enUrl[1]!, anio: enUrl[3]! }

  // El título manda sobre el cuerpo: el cuerpo de una norma CITA otras, y la
  // primera que nombra suele ser anterior y ajena (en `norma.php?i=31431`, que
  // es la Ley 1221 de 2008, la primera mención era otra ley).
  const titulo = /titulo-norma[^>]*>\s*([^<]{3,200})/i.exec(muestra)?.[1] ?? ''
  for (const texto of [titulo, muestra]) {
    if (!texto) continue
    const t = plano(texto)
    if (/constitucion politica/.test(t)) return { tipo: 'constitucion', anio: '' }
    const m = /(ley|decreto|resolucion|acuerdo|circular|acto legislativo)\s+(\d{1,6})\s+de\s+((?:19|20)\d{2})/.exec(t)
    if (m) return { tipo: m[1]!, anio: m[3]! }
  }
  return { tipo: '', anio: '' }
}
