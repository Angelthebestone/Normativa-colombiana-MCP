export type Respuesta = {
  status: number
  cuerpo: string
  cookies: string
  /** Cabeceras en minúscula; la UPME publica el total en `x-wp-total`. */
  cabeceras: Record<string, string>
  /** El cuerpo salió de una copia en memoria: no se pidió a la fuente. */
  deCache?: boolean
  /** La fuente contestó 304: la copia sigue vigente, comprobado, no supuesto. */
  revalidada?: boolean
  /** La fuente no respondió y se sirvió una copia: el llamador DEBE rotularlo. */
  degradada?: boolean
  /** Epoch ms de la consulta a la fuente que produjo el texto servido. */
  fechaCopia?: number
  /** Texto listo para pegar delante de la respuesta; vacío si no hay nada que decir. */
  avisoCopia?: string
  /** La fuente reenvió el documento y el texto ya no es el de la copia anterior. */
  cambio?: boolean
}

/**
 * Opciones de `pedir`. Van aparte de los argumentos posicionales para no tocar
 * las cuarenta llamadas que ya existen.
 */
export type OpcionesPedir = {
  /** TTL explícito de la copia; si no, sale del tipo y el año de la norma. */
  ttlMs?: number
  /**
   * Si la fuente no responde y hay copia, devolver la copia con su rótulo en vez
   * de fallar. Apagado por defecto **a propósito**: entregar una copia que el
   * llamador no va a rotular es peor que devolver un vacío.
   */
  degradarDesdeCopia?: boolean
}
