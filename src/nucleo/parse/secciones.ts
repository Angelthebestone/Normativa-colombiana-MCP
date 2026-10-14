// --- secciones de una providencia ----------------------------------------

/**
 * Una providencia no es un texto plano: es la mayoría, y después los votos
 * particulares de quienes no la comparten. Devolver un pasaje sin decir de cuál
 * de las dos sale es la vía directa a atribuirle a la Corte lo que dijo un
 * magistrado a título propio, y ese error no se ve: el texto es auténtico.
 *
 * Ocurrió, medido: en la SU-371/21, `buscar_en_texto: "instigar"` devuelve tres
 * pasajes, uno en las consideraciones (car. 142.092) y dos en la aclaración de
 * voto de la magistrada Ortiz Delgado (155.175 y 157.770), sin distinguirlos.
 * Se citaron los de la aclaración como doctrina de la Sala Plena.
 *
 * El encabezado tiene que ocupar su propio renglón y estar en mayúsculas. Sin
 * las dos condiciones, "Decisión frente a la cual presentó recurso…" —prosa a
 * mitad de la sentencia— pasaba por el encabezado de la decisión y devolvía el
 * trozo equivocado, que es el peor resultado posible: parece la respuesta.
 *
 * Los encabezados de voto se parten por renglones con frecuencia
 * ("ACLARACIÓN\nDE VOTO DEL MAGISTRADO", SU-371/21 car. 146.769), así que el
 * salto va contemplado dentro del patrón.
 *
 * Los mismos patrones sirven a la Corte Suprema y al Consejo de Estado, medido
 * el 2026-09-24 sobre doce providencias reales: el Consejo usa "II.
 * ANTECEDENTES", "V. CONSIDERACIONES", "FALLA"/"RESUELVE" y "ACLARACIÓN DE VOTO
 * DEL MAGISTRADO …" como la Corte; la Suprema escribe a veces el encabezado con
 * dos puntos ("RESUELVE:", "ANTECEDENTES Y CONSIDERACIONES:", casación penal
 * 22186 de 2004) o con apellido ("ANTECEDENTES RELEVANTES", ATP284-2021), y por
 * eso el cierre admite los dos puntos y el de antecedentes un resto de renglón.
 */
export const SECCIONES = {
  antecedentes: /\n[ \t]*(?:[IVX]+\.?[ \t]*)?ANTECEDENTES[^\n]{0,40}(?=\n)/,
  consideraciones: /\n[ \t]*(?:[IVX]+\.?[ \t]*)?CONSIDERACIONES[^\n]{0,40}(?=\n)/,
  decision: /\n[ \t]*(?:[IVX]+\.?[ \t]*)?(?:DECISI[ÓO]N|RESUELVE|FALLA)[ \t]*[.:]?[ \t]*(?=\n)/,
  salvamentos: /\n[ \t]*SALVAMENTO[ \t]*\n?[ \t]*(?:PARCIAL[ \t]*\n?[ \t]*)?DE[ \t]*\n?[ \t]*VOTO\b/,
  aclaraciones: /\n[ \t]*ACLARACI[ÓO]N[ \t]*\n?[ \t]*(?:PARCIAL[ \t]*\n?[ \t]*)?DE[ \t]*\n?[ \t]*VOTO\b/,
} as const

export type NombreSeccion = keyof typeof SECCIONES

/** Claves del mapa: las de SECCIONES más las dos que no nacen de un encabezado. */
export type ClaveTramo = NombreSeccion | 'encabezado' | 'notas'

/**
 * Rótulo que ve quien lee la respuesta. "consideraciones de la mayoría" y no
 * "consideraciones" a secas: el punto de todo esto es que se note de quién es
 * lo que se está leyendo.
 */
export const ROTULO_SECCION: Record<ClaveTramo, string> = {
  encabezado: 'encabezado de la relatoría (tema y síntesis)',
  antecedentes: 'antecedentes',
  consideraciones: 'consideraciones de la mayoría',
  decision: 'decisión',
  salvamentos: 'salvamento de voto',
  aclaraciones: 'aclaración de voto',
  notas: 'notas al pie',
}

/**
 * Lo que precede al primer encabezado. En la Corte Constitucional es el bloque
 * que añade su relatoría (tema y síntesis); en la Suprema y el Consejo de Estado
 * no hay relatoría delante, es la identificación del proceso y de las partes, y
 * llamarlo "síntesis de la relatoría" sería rotularlo mal.
 */
export const ENCABEZADO_PROVIDENCIA = 'encabezado de la providencia (corporación, partes y proceso)'

export type Tramo = { clave: ClaveTramo; etiqueta: string; quien: string; desde: number; hasta: number }

const NOMBRE_FIRMANTE = /^[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'’.\- ]*(?:\s+(?:Y|E)\s+[A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ'’.\- ]*)*$/
const FIN_DEL_FIRMANTE = /\bA\s+LA\s+(?:SENTENCIA|PROVIDENCIA|ACLARACI|SALVAMENTO)|\bREFERENCIA\b|\bEXPEDIENTE\b|\bM\.?\s*P\.?\b/i

/**
 * Quién suscribe el voto. Degrada a cadena vacía sin romper nada: saber que un
 * pasaje es de un voto particular ya evita el error de atribución; el nombre es
 * precisión añadida, no el requisito.
 */
function firmanteDelVoto(texto: string, desde: number): string {
  const cola = texto.slice(desde, desde + 400)
  const m = cola.match(/\b(?:DE\s+LA[S]?\s+MAGISTRAD[AO][S]?|DE\s+LOS\s+MAGISTRADOS|DEL\s+MAGISTRAD[AO])\b/i)
  if (!m || m.index === undefined) return firmanteBajoElEncabezado(cola)
  let resto = cola.slice(m.index + m[0].length).replace(/^\s*PONENTE\b/i, '')
  const corte = resto.search(FIN_DEL_FIRMANTE)
  if (corte >= 0) resto = resto.slice(0, corte)
  const lineas: string[] = []
  for (const linea of resto.split('\n').map((x) => x.trim())) {
    // Un voto conjunto separa los nombres con "Y" y un renglón en blanco
    // (SU-020/22): parar en el blanco perdía al segundo firmante.
    if (!linea) {
      if (lineas.length && !/\s(?:Y|E)$/i.test(lineas.at(-1)!)) break
      continue
    }
    // Los nombres van en versal. El primer renglón con minúscula ya es otra
    // cosa: el tema de la relatoría o la prosa del voto.
    if (/[a-záéíóúñü]/.test(linea)) break
    lineas.push(linea)
  }
  const nombre = lineas.join(' ').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').replace(/\s+(?:Y|E)$/i, '').trim()
  return nombre.length >= 6 && nombre.length <= 90 && NOMBRE_FIRMANTE.test(nombre) ? nombre : ''
}

/**
 * La forma de la Corte Suprema: el nombre en versal en el renglón siguiente al
 * encabezado y "Magistrado …" debajo ("ACLARACIÓN DE VOTO\n\nFERNANDO CASTILLO
 * CADENA\n\nMagistrado ponente", SL4068-2022). Se exigen las dos cosas: sin el
 * "Magistrado" debajo, el renglón en versal puede ser una parte o un radicado.
 */
function firmanteBajoElEncabezado(cola: string): string {
  // [0] es el encabezado del voto; [1], el nombre; [2], "Magistrado …".
  const renglones = cola
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
  const [primero, segundo] = [renglones[1] ?? '', renglones[2] ?? '']
  return /^Magistrad[oa]\b/i.test(segundo) && primero.length >= 6 && primero.length <= 90 && NOMBRE_FIRMANTE.test(primero)
    ? primero
    : ''
}

/**
 * Dónde empieza el aparato de notas al pie. Es el último "[1]" a renglón propio
 * del último 40 % del documento, y solo si le siguen al menos cinco llamadas
 * más: sin las dos condiciones, un "[1]" de referencia dentro del cuerpo se
 * llevaría media providencia. En la T-015/22 son 34.436 caracteres que hoy
 * viajan rotulados como "decisión".
 */
function inicioDeNotas(texto: string): number | null {
  const marcas = [...texto.matchAll(/\n\[1\][ \n]/g)].map((m) => m.index).filter((i) => i > texto.length * 0.6)
  if (!marcas.length) return null
  const p = marcas.at(-1)!
  const siguientes = (texto.slice(p).match(/\n\[\d{1,4}\][ \n]/g) ?? []).length
  return siguientes >= 5 ? p : null
}

/**
 * Estructura completa de la providencia, en orden y sin huecos: cada carácter
 * del documento pertenece a exactamente un tramo. Es la base tanto de `seccion`
 * como del rotulado de pasajes.
 */
export function mapaDeSecciones(texto: string, encabezado = ROTULO_SECCION.encabezado): Tramo[] {
  const marcas: { clave: NombreSeccion; desde: number }[] = []
  for (const clave of Object.keys(SECCIONES) as NombreSeccion[]) {
    const re = new RegExp(SECCIONES[clave].source, 'g')
    for (const m of texto.matchAll(re)) if (m.index !== undefined) marcas.push({ clave, desde: m.index })
  }
  marcas.sort((a, b) => a.desde - b.desde)

  const tramos: Tramo[] = []
  for (const marca of marcas) {
    const ultimo = tramos.at(-1)
    // Tras "III. DECISIÓN" viene "RESUELVE", que es su continuación y no otra
    // sección. Los votos sí se repiten: cada uno es su propio tramo.
    const repetible = marca.clave === 'salvamentos' || marca.clave === 'aclaraciones'
    if (ultimo && ultimo.clave === marca.clave && !repetible) continue
    const quien = repetible ? firmanteDelVoto(texto, marca.desde) : ''
    tramos.push({
      clave: marca.clave,
      quien,
      etiqueta: quien ? `${ROTULO_SECCION[marca.clave]} — ${quien}` : ROTULO_SECCION[marca.clave],
      desde: marca.desde,
      hasta: texto.length,
    })
  }

  if (!tramos.length) {
    return [{ clave: 'encabezado', etiqueta: encabezado, quien: '', desde: 0, hasta: texto.length }]
  }
  if (tramos[0]!.desde > 0) {
    tramos.unshift({ clave: 'encabezado', etiqueta: encabezado, quien: '', desde: 0, hasta: tramos[0]!.desde })
  }

  const notas = inicioDeNotas(texto)
  if (notas !== null) {
    while (tramos.length > 1 && tramos.at(-1)!.desde >= notas) tramos.pop()
    if (notas > tramos.at(-1)!.desde) {
      tramos.push({ clave: 'notas', etiqueta: ROTULO_SECCION.notas, quien: '', desde: notas, hasta: texto.length })
    }
  }

  for (let i = 0; i < tramos.length - 1; i++) tramos[i]!.hasta = tramos[i + 1]!.desde
  return tramos
}

/** A qué tramo pertenece una posición del documento. */
export function etiquetaEn(mapa: Tramo[], pos: number): string {
  return (mapa.find((t) => pos >= t.desde && pos < t.hasta) ?? mapa.at(-1)!).etiqueta
}

/**
 * Devuelve la sección pedida. Los votos particulares se concatenan todos, cada
 * uno bajo su rótulo, porque "dame las aclaraciones" quiere decir todas.
 */
export function seccion(texto: string, cual: ClaveTramo, encabezado?: string): string | null {
  const partes = mapaDeSecciones(texto, encabezado).filter((t) => t.clave === cual)
  if (!partes.length) return null
  return partes.map((t) => `--- ${t.etiqueta} ---\n${texto.slice(t.desde, t.hasta).trim()}`).join('\n\n').trim()
}

/** Qué secciones trae el documento, para poder ofrecerlas. */
export const seccionesPresentes = (texto: string): ClaveTramo[] => [
  ...new Set(mapaDeSecciones(texto).map((t) => t.clave)),
]
