const CON = 'áàäâÁÀÄÂéèëêÉÈËÊíìïîÍÌÏÎóòöôÓÒÖÔúùüûÚÙÜÛñÑçÇ'
const SIN = 'aaaaAAAAeeeeEEEEiiiiIIIIooooOOOOuuuuUUUUnNcC'
const TILDES: Record<string, string> = {}
for (let i = 0; i < CON.length; i++) TILDES[CON[i]!] = SIN[i]!

/** Quita tildes conservando la longitud, para poder cortar el texto original por índice. */
export const sinTildes = (s: string): string =>
  s.replace(/[áàäâÁÀÄÂéèëêÉÈËÊíìïîÍÌÏÎóòöôÓÒÖÔúùüûÚÙÜÛñÑçÇ]/g, (c) => TILDES[c] ?? c)

/** Colapsa cualquier serie de espacios (y saltos) a un solo espacio y recorta. */
export const colapsarEspacios = (s: string): string => s.replace(/\s+/g, ' ').trim()

export const tieneTildes = (s: string): boolean => sinTildes(s) !== s

/**
 * El portal guarda temas en mayúsculas pero con las vocales acentuadas en
 * minúscula ("PROVISIóN - ENCARGO"), porque quien los cargó usó una función que
 * no contempla tildes. Se corrige solo ese artefacto: las erratas del propio
 * dato oficial —"Telebrajo"— se dejan como están, porque son lo que el portal
 * tiene indexado y corregirlas en silencio rompería la correspondencia.
 */
export const normalizarRotulo = (s: string): string =>
  s.replace(/\S+/g, (palabra) => {
    if (!/[áéíóúüñ]/.test(palabra)) return palabra
    // Si al quitar las vocales acentuadas lo que queda son solo mayúsculas,
    // la palabra iba en mayúsculas y la tilde se quedó atrás.
    const resto = palabra.replace(/[áéíóúüñ]/g, '')
    return /[A-ZÁÉÍÓÚÑ]/.test(resto) && resto === resto.toUpperCase() ? palabra.toUpperCase() : palabra
  })

/**
 * Ambos portales devuelven error ante comillas y signos de control en los términos.
 *
 * «?» y «&» no entran por simetría: entran porque el buscador del Gestor
 * responde 500 con ellos. Medido el 2026-10-15 contra `funajax.php`, con
 * `palabras=?`, `palabras=&` y con el signo dentro de una palabra; en cambio
 * «¿», «#» y «%» responden 200. Sin sacarlos, una búsqueda con «?» acababa en
 * un error que culpaba al portal de estar en mantenimiento.
 */
export const limpiarTermino = (s: string): string =>
  s.replace(/["'<>;%\\?&]/g, ' ').replace(/\s+/g, ' ').trim()
