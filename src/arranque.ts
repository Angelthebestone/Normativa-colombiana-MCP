/**
 * Lo primero que evalúa el servidor, y por eso es el primer import de index.ts:
 * varios módulos proyectan sus enums sobre FUENTES al importarse, así que una
 * FUENTES inválida rompería dentro del import de cualquiera de ellos. Aquí se
 * valida antes y se sale con el motivo en una línea: sin esto, Node volcaba al
 * log del cliente la línea minificada entera del bundle (decenas de KB) antes
 * del mensaje.
 */
import { leerFuentes } from './nucleo/alcance.ts'

try {
  leerFuentes()
} catch (e) {
  process.stderr.write(`normativa-colombia no arranca: ${(e as Error).message}\n`)
  process.exit(1)
}
