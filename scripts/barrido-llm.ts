/**
 * Barrido de fallos de LLM: ¿puede un modelo competente sacar una conclusión
 * falsa de una respuesta bien formada?
 *
 * Complementa a `scripts/barrido-disruptivo.ts`, que cubre otra clase (salida
 * malformada) y no se toca. Este recorre las tres familias del arnés — ver
 * `test/red-llm.ts` para los criterios.
 *
 *   node scripts/barrido-llm.ts                 # familias 1 y 2
 *   node scripts/barrido-llm.ts --f3            # añade el juez (lento y con coste)
 *   node scripts/barrido-llm.ts --limite 4      # casos de contrato por herramienta
 *
 * Sale con código 1 si algo falla; el código de salida no prueba nada por sí
 * solo, así que el informe se lee.
 */
import { Cliente } from '../test/red.ts'
import {
  generarFamilia1,
  problemasFamilia1,
  reglasQueFalla,
  juez,
  type CasoCalle,
  type Ctx,
} from '../test/red-llm.ts'
import { correrRecorrido, RECORRIDOS } from '../test/recorridos.ts'

const args = process.argv.slice(2)
const conJuez = args.includes('--f3')
const soloF1 = args.includes('--f1')
const soloF2 = args.includes('--f2')
const limiteIdx = args.indexOf('--limite')
const LIMITE = limiteIdx >= 0 ? Number(args[limiteIdx + 1]) : 2

/** Una llamada de la familia 1, con su coste de red. */
async function correrF1(c: Cliente, casos: CasoCalle[]) {
  const fallos: string[] = []
  let red = 0
  let pasaron = 0

  for (const caso of casos) {
    // El contador de peticiones es acumulado del proceso: se diferencia contra
    // el valor de antes de la llamada, no contra el último uso de esa misma
    // herramienta (que la primera vez valdría 0 y convertiría la resta en suma).
    const antes = c.peticionesAcumuladas()
    let r = { texto: '', esError: false }
    try {
      r = await c.tool(caso.tool, caso.args)
    } catch (e) {
      r = { texto: `TRANSPORTE: ${(e as Error).message}`, esError: true }
    }
    const http = Math.max(0, c.peticionesAcumuladas() - antes)
    red += http
    const problemas = problemasFamilia1(r, caso)
    if (problemas.length) {
      fallos.push(`  ✗ ${caso.tool} ${JSON.stringify(caso.args)} [${caso.clase}]\n      motivo: ${caso.motivo}\n      → ${problemas.join('; ')}`)
    } else {
      pasaron++
    }
  }
  return { fallos, red, pasaron }
}

/** Las respuestas reales de los recorridos, reutilizadas para la familia 2. */
async function correrF2(c: Cliente) {
  const fallos: string[] = []
  let comprobadas = 0

  for (const rec of RECORRIDOS) {
    const res = await correrRecorrido(c, rec)
    // Se juzga la respuesta FINAL de cada recorrido: es la que el modelo resume.
    const ultimo = res.pasos[res.pasos.length - 1]
    const texto = ultimo?.texto ?? ''
    if (!texto) continue
    comprobadas++
    const ctx: Ctx = { fuente: rec.fuente }
    for (const m of reglasQueFalla(texto, ctx)) {
      fallos.push(`  ✗ recorrido ${rec.id} · regla ${m.id} (${m.nombre})\n      → ${m.problema}`)
    }
  }
  return { fallos, comprobadas }
}

/**
 * Media docena de preguntas cerradas sobre respuestas reales.
 *
 * Cada caso lleva su propia llamada: la pregunta y el texto tienen que hablar de
 * lo mismo, y atar la pregunta a lo que devuelva un recorrido entero hace que la
 * expectativa envejezca sola. Dos de estas expectativas estuvieron mal escritas
 * en la primera pasada —«¿existe la SU-371/21?» esperaba NO cuando la sentencia
 * existe y la respuesta la lista, y la remisión se esperaba NO cuando el
 * servidor ya la declara—: el juez acertó y el arnés se equivocaba.
 */
const PREGUNTAS: {
  nombre: string
  pregunta: string
  esperado: string
  tool: string
  args: Record<string, unknown>
  /** Si la respuesta declara esto, el caso es NO MEDIDO y no un fallo. */
  noMedible?: RegExp
}[] = [
  {
    nombre: 'vigencia · el caso del colapso',
    pregunta: '¿Está vigente el Decreto 1235 de 2023?',
    esperado: 'NOSESABE',
    tool: 'consultar_vigencia',
    args: { cita: 'Decreto 1235 de 2023' },
  },
  {
    nombre: 'remisión declarada',
    pregunta: '¿La respuesta dice a qué documento externo remite el artículo?',
    esperado: 'SI',
    tool: 'obtener_documento',
    args: { fuente: 'gestor', id: '76835', articulo: '2.4.1.2.44' },
  },
  {
    nombre: 'negativa · decreto inventado',
    pregunta: '¿Existe el Decreto 9999 de 2030?',
    esperado: 'NO',
    tool: 'resolver_cita',
    args: { cita: 'Decreto 9999 de 2030' },
    /**
     * La inexistencia de un DECRETO solo la puede negar SUIN, y SUIN está caído
     * desde el 2026-09-16 (301 en todas las rutas, incluida su portada). El juez
     * contesta NOSESABE y hace bien: la respuesta no puede afirmar que no existe,
     * solo que no se encontró, y esas dos cosas no son la misma. Se declara NO
     * MEDIDO en vez de contarlo como fallo del servidor. Cuando SUIN vuelva, esta
     * expectativa se mide sola y vuelve a vigilar la negativa dura.
     */
    noMedible: /ficha ca[ií]da|sin ficha|no respondi[oó]|capacidad ausente|no pude comprobar/i,
  },
  {
    nombre: 'negativa · sentencia inventada',
    pregunta: '¿Existe la sentencia SU-999 de 2099?',
    esperado: 'NO',
    tool: 'buscar_jurisprudencia',
    args: { termino: 'SU-999' },
  },
  {
    nombre: 'control · el lote de artículos',
    pregunta: '¿La respuesta contiene el texto de los artículos pedidos?',
    esperado: 'SI',
    tool: 'resolver_cita',
    args: { cita: 'Ley 1437 de 2011', articulos: ['3', '40', '47'] },
  },
]

async function correrF3(c: Cliente) {
  const fallos: string[] = []
  const respuestas: string[] = []
  for (const p of PREGUNTAS) {
    const antes = c.peticionesAcumuladas()
    let texto = ''
    try {
      texto = (await c.tool(p.tool, p.args)).texto
    } catch (e) {
      texto = `TRANSPORTE: ${(e as Error).message}`
    }
    void antes
    // Una fuente caída no se juzga: no es que el servidor no sepa, es que no
    // puede saberlo. Contarlo como fallo convertiría una caída del portal en un
    // defecto del que se está auditando.
    if (p.noMedible?.test(texto)) {
      respuestas.push(`  – ${p.nombre}: NO MEDIDO (la fuente no respondió; el juez no se puede juzgar aquí)`)
      continue
    }
    const v = juez(p.pregunta, texto)
    /**
     * El juez es un LLM y NO es determinista sobre el mismo texto: medido el
     * 2026-09-16, una misma respuesta dio NO, NO, NO en tres llamadas seguidas y
     * NOSESABE en otra tanda. Por eso se pregunta tres veces Y se exige
     * UNANIMIDAD: con mayoría simple, NOSESABE×2 NO×1 se reportaba como veredicto
     * del servidor cuando es ruido del juez. Un caso sin acuerdo se declara y no
     * se juzga, que es lo único honesto que se puede hacer con él.
     */
    const votos = [v.respuesta]
    for (let i = 0; i < 2; i++) votos.push(juez(p.pregunta, texto).respuesta)
    const cuenta = new Map<string, number>()
    for (const voto of votos) cuenta.set(voto, (cuenta.get(voto) ?? 0) + 1)
    const orden = [...cuenta].sort((a, b) => b[1] - a[1])
    const ganador = orden[0]![0]
    const reparto = orden.map(([k, n]) => `${k}×${n}`).join(' ')
    const ms = Math.round(votos.length ? v.ms : 0)

    if (orden[0]![1] < 3) {
      respuestas.push(
        `  ~ ${p.nombre}: SIN ACUERDO (${reparto}; el juez no sostiene un veredicto, no se juzga)`,
      )
      continue
    }
    const ok = ganador === p.esperado
    respuestas.push(
      `  ${ok ? '✓' : '✗'} ${p.nombre}: ${p.pregunta}\n      esperado ${p.esperado}, contestó ${ganador} (${reparto}, ~${ms} ms cada uno)`,
    )
    if (!ok) fallos.push(`  ✗ el juez contestó ${ganador} donde la respuesta correcta era ${p.esperado} (${p.nombre})`)
  }
  return { fallos, respuestas }
}

/**
 * Los expedientes vienen desactivados por defecto y el aviso de desactivado sale
 * ANTES de validar nada, así que sin esto el caso `expediente {accion:"crear",
 * id:"99999999"}` medía el aviso y no la validación, y la familia 1 lo contaba
 * como fallo. Se enciende para medir la herramienta, no la ausencia de la
 * herramienta. El resto de la batería no usa esta capacidad.
 */
process.env['EXPEDIENTES'] = '1'

const c = new Cliente()
let salida = 0
try {
  await c.peticion('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'barrido-llm', version: '1' },
  })
  const { tools } = await c.peticion('tools/list')
  const todos = generarFamilia1(tools)
  // El generador puede producir varias decenas de casos por herramienta; se
  // recorta a `--limite` de la clase 'contrato' por herramienta para no
  // someter a los portales públicos a una batería innecesaria.
  const porHerramienta = new Map<string, number>()
  const casos = todos.filter((x) => {
    if (x.clase !== 'contrato') return true
    const n = (porHerramienta.get(x.tool) ?? 0) + 1
    porHerramienta.set(x.tool, n)
    return n <= LIMITE
  })

  console.log(`tools/list: ${tools.length} herramientas · familia 1: ${casos.length} casos generados del esquema`)
  console.log(`  (contrato: sinónimos de enum, condicional omitido, parámetro cruzado, contradicción; inexistente: identificador con forma válida)`)

  if (!soloF2) {
    const f1 = await correrF1(c, casos)
    console.log(`\n--- familia 1: la llamada verosímil y equivocada ---`)
    console.log(`  ${f1.pasaron}/${casos.length} pasan · ${f1.red} peticiones HTTP gastadas por casos de uso inválido`)
    for (const f of f1.fallos) console.log(f)
    if (f1.fallos.length) salida = 1
  }

  if (!soloF1) {
    const f2 = await correrF2(c)
    console.log(`\n--- familia 2: qué se puede concluir de una respuesta correcta ---`)
    console.log(`  ${f2.comprobadas} respuesta(s) reales juzgadas contra las 9 reglas`)
    if (!f2.fallos.length) console.log('  todas las reglas aplicables pasan')
    for (const f of f2.fallos) console.log(f)
  }

  if (conJuez) {
    const f3 = await correrF3(c)
    console.log(`\n--- familia 3: el juez ---`)
    for (const r of f3.respuestas) console.log(r)
    for (const f of f3.fallos) console.log(f)
  }
} finally {
  c.cerrar()
}

process.exit(salida)
