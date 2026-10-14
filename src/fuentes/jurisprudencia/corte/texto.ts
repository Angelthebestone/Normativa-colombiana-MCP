import { cargar, textoDe } from '../../../nucleo/parse.ts'
import { rutaDeSentencia } from '../../../nucleo/citas.ts'
import { BASE, pedir } from './relatoria.ts'

/**
 * Texto completo de una providencia. Acepta `2024/T-099-24.htm`, la URL entera
 * o la cita corta `T-099/24`: obligar a copiar la ruta literal de una respuesta
 * previa era fricción gratuita, porque el resto del sistema cita en corto.
 */
export async function obtenerTexto(ruta: string): Promise<{ url: string; texto: string }> {
  const limpia = ruta.replace(/^https?:\/\/[^/]+\/relatoria\//i, '').replace(/^\/+/, '')
  if (!/^[\w./-]+\.html?$/i.test(limpia)) {
    const porCita = rutaDeSentencia(ruta)
    if (porCita) return obtenerTexto(porCita)
    throw new Error(`Ruta de providencia inválida: ${ruta}. Se espera "2024/T-099-24.htm" o la cita "T-099/24".`)
  }
  const url = `${BASE}/${limpia}`
  const html = await pedir(url)
  // Una ruta inexistente no da 404: devuelve el armazón de la SPA en Angular.
  // Confundir eso con "documento vacío" haría creer que la sentencia no dice nada.
  if (html.includes('data-beasties-container') || /<title>\s*CORTE CONSTITUCIONAL DE COLOMBIA/i.test(html)) {
    throw new NoExisteProvidencia(limpia)
  }
  return { url, texto: textoDe(cargar(html), 'body') }
}

export class NoExisteProvidencia extends Error {
  constructor(ruta: string) {
    super(`No existe una providencia en la ruta "${ruta}". Verifícala con buscar_jurisprudencia.`)
    this.name = 'NoExisteProvidencia'
  }
}
