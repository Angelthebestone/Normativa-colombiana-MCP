import { CanarioError } from '../../nucleo/parse/errores.ts'
import { cargar } from '../../nucleo/parse/limpieza.ts'

/**
 * Un botón solo viaja cuando se pulsa. Se reconoce por el elemento y no por el
 * nombre: los botones «Ver Diario» de cada fila se llaman `...:N:j_idt<k>` con
 * un número que JSF autogenera y que el portal cambió de 34 a 35 (medido el
 * 2026-11-19); enviar uno abre el detalle de ese diario en vez del listado.
 */
function esBoton(el: { tagName: string; attribs: Record<string, string> }): boolean {
  if (el.tagName === 'button') return true
  return el.tagName === 'input' && /^(?:submit|button|image|reset)$/i.test(el.attribs['type'] ?? '')
}

/**
 * Campos del formulario y `action` de la página. Lanza canario si el portal
 * dejó de traer el formulario o la tabla: sin ellos no hay consulta posible, y
 * una tabla vacía se leería como «no se publicó nada».
 */
export function leerFormulario(html: string): { action: string; campos: Record<string, string> } {
  const $ = cargar(html)
  const $form = $('form#frmConDiario')
  if (!$form.length) throw new CanarioError('la consulta del Diario Oficial ya no trae el formulario frmConDiario')
  if (!$('#dtbDiariosOficiales').length) {
    throw new CanarioError('la consulta del Diario Oficial ya no trae la tabla dtbDiariosOficiales')
  }

  const campos: Record<string, string> = {}
  $form.find('[name]').each((_, el) => {
    const $el = $(el)
    const nombre = $el.attr('name')
    if (!nombre || esBoton(el)) return
    // Un <select> viaja con el valor de su opción marcada, no con el del atributo.
    campos[nombre] =
      el.tagName === 'select'
        ? ($el.find('option[selected]').first().attr('value') ?? $el.find('option').first().attr('value') ?? '')
        : ($el.attr('value') ?? '')
  })
  return { action: $form.attr('action') ?? '', campos }
}

/** El `javax.faces.ViewState` de una respuesta: es lo que ata la petición a la vista. */
export function viewStateDe(html: string): string {
  return cargar(html)('input[name="javax.faces.ViewState"]').first().attr('value') ?? ''
}
