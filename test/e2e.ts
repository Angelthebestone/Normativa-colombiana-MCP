/**
 * Pruebas de extremo a extremo: arrancan el servidor compilado y le hablan por
 * stdio con JSON-RPC, exactamente como hace Claude Desktop.
 *
 * Existen porque los dos lotes de fallos reportados desde Desktop nacieron
 * todos en esta capa —rótulos engañosos, esquemas sin tipar, una herramienta
 * que fallaba siempre— y las pruebas de biblioteca no la tocan.
 *
 *   npm run build && node --test test/e2e.ts
 */
import { strict as assert } from 'node:assert'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test, { after, before } from 'node:test'

const SERVIDOR = fileURLToPath(new URL('../server/index.js', import.meta.url))
const LENTO = { timeout: 240_000 }

class Cliente {
  private proc: ChildProcessWithoutNullStreams
  private buffer = ''
  private siguiente = 1
  private pendientes = new Map<number, { ok: (v: any) => void; fallo: (e: Error) => void }>()

  constructor() {
    this.proc = spawn(process.execPath, [SERVIDOR], { stdio: ['pipe', 'pipe', 'pipe'] })
    this.proc.stdout.on('data', (d: Buffer) => {
      this.buffer += d.toString('utf8')
      let corte: number
      while ((corte = this.buffer.indexOf('\n')) !== -1) {
        const linea = this.buffer.slice(0, corte).trim()
        this.buffer = this.buffer.slice(corte + 1)
        if (!linea) continue
        const msg = JSON.parse(linea)
        const p = this.pendientes.get(msg.id)
        if (!p) continue
        this.pendientes.delete(msg.id)
        msg.error ? p.fallo(new Error(JSON.stringify(msg.error))) : p.ok(msg.result)
      }
    })
  }

  peticion(method: string, params?: unknown): Promise<any> {
    const id = this.siguiente++
    return new Promise((ok, fallo) => {
      this.pendientes.set(id, { ok, fallo })
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
      setTimeout(() => {
        if (this.pendientes.delete(id)) fallo(new Error(`sin respuesta a ${method} tras 120 s`))
      }, 120_000)
    })
  }

  /** Devuelve el texto de la herramienta. `isError` distingue fallo real de "no hay resultados". */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<{ texto: string; esError: boolean }> {
    const r = await this.peticion('tools/call', { name, arguments: args })
    return { texto: r.content?.[0]?.text ?? '', esError: r.isError === true }
  }

  cerrar() {
    this.proc.kill()
  }
}

let c: Cliente

before(async () => {
  c = new Cliente()
  const r = await c.peticion('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pruebas', version: '1' },
  })
  assert.equal(r.serverInfo.name, 'normativa-colombia')
})

after(() => c?.cerrar())

// --- contrato que ve el cliente -----------------------------------------

test('las 11 herramientas se declaran con esquemas utilizables', LENTO, async () => {
  const { tools } = await c.peticion('tools/list')
  assert.equal(tools.length, 11, tools.map((t: any) => t.name).join(', '))

  const sinTipo: string[] = []
  for (const t of tools) {
    assert.ok(t.description?.length > 40, `${t.name} necesita una descripción útil`)
    for (const [campo, esquema] of Object.entries(t.inputSchema.properties ?? {})) {
      // Un `{}` deja al cliente adivinando si mandar 909 o "909".
      if (!Object.keys(esquema as object).length) sinTipo.push(`${t.name}.${campo}`)
    }
  }
  assert.deepEqual(sinTipo, [], `campos sin tipo: ${sinTipo.join(', ')}`)

  const sentencia = tools.find((t: any) => t.name === 'obtener_sentencia')
  assert.deepEqual(sentencia.inputSchema.required, ['ruta'], 'lo obligatorio debe declararse obligatorio')
})

test('los prompts se declaran y se resuelven', LENTO, async () => {
  const { prompts } = await c.peticion('prompts/list')
  assert.equal(prompts.length, 4)
  const p = await c.peticion('prompts/get', { name: 'sigue-vigente', arguments: { norma: 'Ley 909 de 2004' } })
  assert.match(p.messages[0].content.text, /Ley 909 de 2004/)
})

test('los identificadores se aceptan como número y como texto', LENTO, async () => {
  // Un modelo manda `id: 31431` con la misma naturalidad que `id: "31431"`.
  // Exigir solo texto convertía eso en un -32602 y la herramienta parecía rota.
  for (const [name, args] of [
    ['obtener_norma', { id: 31431 }],
    ['listar_subtemas', { tema_id: 36496 }],
    ['explicar_relacion_tema', { temsubid: 24928, normid: 31431 }],
    ['buscar_normas', { tipo_documento: 'Ley', numero: 909, anio: 2004 }],
  ] as const) {
    const r = await c.peticion('tools/call', { name, arguments: args }).catch((e: Error) => e)
    assert.ok(!(r instanceof Error), `${name} rechazó argumentos numéricos: ${r}`)
    assert.notEqual((r as any).isError, true, `${name} falló con argumentos numéricos`)
  }
})

// --- cada respuesta debe poder citarse ----------------------------------

test('toda respuesta lleva fecha de consulta y descargo', LENTO, async () => {
  for (const [name, args] of [
    ['resolver_cita', { cita: 'Ley 909 de 2004' }],
    ['listar_catalogos', { catalogo: 'tipos' }],
    ['resolver_cita', { cita: 'no es una cita' }],
  ] as const) {
    const { texto } = await c.tool(name, args)
    assert.match(texto, /Consulta del \d{4}-\d{2}-\d{2}\./, `${name} sin fecha`)
    assert.match(texto, /Verifica siempre en el enlace/, `${name} sin descargo`)
  }
})

// --- los fallos reportados desde Desktop --------------------------------

test('el extracto temático no se presenta como resumen de la norma', LENTO, async () => {
  // El Decreto 1083 salía descrito como una norma sobre elección de personeros.
  const { texto } = await c.tool('resolver_cita', { cita: 'Decreto 1083 de 2015' })
  assert.match(texto, /Decreto 1083 de 2015/)
  assert.doesNotMatch(texto, /\bResumen:/, 'el restrictor no es un resumen de la norma')
  assert.match(texto, /NO resume la norma/)
})

test('explicar_relacion_tema dice a qué tema corresponde', LENTO, async () => {
  const { texto } = await c.tool('explicar_relacion_tema', { temsubid: '24928', normid: '31431' })
  assert.match(texto, /Tema \/ subtema:/, 'sin el rótulo no se puede verificar la respuesta')
  assert.match(texto, /PROVISIÓN/, 'el rótulo debe salir con la tilde normalizada')
  assert.match(texto, /Teletrabajo/)
})

test('un término que no aparece en ningún resultado se señala', LENTO, async () => {
  const { texto } = await c.tool('buscar_normas', { palabras: 'zopilote interconectado', limite: 2 })
  assert.match(texto, /"zopilote" no aparece/)
})

test('el vacío enumera los filtros que sí se aplicaron', LENTO, async () => {
  const { texto, esError } = await c.tool('buscar_normas', {
    entidad: 'Ministerio de Minas y Energía',
    anio: '2023',
  })
  assert.equal(esError, false, 'cero resultados no es un fallo de la herramienta')
  assert.match(texto, /id 243/, 'debe constar que la entidad sí se resolvió')
  assert.match(texto, /no existe esa combinación/)
})

test('la búsqueda por palabras cae a la vía temática cuando rinde poco', LENTO, async () => {
  const { texto } = await c.tool('buscar_normas', {
    palabras: 'teletrabajo',
    tipo_documento: 'Concepto',
    limite: 3,
  })
  assert.match(texto, /subtema oficial/, 'debe explicar de dónde salieron los documentos')
  assert.doesNotMatch(texto, /^0 documento/m)
})

test('la jurisprudencia excluye autos salvo que se pidan', LENTO, async () => {
  const { texto } = await c.tool('buscar_jurisprudencia', { termino: 'prima de servicios', limite: 5 })
  const sentencias = [...texto.matchAll(/^- (\S+)/gm)].map((m) => m[1]!)
  assert.ok(sentencias.length > 0, texto.slice(0, 200))
  assert.ok(
    sentencias.every((s) => !/^A/i.test(s)),
    `no debería haber autos por defecto: ${sentencias.join(', ')}`,
  )
})

// --- documentos grandes y errores ---------------------------------------

test('el Decreto 1083 nunca se devuelve entero', LENTO, async () => {
  const { texto } = await c.tool('obtener_norma', { id: '62866' })
  assert.ok(texto.length < 40_000, `devolvió ${texto.length} caracteres`)
  assert.match(texto, /quedan \d+ sin mostrar/)
})

test('buscar_en_texto agrupa pasajes y prioriza los temas pertinentes', LENTO, async () => {
  const { texto } = await c.tool('obtener_norma', { id: '62866', buscar_en_texto: 'encargo' })
  assert.match(texto, /agrupadas en \d+ pasaje/)
  assert.match(texto, /Temas asociados \(\d+ de \d+, primero los que mencionan lo buscado\)/)
})

test('lo inexistente se informa como texto, no como fallo de herramienta', LENTO, async () => {
  const norma = await c.tool('obtener_norma', { id: '99999999' })
  assert.equal(norma.esError, false)
  assert.match(norma.texto, /No encontré una norma con id 99999999/)

  const prov = await c.tool('obtener_sentencia', { ruta: '2024/NO-EXISTE-99.htm' })
  assert.equal(prov.esError, false)
  assert.match(prov.texto, /No existe una providencia/)
})

// --- las herramientas que nadie había ejercitado ------------------------

test('listar_normas_fp responde sin duplicados y con resumen separado', LENTO, async () => {
  const { texto } = await c.tool('listar_normas_fp', { limite: 100 })
  const ids = [...texto.matchAll(/\(id (\d+)\)/g)].map((m) => m[1]!)
  assert.ok(ids.length > 50, `solo ${ids.length} normas`)
  assert.equal(new Set(ids).size, ids.length, 'el listado del portal repite entradas')
  assert.doesNotMatch(texto, /de \d{4}[A-ZÁÉÍÓÚ]/, 'título y resumen quedaron pegados')
})

test('listar_catalogos exige filtro en temas y resuelve entidades', LENTO, async () => {
  const temas = await c.tool('listar_catalogos', { catalogo: 'temas' })
  assert.match(temas.texto, /indica un filtro/i)
  const ent = await c.tool('listar_catalogos', { catalogo: 'entidades', filtro: 'minas' })
  assert.match(ent.texto, /id 243/)
})

test('listar_subtemas y buscar_conceptos_fp responden', LENTO, async () => {
  const sub = await c.tool('listar_subtemas', { tema_id: '36496' })
  assert.ok(sub.texto.split('\n').length > 10)
  const con = await c.tool('buscar_conceptos_fp', { anio: '2024', limite: 3 })
  assert.match(con.texto, /2024/)
})

test('buscar_por_tema responde con temsubid y rótulos normalizados', LENTO, async () => {
  const { texto } = await c.tool('buscar_por_tema', { texto: 'teletrabajo', limite: 5 })
  assert.match(texto, /temsubid \d+/)
  assert.doesNotMatch(texto, /PROVISIóN/, 'el rótulo debe salir normalizado')
})
