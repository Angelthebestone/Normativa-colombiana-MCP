export type Copia = {
  cuerpo: string
  status: number
  cabeceras: Record<string, string>
  /** Epoch ms en que se recibió de la fuente. */
  fecha: number
  /** Epoch ms hasta el que se sirve sin volver a preguntar. */
  vence: number
}
