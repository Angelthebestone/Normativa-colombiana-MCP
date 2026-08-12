/**
 * Advertencia de snapshot antiguo para los índices empaquetados: si la fecha de
 * generación supera el umbral, se avisa de que puede faltar normativa reciente.
 * Un índice sin fecha (o con fecha inválida) no avisa: no se puede afirmar nada.
 */
const DIA_MS = 24 * 3600 * 1000

export function advertenciaSnapshot(generado: string | undefined, umbralDias = 30): string {
  if (!generado) return ''
  const t = Date.parse(generado)
  if (Number.isNaN(t)) return ''
  const dias = Math.floor((Date.now() - t) / DIA_MS)
  if (dias < umbralDias) return ''
  return `\nAVISO: el índice empaquetado se generó el ${generado} (hace ~${dias} días): puede faltar normativa ` +
    `reciente; actualiza la extensión.`
}
