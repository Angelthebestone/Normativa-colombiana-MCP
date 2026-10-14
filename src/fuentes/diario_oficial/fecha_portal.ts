/**
 * Envía una fecha como la espera el portal. Acepta `dd/MM/yyyy` y `yyyy-mm-dd`
 * (lo que teclea quien pregunta) y devuelve null si no es ninguna de las dos:
 * mandarle una fecha inventada al portal devolvería un vacío que se leería como
 * «no hay diarios», que es justo el error que este módulo existe para evitar.
 */
export function fechaPortal(s: string): string | null {
  const t = s.trim()
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const dmy = iso ? null : t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!iso && !dmy) return null
  const dia = Number(iso ? iso[3] : dmy![1])
  const mes = Number(iso ? iso[2] : dmy![2])
  const anio = Number(iso ? iso[1] : dmy![3])
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12 || anio < 1900 || anio > 2200) return null
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${anio}`
}
