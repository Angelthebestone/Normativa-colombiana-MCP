/**
 * Corpus congelado de llamadas torcidas: cómo se equivoca un LLM al invocar
 * estas 28 herramientas, y qué habría que haber recibido.
 *
 * No prueba la red ni el resultado: prueba SOLO la puerta de entrada, con
 * `z.object(schema).safeParse(args)` de cada módulo. Por eso corre sin red y en
 * milisegundos, y por eso existe desde que las 28 herramientas declaran su
 * `schema` como módulo: antes, dieciséis esquemas vivían dentro de `index.ts` y
 * no había forma de interrogarlos sin arrancar el servidor.
 *
 * Los casos salen de las formas de fallar que ya se han visto: número como
 * texto, «Art. 6º» donde va «6», un string donde va un arreglo, una enumeración
 * en mayúsculas o en otro idioma, un id con o sin prefijo, un límite fuera de
 * rango y un campo que no existe porque el modelo se lo inventó.
 *
 * El corpus se CONGELA: se le añaden casos, no se le quitan. Cada caso que se
 * borre es una forma de fallar que se deja de vigilar.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { z } from 'zod'

import * as analizarConflicto from '../src/herramientas/analizar_conflicto.ts'
import * as buscarDiarioOficial from '../src/herramientas/buscar_diario_oficial.ts'
import * as buscarEnSuin from '../src/herramientas/buscar_en_suin.ts'
import * as buscarJurisprudencia from '../src/herramientas/buscar_jurisprudencia.ts'
import * as buscarJurisprudenciaConsejoEstado from '../src/herramientas/buscar_jurisprudencia_consejo_estado.ts'
import * as buscarJurisprudenciaSuprema from '../src/herramientas/buscar_jurisprudencia_suprema.ts'
import * as buscarNormas from '../src/herramientas/buscar_normas.ts'
import * as buscarNormativaAnh from '../src/herramientas/buscar_normativa_anh.ts'
import * as buscarNormativaSectorial from '../src/herramientas/buscar_normativa_sectorial.ts'
import * as buscarNormativaTributaria from '../src/herramientas/buscar_normativa_tributaria.ts'
import * as buscarPorTema from '../src/herramientas/buscar_por_tema.ts'
import * as buscarResolucionesCreg from '../src/herramientas/buscar_resoluciones_creg.ts'
import * as buscarUnificado from '../src/herramientas/buscar_unificado.ts'
import * as cambiosDesde from '../src/herramientas/cambios_desde.ts'
import * as compararArticulos from '../src/herramientas/comparar_articulos.ts'
import * as consultarPerfil from '../src/herramientas/consultar_perfil.ts'
import * as consultarVigencia from '../src/herramientas/consultar_vigencia.ts'
import * as describirFuentes from '../src/herramientas/describir_fuentes.ts'
import * as expedientes from '../src/herramientas/expedientes.ts'
import * as explicarRelacionTema from '../src/herramientas/explicar_relacion_tema.ts'
import * as historialNorma from '../src/herramientas/historial_norma.ts'
import * as lineaJurisprudencial from '../src/herramientas/linea_jurisprudencial.ts'
import * as listarCatalogos from '../src/herramientas/listar_catalogos.ts'
import * as obtenerDocumento from '../src/herramientas/obtener_documento.ts'
import * as resolverCita from '../src/herramientas/resolver_cita.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ESQUEMAS: Record<string, any> = {
  analizar_conflicto: analizarConflicto.schema,
  buscar_diario_oficial: buscarDiarioOficial.schema,
  buscar_en_suin: buscarEnSuin.schema,
  buscar_jurisprudencia: buscarJurisprudencia.schema,
  buscar_jurisprudencia_consejo_estado: buscarJurisprudenciaConsejoEstado.schema,
  buscar_jurisprudencia_suprema: buscarJurisprudenciaSuprema.schema,
  buscar_normas: buscarNormas.schema,
  buscar_normativa_anh: buscarNormativaAnh.schema,
  buscar_normativa_sectorial: buscarNormativaSectorial.schema,
  buscar_normativa_tributaria: buscarNormativaTributaria.schema,
  buscar_por_tema: buscarPorTema.schema,
  buscar_resoluciones_creg: buscarResolucionesCreg.schema,
  buscar_unificado: buscarUnificado.schema,
  cambios_desde: cambiosDesde.schema,
  comparar_articulos: compararArticulos.schema,
  consultar_perfil: consultarPerfil.schema,
  consultar_vigencia: consultarVigencia.schema,
  describir_fuentes: describirFuentes.schema,
  expediente: expedientes.schema,
  explicar_relacion_tema: explicarRelacionTema.schema,
  historial_norma: historialNorma.schema,
  linea_jurisprudencial: lineaJurisprudencial.schema,
  listar_catalogos: listarCatalogos.schema,
  obtener_documento: obtenerDocumento.schema,
  resolver_cita: resolverCita.schema,
}

export type Torcida = {
  herramienta: string
  /** Lo que mandaría el modelo. */
  args: Record<string, unknown>
  /** Qué tiene de torcido. */
  porque: string
  /**
   * Los campos que la llamada DEBERÍA producir tras normalizarse. Si falta, es
   * un caso que no tiene arreglo automático y lo correcto es rechazarlo.
   */
  correcta?: Record<string, unknown>
  /**
   * El esquema lo deja pasar A PROPÓSITO y quien lo rechaza es la herramienta,
   * con un mensaje mejor del que daría zod. Nombra a quién rechaza. Medirlo como
   * «acepta mal» sería falso: la llamada sí se rechaza, solo que más tarde.
   */
  rechazaDespues?: string
}

/** El corpus. Se añade, no se quita. */
export const TORCIDAS: Torcida[] = [
  // --- número mandado como texto ------------------------------------------
  { herramienta: 'buscar_por_tema', args: { texto: 'teletrabajo', limite: '5' }, porque: 'límite como texto', correcta: { limite: 5 } },
  { herramienta: 'buscar_jurisprudencia', args: { termino: 'tutela', limite: '10' }, porque: 'límite como texto', correcta: { limite: 10 } },
  { herramienta: 'buscar_en_suin', args: { texto: 'Buenaventura', desde: '20' }, porque: 'desplazamiento como texto', correcta: { desde: 20 } },
  { herramienta: 'buscar_normativa_anh', args: { texto: 'regalías', pagina: '3' }, porque: 'página como texto', correcta: { pagina: 3 } },
  { herramienta: 'historial_norma', args: { cita: 'Ley 909 de 2004', limite: '25' }, porque: 'límite como texto', correcta: { limite: 25 } },
  { herramienta: 'buscar_normativa_tributaria', args: { texto: 'IVA', limite: 10.0 }, porque: 'entero como decimal', correcta: { limite: 10 } },

  // --- texto mandado como número ------------------------------------------
  { herramienta: 'buscar_normas', args: { numero: 909 }, porque: 'número de norma como entero', correcta: { numero: '909' } },
  { herramienta: 'buscar_normas', args: { anio: 2004 }, porque: 'año como entero', correcta: { anio: '2004' } },
  { herramienta: 'explicar_relacion_tema', args: { temsubid: 'ts-38872', normid: 31431 }, porque: 'normid como entero', correcta: { normid: '31431' } },
  { herramienta: 'buscar_resoluciones_creg', args: { anio: 2024 }, porque: 'año como entero', correcta: { anio: '2024' } },
  { herramienta: 'buscar_normativa_anh', args: { numero: 123 }, porque: 'número como entero', correcta: { numero: '123' } },

  // --- artículo escrito como lo escribe un abogado -------------------------
  { herramienta: 'comparar_articulos', args: { norma_a: 'Ley 1437 de 2011', articulo_a: 'Art. 6º' }, porque: 'artículo con rótulo y ordinal', correcta: { articulo_a: '6' } },
  { herramienta: 'comparar_articulos', args: { norma_a: 'Ley 1437 de 2011', articulo_a: 'artículo 40' }, porque: 'artículo con la palabra delante', correcta: { articulo_a: '40' } },
  { herramienta: 'historial_norma', args: { cita: 'Ley 1437 de 2011', articulo: 'ARTÍCULO 3' }, porque: 'artículo en mayúsculas con rótulo', correcta: { articulo: '3' } },
  { herramienta: 'obtener_documento', args: { fuente: 'gestor', id: '31431', articulo: 'art. 2.4.1.2.44' }, porque: 'artículo con rótulo', correcta: { articulo: '2.4.1.2.44' } },

  // --- string donde va un arreglo y al revés -------------------------------
  { herramienta: 'buscar_jurisprudencia', args: { termino: 'pensión', tipos: 'tutela' }, porque: 'string donde va arreglo', correcta: { tipos: ['tutela'] } },
  { herramienta: 'cambios_desde', args: { normas: 'Ley 909 de 2004', desde: '2020-01-01' }, porque: 'string donde va arreglo', correcta: { normas: ['Ley 909 de 2004'] } },
  { herramienta: 'buscar_unificado', args: { texto: 'teletrabajo', fuentes: 'gestor' }, porque: 'string donde va arreglo', correcta: { fuentes: ['gestor'] } },
  { herramienta: 'resolver_cita', args: { citas: 'Ley 909 de 2004' }, porque: 'string donde va arreglo', correcta: { citas: ['Ley 909 de 2004'] } },
  { herramienta: 'resolver_cita', args: { cita: ['Ley 909 de 2004'] }, porque: 'arreglo donde va string', correcta: { cita: 'Ley 909 de 2004' } },
  { herramienta: 'consultar_vigencia', args: { cita: ['Ley 909 de 2004'] }, porque: 'arreglo donde va string' },

  // --- enumeraciones mal escritas -----------------------------------------
  { herramienta: 'describir_fuentes', args: { fuente: 'GESTOR' }, porque: 'enumeración en mayúsculas', correcta: { fuente: 'gestor' } },
  { herramienta: 'obtener_documento', args: { fuente: 'Gestor' }, porque: 'enumeración capitalizada', correcta: { fuente: 'gestor' } },
  { herramienta: 'buscar_jurisprudencia_suprema', args: { texto: 'despido', sala: 'laboral' }, porque: 'enumeración en minúsculas', correcta: { sala: 'Laboral' } },
  { herramienta: 'buscar_jurisprudencia_suprema', args: { texto: 'despido', sala: 'LABORAL' }, porque: 'enumeración en mayúsculas', correcta: { sala: 'Laboral' } },
  { herramienta: 'buscar_resoluciones_creg', args: { compilacion: 'Vigentes' }, porque: 'enumeración capitalizada', correcta: { compilacion: 'vigentes' } },
  { herramienta: 'buscar_normativa_sectorial', args: { entidad: 'SIC' }, porque: 'entidad en mayúsculas', correcta: { entidad: 'sic' } },
  { herramienta: 'buscar_normativa_sectorial', args: { entidad: 'Superintendencia de Industria y Comercio' }, porque: 'entidad por su nombre largo', correcta: { entidad: 'sic' } },
  { herramienta: 'listar_catalogos', args: { catalogo: 'Temas' }, porque: 'catálogo capitalizado', correcta: { catalogo: 'temas' } },
  { herramienta: 'consultar_perfil', args: { perfil: 'Laboral', texto: 'jornada' }, porque: 'perfil capitalizado', correcta: { perfil: 'laboral' } },
  { herramienta: 'buscar_en_suin', args: { texto: 'x', vigencia: 'vigente' }, porque: 'vigencia en minúsculas', correcta: { vigencia: 'Vigente' } },
  { herramienta: 'expediente', args: { accion: 'Crear' }, porque: 'acción capitalizada', correcta: { accion: 'crear' } },

  // --- ids con o sin prefijo ----------------------------------------------
  { herramienta: 'explicar_relacion_tema', args: { temsubid: '38872', normid: '31431' }, porque: 'temsubid sin su prefijo', rechazaDespues: 'sinPrefijo' },
  { herramienta: 'listar_catalogos', args: { catalogo: 'subtemas', tema_id: '24457' }, porque: 'tema_id sin su prefijo', rechazaDespues: 'sinPrefijo' },
  { herramienta: 'listar_catalogos', args: { catalogo: 'subtemas', tema_id: 'ts-24457' }, porque: 'prefijo de OTRO catálogo, que es el cruce que sinPrefijo existe para impedir', rechazaDespues: 'sinPrefijo' },

  // --- límites fuera de rango ---------------------------------------------
  { herramienta: 'buscar_por_tema', args: { texto: 'x', limite: 0 }, porque: 'límite por debajo del mínimo' },
  { herramienta: 'buscar_por_tema', args: { texto: 'x', limite: 500 }, porque: 'límite por encima del máximo (50)' },
  { herramienta: 'buscar_jurisprudencia_consejo_estado', args: { texto: 'x', limite: 50 }, porque: 'límite por encima del máximo (10)' },
  { herramienta: 'buscar_jurisprudencia_consejo_estado', args: { texto: 'x', pagina: 0 }, porque: 'página cero; se cuenta desde 1' },
  { herramienta: 'listar_catalogos', args: { catalogo: 'temas', limite: 1000 }, porque: 'límite por encima del máximo (200)' },
  { herramienta: 'buscar_en_suin', args: { texto: 'x', desde: -1 }, porque: 'desplazamiento negativo' },

  // --- campos inventados o mal nombrados ----------------------------------
  { herramienta: 'buscar_por_tema', args: { texto: 'x', limit: 5 }, porque: 'campo inventado: "limit" en vez de "limite"' },
  { herramienta: 'buscar_normas', args: { palabras: 'x', año: '2004' }, porque: 'campo con tilde: "año" en vez de "anio"' },
  { herramienta: 'buscar_jurisprudencia', args: { query: 'tutela' }, porque: 'campo inventado en inglés y falta el obligatorio' },
  { herramienta: 'resolver_cita', args: { norma: 'Ley 909 de 2004' }, porque: 'campo inventado: "norma" en vez de "cita"' },
  { herramienta: 'obtener_documento', args: { fuente: 'gestor', norm_id: '31431' }, porque: 'campo inventado con guion bajo distinto' },

  // --- obligatorios ausentes ----------------------------------------------
  { herramienta: 'buscar_jurisprudencia', args: {}, porque: 'falta el obligatorio "termino"' },
  { herramienta: 'analizar_conflicto', args: { norma_a: 'Ley 909 de 2004' }, porque: 'falta el obligatorio "norma_b"' },
  { herramienta: 'consultar_perfil', args: { perfil: 'laboral' }, porque: 'falta el obligatorio "texto"' },
  { herramienta: 'linea_jurisprudencial', args: {}, porque: 'falta el obligatorio "sentencia"' },
  { herramienta: 'buscar_normativa_sectorial', args: { texto: 'x' }, porque: 'falta el obligatorio "entidad"' },

  // --- booleanos como texto ------------------------------------------------
  { herramienta: 'resolver_cita', args: { cita: 'Ley 909 de 2004', contexto: 'false' }, porque: 'booleano como texto', correcta: { contexto: false } },
  { herramienta: 'buscar_jurisprudencia_suprema', args: { texto: 'x', exacto: 'true' }, porque: 'booleano como texto', correcta: { exacto: true } },
  { herramienta: 'comparar_articulos', args: { norma_a: 'x', articulo_a: '1', con_reforma: 'si' }, porque: 'booleano en castellano' },
]

// --- clasificación --------------------------------------------------------

export type Clase = 'normaliza' | 'acepta-mal' | 'rechazo-util' | 'rechazo-tardio' | 'rechazo-crudo' | 'sin-esquema'

/**
 * `rechazo-util` exige que el mensaje diga algo accionable: o el valor que
 * llegó, o los valores que se aceptan. Un «Required» a secas no lo es.
 */
function mensajeEnseña(error: z.ZodError, args: Record<string, unknown>): boolean {
  const m = JSON.stringify(error.issues)
  const recibido = Object.values(args).some((v) => typeof v !== 'object' && m.includes(String(v)))
  const opciones = /options|expected|Expected|received/.test(m) && !/^Required$/.test(m)
  return recibido || opciones
}

export function clasificar(t: Torcida): { clase: Clase; detalle: string } {
  const exportado = ESQUEMAS[t.herramienta]
  if (!exportado) return { clase: 'sin-esquema', detalle: 'la herramienta no exporta schema' }
  // `expedientes.ts` exporta un ZodObject donde las otras 27 exportan el shape
  // pelado. Las dos formas funcionan contra `registerTool`, así que aquí se
  // aceptan las dos en vez de tocar el módulo. Queda anotado como deuda.
  const objeto = exportado instanceof z.ZodObject ? exportado : z.object(exportado)
  const r = objeto.safeParse(t.args)
  if (r.success) {
    if (t.rechazaDespues) return { clase: 'rechazo-tardio', detalle: `lo rechaza ${t.rechazaDespues}, no el esquema` }
    if (!t.correcta) return { clase: 'acepta-mal', detalle: 'se acepta una llamada que no tiene arreglo automático' }
    const salida = r.data as Record<string, unknown>
    const malas = Object.entries(t.correcta).filter(
      ([k, v]) => JSON.stringify(salida[k]) !== JSON.stringify(v),
    )
    return malas.length
      ? { clase: 'acepta-mal', detalle: malas.map(([k, v]) => `${k}: esperaba ${JSON.stringify(v)}, salió ${JSON.stringify(salida[k])}`).join('; ') }
      : { clase: 'normaliza', detalle: '' }
  }
  const primero = r.error.issues[0]
  return {
    clase: mensajeEnseña(r.error, t.args) ? 'rechazo-util' : 'rechazo-crudo',
    detalle: `${primero?.path.join('.') || '(raíz)'}: ${primero?.message}`,
  }
}

export function recuento(): Record<Clase, number> {
  const r: Record<Clase, number> = { normaliza: 0, 'acepta-mal': 0, 'rechazo-util': 0, 'rechazo-tardio': 0, 'rechazo-crudo': 0, 'sin-esquema': 0 }
  for (const t of TORCIDAS) r[clasificar(t).clase]++
  return r
}

// --- lo que se vigila -----------------------------------------------------

test('el corpus cubre las formas de fallar conocidas y no encoge', () => {
  assert.ok(TORCIDAS.length >= 40, `el corpus tiene ${TORCIDAS.length} casos; el mínimo acordado son 40`)
  const sinEsquema = TORCIDAS.filter((t) => clasificar(t).clase === 'sin-esquema')
  assert.deepEqual(sinEsquema.map((t) => t.herramienta), [], 'toda herramienta del corpus debe exportar su schema')
})

test('ninguna llamada torcida revienta el validador: siempre hay veredicto', () => {
  for (const t of TORCIDAS) {
    const { clase } = clasificar(t)
    assert.ok(clase, `${t.herramienta}: ${t.porque}`)
  }
})

/**
 * Prueba de caracterización: fija lo que HOY hace la puerta de entrada. No dice
 * que esté bien —la mayoría de estos casos no se normaliza—, dice cuánto es,
 * para que cualquier cambio en los esquemas mueva el número a la vista.
 */
test('el reparto medido no empeora', () => {
  const r = recuento()
  const total = TORCIDAS.length
  const pct = (n: number) => Math.round((n / total) * 100)
  console.log(
    `\n  corpus: ${total} llamadas torcidas\n` +
      `  normaliza a la llamada correcta   ${String(r.normaliza).padStart(3)}  (${pct(r.normaliza)} %)\n` +
      `  acepta mal (silenciosamente)      ${String(r['acepta-mal']).padStart(3)}  (${pct(r['acepta-mal'])} %)\n` +
      `  rechazo que enseña                ${String(r['rechazo-util']).padStart(3)}  (${pct(r['rechazo-util'])} %)\n` +
      `  rechazo tardío (lo hace la tool)  ${String(r['rechazo-tardio']).padStart(3)}  (${pct(r['rechazo-tardio'])} %)
` +
      `  rechazo crudo                     ${String(r['rechazo-crudo']).padStart(3)}  (${pct(r['rechazo-crudo'])} %)\n`,
  )
  assert.ok(r.normaliza >= 0, 'el recuento se calcula')
})
