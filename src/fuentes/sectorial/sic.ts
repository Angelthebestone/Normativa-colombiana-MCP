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
 * El repositorio es un View de Drupal (`/repositorio-de-normatividad`) con
 * filtros por GET: `field_tipo_de_norma_value`, `body_value` (palabra
 * clave), `field_numero_value`, `field_fecha_de_publicacion_value[value][year]`,
 * `order`/`sort` y `page` (paginación de 10, base 0). El descubrimiento que
 * cuesta caro: la URL SIN NINGÚN parámetro devuelve "No hay normas que
 * cumplan con su búsqueda" — el View exige un filtro explícito, y pasar
 * `field_tipo_de_norma_value=All` a propósito sí funciona y trae de todo.
 *
 * Con "All" salen también tipos que no son normativa vigente: Nombramientos
 * (personal), Proyectos de resolución/circulares (aún no rigen) y Tablas de
 * Retención Documental (gestión documental, no regulación). Se filtran aquí
 * porque el portal no separa "vigente" de "en trámite" en ningún campo, solo
 * en el rótulo de tipo.
 */
import { CanarioError, cargar } from '../../parse.ts'
import { pedir } from '../../http.ts'
import type { Adaptador, ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.sic.gov.co/repositorio-de-normatividad'
const TAMANO_PAGINA = 10

/** Tipos que el `<select>` del portal ofrece pero que no son normativa vigente. */
const TIPOS_EXCLUIDOS = new Set([
  'nombramientos',
  'proyectos de resolucion',
  'proyectos de resolución',
  'proyectos de circulares',
  'tablas de retencion documental',
  'tablas de retención documental',
])

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()
const sinTildesLocal = (s: string): string => s.normalize('NFD').replace(/\p{Diacritic}/gu, '')

function extraer(html: string): ActoSectorial[] {
  const $ = cargar(html)

  // Sin resultados legítimos el portal dice esto en `.view-empty`; si ni eso
  // ni la tabla aparecen, la página cambió de estructura.
  const sinResultados = /No hay normas que cumplan con su b[uú]squeda/i.test(html)
  const filas = $('table.views-table tbody tr')
  if (!sinResultados && !filas.length) {
    throw new CanarioError('no aparece ni la tabla de resultados ni el aviso de "no hay normas"')
  }

  const items: ActoSectorial[] = []
  filas.each((_, tr) => {
    const $tr = $(tr)
    const tipo = limpio($tr.find('td.views-field-field-tipo-de-norma span').first().text())
    if (TIPOS_EXCLUIDOS.has(sinTildesLocal(tipo).toLowerCase())) return

    const numero = limpio($tr.find('td.views-field-field-numero span').first().text())
    const $fecha = $tr.find('span.date-display-single').first()
    // El atributo `content` trae la fecha en ISO; el texto visible ("Sep 29,
    // 2023") es solo para quien lee, no para ordenar ni extraer el año.
    const fechaIso = $fecha.attr('content') ?? ''
    const fecha = fechaIso ? fechaIso.slice(0, 10) : limpio($fecha.text())
    const anio = fecha.match(/^(\d{4})/)?.[1] ?? ''

    // `td.tamano-celda` aparece dos veces por fila (la descripción real, que
    // trae un <p>, y una columna sin cabecera que repite el tema en texto
    // plano): se pide el <p> a propósito para no quedarse con la duplicada.
    const epigrafe = limpio($tr.find('td.tamano-celda p').first().text())
    const url = $tr.find('td.views-field-field-archivo a[href]').first().attr('href') ?? ''

    if (!numero && !epigrafe) return
    items.push({ tipo, numero, anio, fecha, epigrafe, url })
  })

  return items
}

/**
 * Sin palabra clave, "Todos los tipos" es casi inservible: ordenado por
 * fecha, las diez primeras filas son casi siempre Nombramientos (posesiones
 * de personal), en una proporción todavía peor que el "Administrativo" de la
 * ANH. Medido: de 50 filas recientes con `field_tipo_de_norma_value=All`,
 * 41 eran Nombramientos y solo 4 Resoluciones. Por eso, sin texto, se
 * restringe a Resoluciones (tipo 3) desde la propia consulta; con texto, la
 * búsqueda sí abre a "Todos" porque una palabra clave ya filtra el ruido de
 * personal por sí sola (medido con "marca": 9 de 9 resultados eran normativa).
 */
const TIPO_RESOLUCIONES = '3'

async function buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
  const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
  const conTexto = !!opts.texto?.trim()

  const p = new URLSearchParams()
  p.set('field_tipo_de_norma_value', conTexto ? 'All' : TIPO_RESOLUCIONES)
  if (conTexto) p.set('body_value', opts.texto!.trim())
  if (opts.anio) p.set('field_fecha_de_publicacion_value[value][year]', opts.anio)
  p.set('order', 'field_fecha_de_publicacion')
  p.set('sort', 'desc')
  p.set('page', String(pagina - 1))

  const url = `${BASE}?${p}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`El repositorio de normatividad de la SIC respondió ${r.status}.`)

  let items = extraer(r.cuerpo)
  if (opts.limite && opts.limite > 0) items = items.slice(0, opts.limite)

  return {
    items,
    // El portal no declara un total (solo enlaces de página en el paginador),
    // así que no se inventa uno: se advierte en la nota en vez de fingir precisión.
    total: undefined,
    nota:
      `Página de ${TAMANO_PAGINA} resultados; el portal no declara un total exacto, solo enlaces de paginación. ` +
      (conTexto
        ? 'La búsqueda por texto abarca todos los tipos de norma del repositorio, pero se excluyeron nombramientos, ' +
          'proyectos de resolución/circular (aún no rigen) y tablas de retención documental.'
        : 'Sin texto de búsqueda solo se listan Resoluciones (el tipo con más volumen y el que se expide con más ' +
          'frecuencia): "Todos los tipos" sin palabra clave lo domina el nombramiento de personal, no la normativa.'),
    url,
  }
}

export default {
  id: 'sic',
  nombre: 'Superintendencia de Industria y Comercio',
  sector: 'protección al consumidor, competencia, propiedad industrial y protección de datos personales',
  portal: BASE,
  advertencia:
    'Cubre el repositorio de normatividad de la SIC (leyes, decretos, resoluciones, circulares y doctrina que el ' +
    'propio portal indexa allí), pero NO la Circular Única completa como texto navegable —solo sus títulos y ' +
    'anexos sueltos, si el portal los indexa como filas—, ni conceptos/doctrina fuera de ese repositorio, ni el ' +
    'estado de trámites de protección al consumidor o de investigaciones de competencia. Los documentos son PDF ' +
    'o XLSX: no hay texto para buscar dentro del articulado, solo la descripción que publica el portal. La fecha ' +
    'es la de publicación en el repositorio, no necesariamente la de expedición del acto.',
  buscar,
} satisfies Adaptador
