/** `describir_fuentes`: qué cubre este servidor y, sobre todo, qué NO cubre. */
import { z } from 'zod'

import { activa } from '../nucleo/alcance.ts'
import { ALIAS_FUENTES, ALIAS_INVERSO, CLAVES_FUENTES } from '../nucleo/claves_fuentes.ts'
import { CODIGOS, referencia as refCodigo } from '../nucleo/codigos.ts'
import { VERSION } from '../nucleo/http.ts'
import { cargarIndice, frescura } from '../nucleo/indice.ts'
import { sinTildes } from '../nucleo/parse.ts'
import { advertenciaSnapshot } from '../nucleo/snapshot.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as sectorial from '../fuentes/sectorial.ts'
import * as suin from '../fuentes/suin.ts'



export const TITULO = 'Qué cubre este MCP, y qué no'

export const DESCRIPCION =
  'Declara el alcance real: qué fuente responde cada pregunta, qué NO está cubierto y con qué fecha se ' +
  'generaron los índices que viajan empaquetados. Úsala ANTES de concluir que algo "no existe" a partir de ' +
  'una búsqueda vacía, y para saber si el índice de vigencia sigue fresco. No consulta la red. ' +
  'Con el parámetro `fuente` devuelve SOLO el alcance de esa fuente, que es lo que suele hacer falta; sin él, ' +
  'el cuadro completo, que es largo.'

const esquema = z.object({
  fuente: z
    .enum(CLAVES_FUENTES)
    .optional()
    .describe('Clave de una sola fuente ("creg", "suin", "sic"…). Sin ella se devuelven todas.'),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export async function escribir({ fuente }: Params): Promise<string> {
  const idx = cargarIndice()
  const suinIdx = suin.coberturaIndice()
  const normasIndexadas = idx?.filas.reduce((n, f) => n + f.n.length, 0) ?? 0

  const fuentes = ([
    ['gestor', `- Gestor Normativo (Función Pública) — normas del sector público: leyes, decretos, resoluciones, circulares y ` +
      `conceptos. Es el corpus principal. NO publica estado de vigencia, y su buscador por palabras solo indexa los ` +
      `resúmenes temáticos, no el articulado: para buscar dentro de una norma, obtener_documento con fuente="gestor" y buscar_en_texto.`],
    ['corte-constitucional', `- Corte Constitucional — relatoría al día, sentencias y autos con texto completo.`],
    ['corte-suprema', `- Corte Suprema de Justicia — cuatro salas (Tutelas, Civil, Laboral, Penal) desde 1991. Entrega la referencia, ` +
      `las normas citadas y el TEXTO COMPLETO con obtener_documento con fuente="suprema", que necesita la ruta y la misma sala ` +
      `de la búsqueda.`],
    ['consejo-de-estado', `- Consejo de Estado (SAMAI) — providencias tituladas de lo contencioso administrativo, con el problema jurídico, ` +
      `su respuesta y el TEXTO COMPLETO con obtener_documento con fuente="consejo". El texto sale del PDF que publica ` +
      `el buscador; su token caduca en una hora, así que para citar se usa el radicado, no el enlace.`],
    ['dian', `- DIAN — normograma tributario, aduanero y cambiario. Ninguna otra herramienta cubre esa materia.`],
    ['suin', `- SUIN-Juriscol (MinJusticia) — corpus histórico desde 1844 y, sobre todo, la ÚNICA fuente que publica el ` +
      `estado de vigencia como dato.`],
    ['senado', `- Secretaría del Senado — solo el CÓDIGO CIVIL (Ley 84 de 1873), artículo por artículo, porque el Gestor no lo ` +
      `publica y SUIN no sirve su texto. Solo HTTP sin cifrar: el texto no se puede autenticar en tránsito. Trae los ` +
      `apartes tachados (inexequibles o derogados) marcados con ~~ ~~, y NO reproduce las notas de vigencia y ` +
      `jurisprudencia del portal (son de su editor): remite al enlace.`],
    ['diario', `- Diario Oficial (Imprenta Nacional) — la consulta pública de diarios publicados: en qué diario (número, edición, ` +
      `fecha) salió una norma, dado su tipo y número, o qué diarios salieron en unas fechas. Cubre normas de la misma ` +
      `semana que el Gestor aún no cataloga. NO da el texto (el PDF del diario es de sesión, pesa hasta 15 MB y no es ` +
      `citable), NO sabe qué normas trae cada diario y NO filtra por entidad. Un vacío no prueba que no se haya publicado.`],
    ['creg', `- CREG — resoluciones de energía y gas. La única fuente sectorial cuyo TEXTO se puede leer aquí, y la única ` +
      `que separa las no derogadas de las derogadas en compilaciones distintas.`],
    ['anh', `- ANH — 785 actos de hidrocarburos (contratos, regalías, fiscalización). Solo PDF: epígrafe y enlace.`],
    ['upme', `- UPME — circulares y resoluciones de planeación minero energética. Solo PDF. Su fecha es la de publicación ` +
      `en la web, no la de la norma.`],
    ['anla', `- ANLA (Eureka) — clasificación temática de la normativa ambiental. Aporta el mapa, no los documentos: casi ` +
      `todo lo que lista son leyes y decretos que resolver_cita ya resuelve mejor.`],
    ...sectorial
      .adaptadores()
      .map(
        (a) =>
          [a.id, `- ${a.nombre} (entidad="${a.id}" en buscar_normativa_sectorial) — ${a.sector}. ${a.advertencia}`] as [
            string,
            string,
          ]
      ),
  ] as [string, string][]).map(([k, t]): [string, string] => {
    // Se sigue describiendo lo que el operador apagó: quien pregunta por la
    // CREG tiene que saber que existe y que esta instalación no la consulta.
    const clave = ALIAS_INVERSO[k] ?? (sectorial.ids().includes(k) ? 'sectorial' : k)
    return activa(clave) ? [k, t] : [k, `${t} [DESACTIVADA en esta instalación (FUENTES): no se consulta y sus herramientas no existen aquí.]`]
  })

  // Pedir el alcance de la CREG no debería costar el texto de las otras veinte.
  if (fuente) {
    const crudo = sinTildes(fuente).toLowerCase().trim()
    const q = ALIAS_FUENTES[crudo] ?? crudo
    const una = fuentes.find(([k]) => k === q) ?? fuentes.find(([k, t]) => k.includes(q) || sinTildes(t).toLowerCase().includes(q))
    if (!una) {
      return vacio(
        `una fuente llamada "${fuente}"`,
        `Las claves son: ${fuentes.map(([k]) => k).join(', ')}. Sin el parámetro fuente se devuelven todas.`
      )
    }
    return (
      `normativa-colombia ${VERSION} — alcance de una sola fuente.\n\n${una[1]}\n\n` +
        `Esto es SOLO esa fuente: llama a describir_fuentes sin parámetros para el cuadro completo, con lo que ` +
        `no está cubierto y la fecha de los índices empaquetados. Que una búsqueda salga vacía aquí significa ` +
        `que no se encontró en ESTA fuente, no que la norma no exista.`
    )
  }

  const empaquetado = [
    idx
      ? `- Índice temático: ${idx.filas.length.toLocaleString('es')} pares tema/subtema y ` +
        `${normasIndexadas.toLocaleString('es')} asociaciones norma–subtema. Generado el ${idx.generado}.${frescura(idx.generado)}${advertenciaSnapshot(idx.generado)}`
      : `- Índice temático: NO viaja con esta instalación. buscar_por_tema consultará el portal en vivo y será más lento.`,
    suinIdx
      ? `- Índice de SUIN: ${suinIdx.leyes.toLocaleString('es')} leyes, para resolver una cita escrita como texto sin red. Generado el ${suinIdx.generado}.${advertenciaSnapshot(suinIdx.generado)}`
      : `- Índice de SUIN: NO viaja con esta instalación. buscar_en_suin irá directo al buscador del portal; la ` +
        `vigencia no depende de él.`,
  ]

  return (
    `normativa-colombia ${VERSION} — alcance declarado.\n\n` +
      `FUENTES (pide una sola con fuente="creg", "suin", "sic"…)\n${fuentes.map(([, t]) => t).join('\n')}\n\n` +
      `ÍNDICES EMPAQUETADOS (responden sin red)\n${empaquetado.join('\n')}\n\n` +
      `LO QUE NO ESTÁ CUBIERTO — decirlo importa más que la lista de arriba:\n` +
      `- El ESTADO PROCESAL de un caso: si un proceso sigue abierto, en qué etapa va o cuándo se falla. Aquí solo ` +
      `hay normas y providencias YA PUBLICADAS.\n` +
      `- La vigencia de lo POSTERIOR A 2020: la ficha de SUIN sale de su índice público, que llega hasta 2020. Que ` +
      `una norma de 2021 en adelante no traiga estado NO significa que esté derogada ni vigente: no consta.\n` +
      `- El TEXTO de los documentos de SUIN: su visor lo pide a una dirección privada del Ministerio y se queda en ` +
      `blanco. Se da la ficha y el estado; el articulado, del Gestor o del Diario Oficial.\n` +
      `- Los códigos se citan por su nombre (Comercio, Sustantivo del Trabajo, Procesal del Trabajo, Penal, ` +
      `Procedimiento Penal, General del Proceso, CPACA, Infancia y Adolescencia, Estatuto Tributario) y salen del ` +
      `Gestor. El CÓDIGO CIVIL (${refCodigo(CODIGOS.find((c) => c.senado)!)}) no está allí: se lee artículo por artículo de la ` +
      `Secretaría del Senado, que solo sirve HTTP sin cifrar y cuyas notas de vigencia y jurisprudencia de cada ` +
      `artículo NO se reproducen (están en el enlace). Con esa fuente apagada (FUENTES) o caída, el Civil no se puede leer.\n` +
      `- Las leyes que MODIFICAN un código se leen a través de la ley modificatoria: el artículo devuelve su ` +
      `encabezado y el texto que sustituye; el cuerpo del código modificado, con su propia cita ("art. N del Código ` +
      `Civil", "art. N del Código de Comercio").\n` +
      `- La normativa departamental y municipal, salvo la que el Gestor recoja por su cuenta.\n` +
      `- Los tribunales y juzgados distintos de las tres altas cortes.\n` +
      `- EL RESTO DE LA REGULACIÓN SECTORIAL. Con herramienta propia hay cuatro reguladores —CREG, ANH, UPME y ` +
      `ANLA—; los demás que aparecen en la lista de FUENTES se consultan por el parámetro entidad de ` +
      `buscar_normativa_sectorial (${sectorial.ids().join(', ')}). Fuera de esas dos listas no hay nada: NO están ` +
      `la CRC, la Superservicios, la Supersalud ni las demás comisiones y superintendencias. Que este MCP tenga ` +
      `"algo sectorial" no significa que tenga lo sectorial.\n` +
      `- El RASTREO AUTOMÁTICO DE NOVEDADES: ninguna fuente publica un feed de cambios; cambios_desde solo resume ` +
      `lo que el Gestor anota sobre las normas que se le listan.\n` +
      `- La DETECCIÓN SEMÁNTICA DE CONFLICTOS entre normas: analizar_conflicto reúne evidencia, no concluye.\n` +
      `- Los EXPEDIENTES de investigación (expediente) existen pero vienen DESACTIVADOS por defecto: se activan ` +
      `con EXPEDIENTES=1 (y persisten en disco con EXPEDIENTES_DIR). No es un fallo: es una capacidad que el ` +
      `operador decide encender.\n\n` +
      `CÓMO LEER UN VACÍO: que una búsqueda no devuelva nada significa que no se encontró en ESTAS fuentes, con ` +
      `estos índices y con estos huecos. No significa que la norma no exista. El corpus del Gestor no cubre todo ` +
      `el país, y el índice de SUIN tiene agujeros conocidos.`
  )
}
