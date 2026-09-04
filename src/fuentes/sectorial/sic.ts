/**
 * Superintendencia de Industria y Comercio.
 *
 * TLS: sic.gov.co presenta su hoja (*.sic.gov.co, emitida por "GlobalSign RSA
 * OV SSL CA 2018") sin enviar ese intermedio, y Node responde "unable to
 * verify the first certificate" aunque curl —que trae su propio bundle—
 * conecta sin problema. Se resolvió como ya hacía este MCP para
 * funcionpublica.gov.co y suin-juriscol.gov.co: se añadió el intermedio
 * (`GLOBALSIGN_OV` en ca.ts, bajado de la extensión AIA del propio
 * certificado) a la lista de CA que usa `pedir()`. La verificación del
 * certificado del servidor sigue activa; solo se completó una cadena que el
 * servidor manda incompleta.
 *
 * Desde septiembre de 2026 el repositorio vive en la sede electrónica
 * (`sedeelectronica.sic.gov.co/transparencia/normativa/busqueda-de-normas/entidad`):
 * el dominio viejo (`www.sic.gov.co/repositorio-de-normatividad`) responde 301
 * a la sede y `pedir` no sigue redirecciones, así que se apunta directo a la
 * sede. Es un View de Drupal con filtros por GET: `combine` (palabra clave),
 * `field_clasificacion2_target_id` (tipo de norma: 16 Leyes, 177 Resoluciones,
 * 179 Circulares, 188 Decretos, 184 Nombramientos…), `field_clasificacion5_target_id`
 * (dependencia: 398 Protección al Consumidor, 399 Protección de Datos
 * Personales, 396 Propiedad Industrial, 397 Protección a la Competencia…),
 * `field_tipo_acto_target_id` (6704 Carácter General, 6705 Carácter
 * Particular), `field_fecha_publicacion_value` (texto libre, el portal lo
 * interpreta como año: `2026` filtra por ese año) y `page` (paginación de 20,
 * base 0; el total lo dice "Mostrando la página N de M páginas").
 *
 * Cada fila es una tarjeta `.normas--row` (ya no una tabla): el tipo de norma
 * sale de "Tipo de norma: <strong>…</strong>", el tema del `badge`, el título
 * y el enlace del `h2.field__label a` y la descripción del `<p>`. No hay
 * número ni fecha por fila: el número suele venir dentro del título
 * ("Resolución No. 65014 de 2026") y la fecha dentro de la descripción, así
 * que ambos se extraen del texto cuando aparecen y quedan vacíos si no.
 *
 * Sin `combine`, la vista lista de todo (378 páginas): por eso, sin texto, se
 * restringe a Resoluciones (id 177) desde la propia consulta. Con texto, la
 * búsqueda abre a todos los tipos pero excluye Nombramientos, Proyectos de
 * resolución/circulares y Tablas de Retención Documental, que no son
 * normativa vigente. El portal no separa "vigente" de "en trámite" en ningún
 * campo, solo en el rótulo de tipo.
 */
import { CanarioError, cargar, colapsarEspacios } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { Adaptador, ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://sedeelectronica.sic.gov.co/transparencia/normativa/busqueda-de-normas/entidad'
const TAMANO_PAGINA = 20

/** Tipos que el portal ofrece pero que no son normativa vigente. */
const TIPOS_EXCLUIDOS = new Set([
  'nombramientos',
  'proyectos de resolucion',
  'proyectos de resolución',
  'proyectos de circulares',
  'tablas de retencion documental',
  'tablas de retención documental',
])

/** Ids de `field_clasificacion2_target_id` (tipo de norma) que sí son normativa. */
const TIPO_RESOLUCIONES = '177'
const TIPOS_NORMATIVA = new Set(['16', '17', '177', '178', '179', '180', '181', '188', '451'])

const sinTildesLocal = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
const plano = (s: string): string => sinTildesLocal(s).toLowerCase().trim()

/**
 * Número y año desde el título. Dos formas: número pegado al año
 * ("Resolución No. 65014 de 2026") o número suelto con fecha completa después
 * ("Circular externa No. 002 del 15 de enero de 2026", donde entre el número
 * y el año hay "del 15 de enero de"). Se prueba primero la adyacente y luego
 * el "No." con el último año del título; sin número, el año igual sirve.
 */
function numeroYAnio(titulo: string): { numero: string; anio: string } {
  const adyacente = titulo.match(/(\d[\d.]*)\s*(?:de|del)?\s*((?:19|20)\d{2})/i)
  if (adyacente) return { numero: adyacente[1]!.replace(/\./g, ''), anio: adyacente[2]! }
  const numero = titulo.match(/No\.?\s*(\d[\d.]*)/i)?.[1]?.replace(/\./g, '') ?? ''
  const anio = titulo.match(/((?:19|20)\d{2})(?![\s\S]*((?:19|20)\d{2}))/)?.[1] ?? ''
  return { numero, anio }
}

/** Fecha "15 de enero de 2026" dentro de la descripción → ISO; '' si no hay. */
function fechaDe(descripcion: string): string {
  const MESES: Record<string, string> = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10', noviembre: '11', diciembre: '12',
  }
  const m = descripcion.match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de\s+)?((?:19|20)\d{2})/i)
  if (!m) return ''
  const mes = MESES[plano(m[2]!)]
  if (!mes) return ''
  return `${m[3]}-${mes}-${m[1]!.padStart(2, '0')}`
}

function extraer(html: string): ActoSectorial[] {
  const $ = cargar(html)

  // Sin resultados la vista no pinta tarjetas; si tampoco hay `.view-empty`,
  // la página cambió de estructura.
  const filas = $('.normas--row')
  if (!filas.length && !$('.view-empty').length) {
    throw new CanarioError('no aparecen ni las tarjetas de resultados ni el aviso de vacío de la SIC')
  }

  const items: ActoSectorial[] = []
  filas.each((_, tarjeta) => {
    const $t = $(tarjeta)
    const tipo = colapsarEspacios($t.find('strong').first().text())
    if (TIPOS_EXCLUIDOS.has(plano(tipo))) return

    const $enlace = $t.find('h2.field__label a').first()
    const titulo = colapsarEspacios($enlace.text())
    const href = $enlace.attr('href') ?? ''
    const epigrafe = colapsarEspacios($t.find('p').first().text())
    if (!titulo && !epigrafe) return

    const { numero, anio } = numeroYAnio(titulo)
    const fecha = fechaDe(epigrafe || titulo)
    const url = href ? new URL(href, BASE).toString() : ''
    items.push({ tipo: tipo || 'Norma', numero, anio: anio || fecha.slice(0, 4), fecha, epigrafe: epigrafe || titulo, url })
  })

  return items
}

/**
 * Sin palabra clave, todos los tipos es casi inservible: lo dominan los
 * nombramientos de personal. Por eso, sin texto, se restringe a Resoluciones
 * (id 177) desde la propia consulta; con texto, la búsqueda abre a todos los
 * tipos porque la palabra clave ya filtra el ruido por sí sola.
 */
async function buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
  const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
  const conTexto = !!opts.texto?.trim()

  const p = new URLSearchParams()
  if (conTexto) p.set('combine', opts.texto!.trim())
  else p.set('field_clasificacion2_target_id', TIPO_RESOLUCIONES)
  if (opts.anio) p.set('field_fecha_publicacion_value', opts.anio)
  p.set('page', String(pagina - 1))

  const url = `${BASE}?${p}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`El repositorio de normatividad de la SIC respondió ${r.status}.`)

  let items = extraer(r.cuerpo).filter((d) => !TIPOS_EXCLUIDOS.has(plano(d.tipo)))
  if (opts.limite && opts.limite > 0) items = items.slice(0, opts.limite)
  const paginas = r.cuerpo.match(/Mostrando la p.gina \d+ de (\d+) p.ginas/i)?.[1] ?? '?'

  return {
    items,
    // El portal no declara un total exacto, solo el número de páginas.
    total: undefined,
    nota:
      `Página ${pagina} de ${paginas} (de ${TAMANO_PAGINA} resultados); el portal no declara un total exacto, solo el número de páginas. ` +
      (conTexto
        ? 'La búsqueda por texto abarca todos los tipos de norma del repositorio, pero se excluyeron nombramientos, ' +
          'proyectos de resolución/circular (aún no rigen) y tablas de retención documental.'
        : 'Sin texto de búsqueda solo se listan Resoluciones: sin palabra clave la vista la domina el nombramiento de personal, no la normativa.'),
    url,
  }
}

export default {
  id: 'sic',
  nombre: 'Superintendencia de Industria y Comercio',
  sector: 'protección al consumidor, competencia, propiedad industrial y protección de datos personales',
  portal: BASE,
  dominioPermitido: 'https://sedeelectronica.sic.gov.co',
  tiposDocumento: ['Resolución', 'Circular', 'Ley', 'Decreto'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Cubre el repositorio de normatividad de la SIC (leyes, decretos, resoluciones, circulares y doctrina que el ' +
    'propio portal indexa allí), pero NO la Circular Única completa como texto navegable —solo sus títulos y ' +
    'anexos sueltos, si el portal los indexa como filas—, ni conceptos/doctrina fuera de ese repositorio, ni el ' +
    'estado de trámites de protección al consumidor o de investigaciones de competencia. Los documentos son PDF ' +
    'o XLSX: no hay texto para buscar dentro del articulado, solo la descripción que publica el portal. La fecha ' +
    'se extrae de la descripción cuando la trae ("15 de enero de 2026"); si la fila no la trae, queda vacía.',
  buscar,
} satisfies Adaptador

/** Exportados para las pruebas sin red. */
export const _interno = { extraer, numeroYAnio, fechaDe, TIPOS_NORMATIVA }
