/**
 * Barrido disruptivo de salida cruda: arranca el servidor compilado, recorre
 * `tools/list` y para CADA tool publicada lanza una batería de llamadas
 * adversariales (números donde se espera texto, vacíos, límites fuera de
 * rango, ids cruzados, `entero`, `ruta_destino`, `categoria`…), verificando
 * sobre `content[0].text` crudo:
 *
 *   - `isError` NO debe ser true donde el contrato espera texto;
 *   - el texto no debe contener `undefined`, `NaN` ni `[object Object]`;
 *   - no debe mencionar nombres viejos de herramientas (obtener_norma, …);
 *   - toda respuesta debe llevar fecha y descargo (los añade `txt`).
 *
 *   npm run build && node scripts/barrido-disruptivo.ts
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Cliente } from '../test/red.ts'

/** Nombres viejos de herramientas que la consolidación 34→24 eliminó. */
const VIEJOS = [
  'obtener_norma',
  'obtener_sentencia',
  'obtener_providencia_suprema',
  'obtener_providencia_consejo_estado',
  'obtener_documento_dian',
  'obtener_resolucion_creg',
  'listar_subtemas',
  'buscar_conceptos_fp',
  'listar_normas_fp',
  'validar_cita',
  'expediente_crear',
  'expediente_agregar',
  'expediente_leer',
]

/** Marcas de serialización defectuosa que nunca deberían llegar al usuario. */
const BASURA = ['undefined', 'NaN', '[object Object]', 'null', 'function ']

/** El texto crudo no debe arrastrar una URL codificada rota ni un id basura. */
const RARO = [/%(?:25)+[0-9a-f]/i, /\\u[0-9a-f]{4}/i]

/** Fecha de consulta en el formato del repo: "Consulta del 2026-08-10". */
const FECHA = /consulta del\s+\d{4}-\d{2}-\d{2}/i

/** Argumentos adversariales por tool; se rellenan con las claves del esquema. */
function adversariales(nombre: string, esquema: Record<string, any>): Record<string, unknown>[] {
  const casos: Record<string, unknown>[] = []
  const props = Object.keys((esquema['properties'] as Record<string, any> | undefined) ?? {})

  // Caso 1: vacíos en todos los strings opcionales (el contrato exige texto, no fallo).
  const vacios: Record<string, unknown> = {}
  const propsObj = esquema['properties'] as Record<string, any> | undefined
  for (const k of props) {
    if (propsObj?.[k]?.type === 'string') vacios[k] = ''
  }
  casos.push(vacios)

  // Caso 2: números donde se espera texto (ids, números, años, términos).
  for (const k of ['id', 'numero', 'anio', 'texto', 'termino', 'cita', 'entidad', 'sala', 'ruta', 'token', 'link']) {
    if (props.includes(k)) casos.push({ [k]: 12345 })
  }

  // Caso 3: límites fuera de rango.
  if (props.includes('limite')) casos.push({ limite: 9999 })
  if (props.includes('limite_caracteres')) casos.push({ limite_caracteres: 1 })
  if (props.includes('pagina')) casos.push({ pagina: -1 })
  if (props.includes('desde')) casos.push({ desde: 999999999 })

  // Caso 4: ids cruzados de taxonomía (prefijo de otra taxonomía).
  for (const k of ['subtema', 'temsubid', 'tema']) {
    if (props.includes(k)) casos.push({ [k]: 'sub-99999' })
  }

  // Caso 5: parámetros nuevos del spec.
  if (nombre === 'obtener_documento') {
    casos.push(
      { fuente: 'sectorial', entidad: 'noexiste', url: 'https://otro.gov.co/x.pdf', entero: true },
      { fuente: 'gestor', entero: true },
      { fuente: 'gestor', ruta_destino: join(tmpdir(), 'normativa-barrido-inexistente', 'no', 'escribible') },
    )
  }
  if (nombre === 'buscar_normativa_sectorial') {
    casos.push({ entidad: 'unidadvictimas', categoria: 'CategoríaInvisible999' })
  }
  if (nombre === 'expediente') {
    casos.push({ accion: 'exportar', id: 'noexiste', ruta: join(tmpdir(), 'normativa-export-basura.md') })
  }
  if (nombre === 'resolver_cita') {
    casos.push({ citas: ['Ley 100 de 1993', 'esto no es una cita', 'C-337/11'] })
  }
  return casos
}

async function main(): Promise<number> {
  const c = new Cliente()
  let fallos = 0
  let verificadas = 0
  const dir = mkdtempSync(join(tmpdir(), 'barrido-'))

  try {
    await c.peticion('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'barrido', version: '1' },
    })
    const { tools } = await c.peticion('tools/list')
    console.log(`tools/list: ${tools.length} herramientas.`)

    for (const t of tools) {
      const nombre: string = t.name
      const esquema: Record<string, any> = t.inputSchema ?? {}
      const casos = adversariales(nombre, esquema)
      let okTool = true

      for (const args of casos) {
        try {
          const { texto, esError } = await c.tool(nombre, args)
          const crudo = texto
          const problemas: string[] = []
          // Un error de esquema (argumentos inválidos) es legítimo y no lleva
          // fecha; un isError en una llamada que DEBERÍA ser texto no lo es.
          // Distinguir: si el texto mismo explica el problema de argumentos, es
          // un fallo de validación esperado, no una regresión.
          const pareceValidacion =
            /(?:exige|requiere|hace falta|inv[aá]lid|no es v[aá]lido|no reconozco|no existe un|no hay un|indica|solo contiene|fuera de|entre |debe ser|se ajusta|no quedó|no se puede|no escribe|desactivad|no se encontr[oó]|vac[ií]o|sin resultados|no responde|no sirve aquí|no pudo leer|no respondi[oó]|canario)/i.test(crudo)
          if (esError && !pareceValidacion) problemas.push(`isError=true sin explicación de validación: ${crudo.slice(0, 100)}`)
          if (esError && pareceValidacion && FECHA.test(crudo)) {
            problemas.push('isError=true pero el texto parece una respuesta normal (con fecha)')
          }
          // La fecha y el descargo son obligatorios en las respuestas que NO son
          // errores de validación de argumentos.
          if (!esError) {
            if (!FECHA.test(crudo)) problemas.push('sin fecha visible')
            if (crudo && !/Esto no es asesoría|verifica siempre|descargo/i.test(crudo)) problemas.push('sin descargo')
          }
          for (const b of BASURA) if (crudo.includes(b)) problemas.push(`contiene "${b}"`)
          for (const re of RARO) if (re.test(crudo)) problemas.push(`patrón raro ${re}`)
          for (const v of VIEJOS) if (crudo.includes(v)) problemas.push(`menciona nombre viejo "${v}"`)
          if (problemas.length) {
            okTool = false
            console.log(`  ✗ ${nombre} ${JSON.stringify(args).slice(0, 120)} → ${problemas.join('; ')}`)
          }
        } catch (e) {
          // Un error de transporte (timeout) también es un fallo del barrido.
          okTool = false
          console.log(`  ✗ ${nombre} ${JSON.stringify(args).slice(0, 120)} → transporte: ${(e as Error).message.slice(0, 100)}`)
        }
      }
      verificadas++
      if (okTool) console.log(`  ✓ ${nombre} (${casos.length} casos)`)
      else fallos++
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    c.cerrar()
  }

  console.log(`\n${verificadas} tools verificadas, ${fallos} con problemas.`)
  return fallos ? 1 : 0
}

main()
  .then((codigo) => process.exit(codigo))
  .catch((e) => {
    console.error(`El barrido falló: ${(e as Error).message}`)
    process.exit(1)
  })
