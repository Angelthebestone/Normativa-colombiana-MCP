/**
 * El MCP vive del HTML de un portal que puede cambiar sin aviso. Cuando el
 * parseo deja de encontrar lo que esperaba hay que gritarlo: una lista vacía
 * en silencio es indistinguible de "no existe", y en materia legal esa
 * confusión es el peor fallo posible.
 */
export class CanarioError extends Error {
  constructor(que: string) {
    super(
      `El portal cambió su estructura y esta extensión no pudo leer la respuesta (${que}). ` +
        `No es que no haya resultados: es que no se pudieron interpretar. ` +
        `Actualiza la extensión desde https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases`,
    )
    this.name = 'CanarioError'
  }
}

export class NoExisteError extends Error {
  constructor(id: string) {
    super(`No existe un documento con el identificador ${id} en el Gestor Normativo.`)
    this.name = 'NoExisteError'
  }
}

// --- texto ---------------------------------------------------------------
