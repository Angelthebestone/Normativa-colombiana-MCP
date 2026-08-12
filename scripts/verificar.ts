/**
 * `npm run verificar` — el comando único de salud del MCP.
 *
 * Orquesta la cadena de verificación y se detiene en el primer paso fallido,
 * reportando paso, herramienta (si aplica), entrada y salida cruda:
 *
 *   1. build        — `npm run build` (esbuild + sincroniza manifest.json)
 *   2. typecheck    — `tsc --noEmit`
 *   3. lint         — `oxlint src scripts test`
 *   4. unit         — `node --test` sobre los tests unitarios (sin red)
 *   5. cobertura    — mapa tool publicada → archivo de pruebas (rompe si falta)
 *   6. red          — `node --test test/red*.ts` contra el bundle (regresión viva)
 *   7. barrido      — `node scripts/barrido-disruptivo.ts` (adversarial, crudo)
 *
 * Cero dependencias nuevas: usa `node:child_process` (spawn) y los scripts ya
 * existentes del repo.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))

function correr(nombre: string, comando: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    console.log(`\n=== ${nombre}: ${comando} ${args.join(' ')} ===`)
    const p = spawn(comando, args, { cwd: RAIZ, stdio: 'inherit', shell: true })
    p.on('exit', (codigo) => resolve(codigo ?? 1))
    p.on('error', (e) => {
      console.error(`No se pudo lanzar ${comando}: ${e.message}`)
      resolve(1)
    })
  })
}

/**
 * Mapa tool publicada → archivo de pruebas que la cubre. Se deriva de lo que
 * ya existe en el repo: `test/red*.ts`, `test/smoke.ts`, `test/probar-tools.ts`
 * y los tests unitarios por módulo. Una tool sin caso aquí rompe `verificar`.
 */
const MAPA_TOOL_TEST: Record<string, string> = {
  resolver_cita: 'test/red-gestor.ts',
  buscar_normas: 'test/red-gestor.ts',
  buscar_por_tema: 'test/smoke.ts',
  listar_catalogos: 'test/smoke.ts',
  buscar_jurisprudencia: 'test/red-tribunales.ts',
  buscar_jurisprudencia_suprema: 'test/red-tribunales.ts',
  buscar_jurisprudencia_consejo_estado: 'test/red-tribunales.ts',
  buscar_en_suin: 'test/red-gestor.ts',
  explicar_relacion_tema: 'test/smoke.ts',
  buscar_normativa_anh: 'test/smoke.ts',
  buscar_normativa_upme: 'test/upme.ts',
  buscar_resoluciones_creg: 'test/smoke.ts',
  listar_normativa_ambiental_anla: 'test/smoke.ts',
  buscar_normativa_sectorial: 'test/sectorial-sdk.ts',
  buscar_normativa_tributaria: 'test/normograma-ttl.ts',
  describir_fuentes: 'test/smoke.ts',
  consultar_por_jerarquia: 'test/consultar_jerarquia.ts',
  analizar_conflicto: 'test/analizar_conflicto.ts',
  cambios_desde: 'test/cambios_desde.ts',
  comparar_articulos: 'test/diff.ts',
  consultar_perfil: 'test/consultar_perfil.ts',
  consultar_vigencia: 'test/consultar_vigencia.ts',
  historial_norma: 'test/historial_norma.ts',
  buscar_unificado: 'test/buscar_unificado.ts',
  obtener_documento: 'test/red-gestor.ts',
  expediente: 'test/expedientes-herramientas.ts',
}

async function verificarCobertura(): Promise<number> {
  // Se pregunta al servidor compilado por `tools/list` (el mismo patrón de
  // scripts/construir.ts) y se comprueba que cada tool publicada tiene caso.
  const { Cliente } = await import('../test/red.ts')
  const c = new Cliente()
  try {
    await c.peticion('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verificar', version: '1' },
    })
    const { tools } = await c.peticion('tools/list')
    const publicadas = tools.map((t: { name: string }) => t.name)
    const sinCaso = publicadas.filter((n: string) => !MAPA_TOOL_TEST[n])
    if (sinCaso.length) {
      console.error(`\n✗ Cobertura incompleta: ${sinCaso.length} tool(s) sin caso de prueba:`)
      for (const n of sinCaso) console.error(`  - ${n}  (añade su archivo al MAPA_TOOL_TEST de scripts/verificar.ts)`)
      return 1
    }
    console.log(`\n✓ Cobertura: ${publicadas.length} tools publicadas, todas con caso de prueba.`)
    return 0
  } finally {
    c.cerrar()
  }
}

const PASOS: ([string, string, string[]] | [string, null, null])[] = [
  ['build', 'npm', ['run', 'build']],
  ['typecheck', 'npx', ['tsc', '--noEmit']],
  ['lint', 'npx', ['oxlint', 'src', 'scripts', 'test']],
  ['unit (sin red)', 'node', ['--test', 'test/upme.ts', 'test/normograma-ttl.ts', 'test/deduplicar.ts', 'test/portal-roto.ts', 'test/snapshot.ts', 'test/historial_norma.ts', 'test/consultar_vigencia.ts', 'test/consejoestado.ts', 'test/diff.ts', 'test/sectorial-sdk.ts', 'test/expedientes-herramientas.ts', 'test/buscar_unificado.ts']],
  ['cobertura tool→caso', null, null],
  ['red de regresión (contra bundle)', 'node', ['--test', 'test/red-gestor.ts', 'test/red-tribunales.ts', 'test/red-v2.ts', 'test/red-v3.ts']],
  ['barrido disruptivo', 'node', ['scripts/barrido-disruptivo.ts']],
  ['barrido de términos (regresión de portal)', 'node', ['scripts/barrido-terminos.ts']],
]

for (const [nombre, cmd, args] of PASOS) {
  const codigo = cmd === null ? await verificarCobertura() : await correr(nombre, cmd, args!)
  if (codigo !== 0) {
    console.error(`\n✗ Verificación falló en el paso "${nombre}" (código ${codigo}).`)
    process.exit(1)
  }
}

console.log('\n✓ Verificación completa: build, typecheck, lint, unit, cobertura, red y barrido en orden.')
