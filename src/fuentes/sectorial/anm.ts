/**
 * ANM — Agencia Nacional de Minería.
 *
 * Drupal, y sin el selector de tipo único que tiene la ANH: cada tipo de acto
 * vive en su propia vista/ruta, con su propio formulario de filtros. El portal
 * enlaza cuatro rutas desde /normativa (leyes, decretos, resoluciones,
 * circulares); de esas cuatro solo resoluciones y circulares son actos que la
 * ANM misma expide — leyes y decretos son del Congreso y la Presidencia, que el
 * portal simplemente recopila para consulta. Por eso este adaptador cubre solo
 * esas dos, consultadas en paralelo (misma vista de Drupal, distinto contenido).
 *
 * Trampas medidas pidiendo de verdad al portal:
 *
 * - **La "Fecha de publicación" de las resoluciones NO es la fecha del acto.**
 *   Filtrar por `field_ano_value=2013` devuelve, entre otras, la "Resolución
 *   0484 DE 2012" con fecha de publicación 2013-10-30: ese campo —y su
 *   filtro— son de cuándo se publicó en el portal, no del año que lleva el
 *   número del acto. Tipo, número y año se leen aquí del título, no de esa
 *   columna; la columna se entrega tal cual en `fecha`.
 * - **El filtro de año de circulares no filtra por año.** El campo se llama
 *   `field_vigencia_texto_value` y su placeholder dice "Digite año de
 *   expedición", pero es el mismo campo de texto libre de vigencia ("Vigente",
 *   "Derogada"…). Pedir `2015` no da error: da CERO filas, aunque sí haya
 *   circulares de 2015. Por eso `anio` no se envía a circulares.
 * - **La columna "Archivo" pierde su clase CSS.** Las demás celdas conservan
 *   `views-field-*`, pero la plantilla propia de la ANM
 *   (`views-view-table.html.twig`) deja el enlace al PDF en un `<td
 *   class="mb-4 mb-md-0">` sin marca distintiva. Se toma el último `<td>` de
 *   la fila, que es donde el archivo vive siempre en las dos vistas.
 * - **Una vista sin resultados no deja tabla ni aviso de "sin resultados".**
 *   Con un filtro que no encuentra nada desaparece el `<table>` entero y no
 *   queda ningún texto que lo diga (confirmado pidiendo circulares de un año
 *   que no trae ninguna). El canario es el contenedor `div.view-id-…`: si ese
 *   `div` no está, la página cambió de estructura; si está pero no hay tabla,
 *   son cero resultados de verdad.
 */
import { CanarioError, cargar, limpiarTermino } from '../../parse.ts'
import { pedir } from '../../http.ts'
import type { Adaptador, ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.anm.gov.co'

type Fuente = {
  tipo: string
  ruta: string
  /** Clase del `div` que envuelve la vista entera; sirve de canario de estructura. */
  vista: string
  campoTexto: string
  /** `undefined` en circulares: ese formulario no tiene un filtro de año que funcione. */
  campoAnio?: string
}

const FUENTES: Fuente[] = [
  {
    tipo: 'Resolución',
    ruta: '/resoluciones',
    vista: 'view-id-tabla_pagina_resoluciones',
    campoTexto: 'field_descripcion_value',
    campoAnio: 'field_ano_value',
  },
  {
    tipo: 'Circular',
    ruta: '/circulares',
    vista: 'view-id-tabla_circulares',
    campoTexto: 'field_descripcion_documento_value',
  },
]

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

async function paginaDe(f: Fuente, opts: OpcionesSectorial): Promise<{ items: ActoSectorial[]; url: string }> {
  const p = new URLSearchParams()
  const texto = opts.texto ? limpiarTermino(opts.texto) : ''
  if (texto) p.set(f.campoTexto, texto)
  if (opts.anio && f.campoAnio) p.set(f.campoAnio, opts.anio)
  const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
  p.set('page', String(pagina - 1)) // el paginador de Drupal empieza en 0.

  const url = `${BASE}${f.ruta}?${p}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`El portal de la ANM respondió ${r.status} en ${f.ruta}.`)

  const $ = cargar(r.cuerpo)
  if (!$(`.${f.vista}`).length) {
    throw new CanarioError(`${f.ruta} de la ANM ya no trae la vista esperada (falta .${f.vista})`)
  }

  const items: ActoSectorial[] = []
  $('table.views-view-table tbody tr').each((_, tr) => {
    const $tr = $(tr)
    const titulo = limpio($tr.find('.views-field-title').text())
    if (!titulo) return // fila de cabecera u otra cosa que no es un acto

    // El nombre exacto de la clase difiere entre vistas: "field-descripcion" en
    // resoluciones/leyes/decretos, "field-descripcion-documento" en circulares.
    const descripcion = limpio($tr.find('[class*="views-field-field-descripcion"]').first().text())
    const vigencia = limpio($tr.find('.views-field-field-vigencia-texto').text())
    // Ausente en circulares: esa vista no trae columna de fecha de publicación.
    const fecha = limpio($tr.find('.views-field-nothing').text())
    const href = $tr.find('td').last().find('a[href]').first().attr('href') ?? ''

    const numero = titulo.match(/(\d[\d.\-/]*)/)?.[1] ?? ''
    const anios = titulo.match(/\b(?:19|20)\d{2}\b/g)
    const anio = anios?.at(-1) ?? ''

    items.push({
      tipo: f.tipo,
      numero,
      anio,
      fecha,
      epigrafe: (descripcion || titulo) + (vigencia ? ` [Vigencia según el portal: ${vigencia}]` : ''),
      url: href ? new URL(href, BASE).toString() : url,
    })
  })

  return { items, url }
}

export default {
  id: 'anm',
  nombre: 'Agencia Nacional de Minería',
  sector: 'minería',
  portal: 'https://www.anm.gov.co',
  dominioPermitido: 'https://www.anm.gov.co',
  tiposDocumento: ['Resolución', 'Circular'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Solo cubre resoluciones y circulares propias de la ANM, que son las que la entidad expide. ' +
    'No incluye leyes ni decretos (el portal los enlaza, pero son del Congreso y la Presidencia), ' +
    'ni su normograma propio, ni el texto de los actos: son PDF, no texto extraíble. El filtro de ' +
    'año en resoluciones usa la fecha de publicación en el portal, no el año que lleva el número ' +
    'del acto (una "Resolución 0484 de 2012" puede figurar publicada en 2013). El filtro de año no ' +
    'se aplica a circulares porque el campo del formulario del portal no filtra por año pese a decir ' +
    'que lo hace. El "[Vigencia según el portal: …]" que llevan algunos epígrafes es el texto que la ANM ' +
    'escribió en esa fila, NO una verificación de esta extensión ni una consulta a SUIN: no lo cites como ' +
    'estado de vigencia comprobado.',
  async buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
    const resultados = await Promise.all(FUENTES.map((f) => paginaDe(f, opts)))
    const items = resultados.flatMap((r) => r.items)
    const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)

    const notas: string[] = []
    if (opts.anio) {
      notas.push(
        'El año se aplicó solo a resoluciones y sobre la fecha de publicación en el portal, no sobre ' +
          'el que lleva el número del acto; en circulares no se pudo filtrar por año y se listan sin filtrar.',
      )
    }

    return {
      items: items.slice(0, limite),
      url: resultados.map((r) => r.url).join(' | '),
      nota: notas.join(' ') || undefined,
    }
  },
} satisfies Adaptador
