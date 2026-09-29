/**
 * La plantilla del vacío, en un solo sitio: «no encontré nada» se lee como «no
 * existe» y son dos cosas distintas, así que el vacío se explica y, cuando se
 * sabe sobre qué fuentes es, se declara. La reutilizan las herramientas en línea
 * de `index.ts` y las modulares, que la envuelven con `txt` por su cuenta.
 */
export function vacio(que: string, sugerencia: string, lineaAlcance?: string): string {
  return `${lineaAlcance ? `${lineaAlcance}\n\n` : ''}No encontré ${que} en las fuentes consultadas.\n\n${sugerencia}`
}
