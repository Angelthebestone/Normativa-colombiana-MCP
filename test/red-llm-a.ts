/**
 * Casos del AGENTE A sobre el arnés de fallos de LLM (`test/red-llm.ts`):
 *
 *  1. Determinismo (regla 9): la misma llamada dos veces devuelve el mismo
 *     texto, y la segunda no vuelve a la fuente.
 *  2. Truncamiento por delante (regla 3): la marca de omisión cae en el primer
 *     quinto, comprobado por POSICIÓN y no buscando la cadena en cualquier sitio.
 *  3. Degradación rotulada: con la fuente caída a propósito, la respuesta
 *     degradada pasa el juez (que contesta «no viene de la fuente en vivo»), y
 *     sin la fuente caída el mismo texto no se distingue de una copia en vivo.
 *
 *   npm run build && node --test test/red-llm-a.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import { abrirCliente, LENTO } from './red.ts'
import { FECHA_CONSULTA, juez, reglasQueFalla } from './red-llm.ts'

const GESTOR_1221 = 'https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=31431'

test('determinismo: la misma llamada dos veces devuelve el mismo texto y la segunda no toca la red', LENTO, async () => {
  const c = await abrirCliente()
  try {
    const args = { fuente: 'gestor', id: '31431', articulo: '6' }
    const t0 = c.peticionesAcumuladas()
    const primera = await c.tool('obtener_documento', args)
    const httpPrimera = c.peticionesAcumuladas() - t0
    const t1 = c.peticionesAcumuladas()
    const segunda = await c.tool('obtener_documento', args)
    const httpSegunda = c.peticionesAcumuladas() - t1

    assert.ok(!primera.esError, `la primera llamada falló: ${primera.texto.slice(0, 300)}`)
    assert.ok(!segunda.esError, `la segunda llamada falló: ${segunda.texto.slice(0, 300)}`)
    assert.ok(httpPrimera > 0, 'la primera llamada tiene que costar red: si no, la medición no dice nada')
    assert.equal(httpSegunda, 0, 'la segunda llamada idéntica debe servirse de la copia, sin volver a la fuente')
    assert.equal(segunda.texto, primera.texto, 'dos llamadas idénticas no pueden dar textos distintos')
    assert.ok(FECHA_CONSULTA.test(segunda.texto), 'la respuesta tiene que venir fechada para poder citarla')

    const fallos = reglasQueFalla(segunda.texto, { anterior: primera.texto })
    const regla9 = fallos.filter((f) => f.id === 9)
    assert.equal(regla9.length, 0, `regla 9 (determinismo): ${regla9.map((f) => f.problema).join('; ')}`)
  } finally {
    c.cerrar()
  }
})

test('truncamiento por delante: la marca de omisión cae en el primer quinto del texto', LENTO, async () => {
  const c = await abrirCliente()
  try {
    const r = await c.tool('obtener_documento', { fuente: 'gestor', id: '31431', limite_caracteres: 1500 })
    assert.ok(!r.esError, `la llamada falló: ${r.texto.slice(0, 300)}`)

    const marca = /quedan \d+ sin mostrar|omitid|se muestran \d+ desde|los demás no caben|truncad/i.exec(r.texto)
    assert.ok(marca, `la respuesta debía declarar la omisión y no lo hace: ${r.texto.slice(0, 300)}`)

    // La posición se mide; no vale encontrarla en cualquier parte del texto.
    const posicion = marca.index
    const techo = Math.ceil(r.texto.length / 5)
    const porcentaje = ((posicion / r.texto.length) * 100).toFixed(0)
    assert.ok(
      posicion <= techo,
      `la marca de omisión cae en el carácter ${posicion} de ${r.texto.length} (${porcentaje} %): fuera del primer quinto`,
    )

    const regla3 = reglasQueFalla(r.texto).filter((f) => f.id === 3)
    assert.equal(regla3.length, 0, `regla 3 (truncamiento por delante): ${regla3.map((f) => f.problema).join('; ')}`)
  } finally {
    c.cerrar()
  }
})

test('degradación sin rotular no se sirve: con la fuente caída y la copia vencida, la llamada falla en vez de devolver la copia muda', LENTO, async () => {
  // Va EN PROCESO y no por stdio: `FUENTE_CAIDA` se lee del entorno en cada
  // petición, pero un hijo ya lanzado tiene su propia copia del entorno, así que
  // encender la caída a mitad de prueba no llega al servidor y la prueba mediría
  // el fallo en vez de la degradación. Importando `pedir` directamente sí llega.
  const { pedir } = await import('../src/nucleo/http.ts')
  process.env['TTL_COPIA_MS'] = '0' // la copia nace vencida
  try {
    // Calentamiento con el portal ARRIBA: primero se guarda la copia, y solo
    // después se fuerza la caída.
    await pedir(GESTOR_1221, 60_000).catch(() => null)

    process.env['FUENTE_CAIDA'] = 'www.funcionpublica.gov.co'
    const r = await pedir(GESTOR_1221, 60_000).catch((e: Error) => e)

    const texto = r instanceof Error ? r.message : r.cuerpo
    const rotula = /no respondi[oó]|viene de una copia|degradad|AVISO/i.test(texto)
    assert.ok(
      r instanceof Error || rotula,
      `se sirvió la copia sin decir que la fuente no respondió: ${texto.slice(0, 200)}`,
    )
  } finally {
    delete process.env['FUENTE_CAIDA']
    delete process.env['TTL_COPIA_MS']
  }
})

test('degradación rotulada: el juez no la confunde con la fuente en vivo', LENTO, async () => {
  // La respuesta degradada que produce la capa de transporte, tal como debe
  // pegarla quien la sirva: el rótulo delante del texto.
  const { pedir } = await import('../src/nucleo/http.ts')
  process.env['TTL_COPIA_MS'] = '0'
  try {
    await pedir(GESTOR_1221)
    process.env['FUENTE_CAIDA'] = 'www.funcionpublica.gov.co'
    const copia = await pedir(GESTOR_1221, 60_000, 'text/html,*/*', {}, undefined, { degradarDesdeCopia: true })
    assert.equal(copia.degradada, true, 'con el portal caído y copia en memoria, la respuesta debe ir degradada')
    assert.ok(copia.avisoCopia && /no respondió/.test(copia.avisoCopia), 'la degradada tiene que traer su rótulo')

    const pregunta = '¿este texto viene de la fuente en vivo? Responde SI, NO o NOSESABE.'
    const rotulada = juez(pregunta, `${copia.avisoCopia}\n\n${copia.cuerpo}`)
    const control = juez(pregunta, copia.cuerpo)

    assert.notEqual(rotulada.respuesta, 'OTRO', `el juez no contestó SI/NO/NOSESABE: ${rotulada.bruto.slice(-200)}`)
    assert.notEqual(
      rotulada.respuesta,
      'SI',
      `con el rótulo delante, el juez siguió diciendo que el texto viene de la fuente en vivo (control sin rótulo: ${control.respuesta})`,
    )
    console.log(
      `juez → con rótulo: ${rotulada.respuesta} (${rotulada.ms} ms) · sin rótulo: ${control.respuesta} (${control.ms} ms)`,
    )
  } finally {
    delete process.env['FUENTE_CAIDA']
    delete process.env['TTL_COPIA_MS']
  }
})
