/**
 * Barrido de términos por fuente: para cada fuente, lanza términos conocidos
 * que ANTES rendían y reporta `rinde | vacío | red`. Un término que antes daba
 * resultados y ahora da vacío es una posible regresión de portal (el caso UPME
 * "vehículos eléctricos"); una caída de red no es un vacío.
 *
 *   npm run build && node scripts/barrido-terminos.ts
 *
 * Los términos y resultados esperados se mantienen aquí como "contrato de
 * humo": no afirman pertinencia, solo que la fuente responde y rinde.
 */
import { Cliente } from '../test/red.ts'

/** Por tool: términos que antes rendían, la tool y la clave de término que su esquema espera. */
const TERMINOS: { tool: string; terminos: string[]; clave?: string; args?: Record<string, unknown> }[] = [
  { tool: 'buscar_normativa_upme', terminos: ['transmisión', 'vehículos eléctricos', 'plan de expansión'] },
  { tool: 'buscar_normativa_tributaria', terminos: ['retención', 'iva', 'declaración de importación'] },
  { tool: 'buscar_en_suin', terminos: ['Buenaventura', 'servicio militar'] },
  { tool: 'buscar_jurisprudencia', terminos: ['teletrabajo', 'prima de servicios'], clave: 'termino' },
  { tool: 'buscar_jurisprudencia_consejo_estado', terminos: ['nulidad electoral', 'liquidación del contrato'], args: { exacto: false } },
  { tool: 'buscar_normativa_sectorial', terminos: ['habilitación'], args: { entidad: 'supersalud', limite: 3 } },
]

const estadoDe = (texto: string): 'rinde' | 'vacio' => (/No encontré|no se encontr[oó]|sin resultados/i.test(texto) ? 'vacio' : 'rinde')

async function main(): Promise<number> {
  const c = new Cliente()
  let regresiones = 0
  try {
    await c.peticion('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'barrido-terminos', version: '1' },
    })
    for (const grupo of TERMINOS) {
      for (const termino of grupo.terminos) {
        let texto: string
        let esError: boolean
        try {
          const r = await c.tool(grupo.tool, { [grupo.clave ?? 'texto']: termino, limite: 3, ...grupo.args })
          texto = r.texto
          esError = r.esError
        } catch (e) {
          console.log(`  ${grupo.tool.padEnd(38)} "${termino}" → RED (${(e as Error).message.slice(0, 60)})`)
          continue // una caída de red NO es un vacío
        }
        const estado = esError ? 'error' : estadoDe(texto)
        const marca = estado === 'rinde' ? '✓ rinde' : estado === 'vacio' ? '✗ vacío' : '✗ error'
        console.log(`  ${grupo.tool.padEnd(38)} "${termino}" → ${marca}`)
        // Un término que ANTES rendía y ahora está vacío es la regresión de portal.
        if (estado === 'vacio') {
          regresiones++
          console.log(`    ⚠ POSIBLE REGRESIÓN: "${termino}" en ${grupo.tool} antes rendía y ahora está vacío.`)
        }
      }
    }
  } finally {
    c.cerrar()
  }
  console.log(`\n${regresiones} término(s) con posible regresión.`)
  return regresiones ? 1 : 0
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((e) => {
    console.error(`El barrido de términos falló: ${(e as Error).message}`)
    process.exit(1)
  })
