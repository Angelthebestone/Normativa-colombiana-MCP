import { CanarioError } from '../../nucleo/parse/errores.ts'
import { cargar } from '../../nucleo/parse/limpieza.ts'
import { colapsarEspacios } from '../../nucleo/parse/texto.ts'
import type { Diario } from './portal.ts'


/** Las tres columnas de cada fila, leídas por el id de su etiqueta y no por posición. */
function filasDeLaTabla(html: string): Diario[] {
  const $ = cargar(html)
  const items: Diario[] = []
  $('tr[data-ri]').each((_, tr) => {
    const $tr = $(tr)
    const campo = (sufijo: string): string => colapsarEspacios($tr.find(`label[id$=":${sufijo}"]`).first().text())
    const numero = campo('numeroDiario')
    if (!numero) return
    items.push({ numero, tipoEdicion: campo('tipoEdicion'), fecha: campo('fechaDiario') })
  })
  return items
}

/** Total declarado por el paginador («Registro 1 a 10 de 100»), o -1 si no está. */
function totalDeclarado(html: string): number {
  const texto = colapsarEspacios(cargar(html)('[id$="dtbDiariosOficiales_paginator_top"] .ui-paginator-current').first().text())
  const m = texto.match(/de\s+([\d.]+)/)
  return m ? Number(m[1]!.replace(/\./g, '')) : -1
}

/**
 * Página completa de resultados. El canario mira la forma: sin paginador la
 * respuesta no es la página de resultados, y con filas declaradas pero ninguna
 * legible el fallo es del parseo — que es el caso traicionero, porque parece
 * «no hay nada».
 */
export function leerPagina(html: string): { items: Diario[]; total: number } {
  if (!cargar(html)('#dtbDiariosOficiales').length) {
    throw new CanarioError('la respuesta del Diario Oficial ya no trae la tabla dtbDiariosOficiales')
  }
  const total = totalDeclarado(html)
  if (total < 0) throw new CanarioError('la respuesta del Diario Oficial ya no trae el paginador de la tabla')
  const items = filasDeLaTabla(html)
  if (total > 0 && !items.length) {
    throw new CanarioError(
      `el Diario Oficial dice tener ${total} registro(s) pero no se pudo leer ninguna fila (cambiaron las etiquetas de la tabla)`,
    )
  }
  return { items, total }
}

/**
 * Filas de una página siguiente, que llegan dentro del `partial-response` del
 * paginador. No trae paginador propio: el total se conserva del primero.
 */
export function leerParcial(xml: string): Diario[] {
  const m = xml.match(/<update id="dtbDiariosOficiales"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)
  if (!m) throw new CanarioError('el paginador del Diario Oficial ya no devuelve el fragmento de la tabla')
  return filasDeLaTabla(m[1]!)
}
