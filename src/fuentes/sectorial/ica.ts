/**
 * ICA — Instituto Colombiano Agropecuario.
 *
 * El portal corre sobre Kentico (ASP.NET): hay un `__VIEWSTATE` en cada
 * página, pero el listado en sí NO es un postback de WebForms, es HTML
 * servido con paginación real por querystring (`?page=N`). Cada categoría de
 * normativa vive en una ruta separada y `OpcionesSectorial` no tiene un
 * `tipo` para elegir entre ellas, así que aquí se fija UNA categoría de
 * referencia como listado por defecto: "Resoluciones MSF y RT"
 * (`/normatividad/normas-ica/resoluciones-oficinas-nacionales`), que es donde
 * el ICA publica sus medidas sanitarias y fitosanitarias propias —requisitos
 * de importación, emergencias sanitarias, levantamientos de suspensión—.
 * Se descartó "Resoluciones de Carácter Administrativo": medida, esa
 * categoría son sobre todo declaratorias de días hábiles y trámites internos,
 * no regulación sectorial.
 *
 * Lo que costó averiguar:
 * - `/normatividad/decreto-unico` (la ruta que se esperaba) no existe; la
 *   real es `/normatividad/decreto-unico-reglamentario`, y ni siquiera es un
 *   listado: es una página fija con dos enlaces (el Decreto 1071 de 2015 y su
 *   compilación actualizada). No sirve como fuente de búsqueda.
 * - Con una página fuera de rango (`?page=999`) el portal NO da error ni
 *   vacío: devuelve en silencio el contenido de la página 1, y el marcador de
 *   "página activa" del paginador sigue diciendo "1". Por eso se compara la
 *   página pedida con la que el paginador marca como activa antes de
 *   confiar en el resultado.
 * - El buscador propio del portal (`/normatividad/resultados-normas`) sí
 *   cruza TODAS las categorías (leyes, decretos, resoluciones, conceptos
 *   jurídicos…) pero medido, SIEMPRE devuelve como máximo 5 resultados y ese
 *   tope no se mueve con `&page=`: no pagina. Sirve para localizar un acto
 *   puntual, no para explorar a fondo un tema con muchos resultados.
 */
import { CanarioError, cargar } from '../../parse.ts'
import { pedir } from '../../http.ts'
import type { Adaptador, ActoSectorial, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const BASE = 'https://www.ica.gov.co'
const RUTA_DEFECTO = '/normatividad/normas-ica/resoluciones-oficinas-nacionales'

const limpio = (s: string): string => s.replace(/\s+/g, ' ').trim()

/**
 * Cada fila es un `.row.py-3` con `.tiponorma` (el tipo), un `<h2><a>` cuyo
 * texto es "Tipo NÚMERO de AÑO - "epígrafe"" y, en el propio texto de la
 * fila, "Publicación: … | Expedición: …". Se usa Expedición como fecha del
 * acto: Publicación es solo cuándo se subió al portal.
 */
function filas($: ReturnType<typeof cargar>): ActoSectorial[] {
  const items: ActoSectorial[] = []
  $('.row.py-3').each((_, el) => {
    const $row = $(el)
    const $a = $row.find('h2 a').first()
    if (!$a.length) return

    const tipo = limpio($row.find('.tiponorma').first().text()) || 'Norma'
    const tituloCompleto = limpio($a.text())
    const m = tituloCompleto.match(/(\d[\d.]*)\s+de\s+(\d{4})/i)
    const numero = m?.[1] ?? ''
    const anio = m?.[2] ?? ''

    const guion = tituloCompleto.indexOf(' - ')
    // El portal marca las citas con comillas rectas o tipográficas según la
    // entrada; se quitan las dos formas de los extremos.
    const epigrafe = (guion >= 0 ? tituloCompleto.slice(guion + 3) : tituloCompleto)
      .replace(/^["“]+|["”]+$/g, '')
      .trim()

    // Cortar en "|" no basta: cuando la fila no trae ese separador, "Expedición"
    // se comía la observación de vigencia y el Diario Oficial enteros, y la
    // fecha salía siendo un párrafo. Se captura la fecha por su forma.
    const fecha =
      limpio($row.text()).match(
        /Expedici[óo]n:\s*(\d{1,2}\s+de\s+\w+\s+de\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i,
      )?.[1] ?? ''
    const href = $a.attr('href') ?? ''

    items.push({
      tipo,
      numero,
      anio,
      fecha,
      epigrafe: epigrafe || tituloCompleto,
      url: href ? new URL(href, BASE).toString() : '',
    })
  })
  return items
}

async function paginaDefecto(pagina: number): Promise<{ items: ActoSectorial[]; url: string; nota?: string | undefined }> {
  const url = pagina > 1 ? `${BASE}${RUTA_DEFECTO}?page=${pagina}` : `${BASE}${RUTA_DEFECTO}`
  const r = await pedir(url, 40_000)
  if (r.status !== 200) throw new Error(`El portal del ICA respondió ${r.status} en ${url}.`)

  const $ = cargar(r.cuerpo)
  if (!r.cuerpo.includes('tiponorma')) {
    throw new CanarioError('la página de resoluciones MSF/RT del ICA ya no trae su listado de normas')
  }
  const items = filas($)
  if (!items.length) throw new CanarioError('la página del ICA no trajo ninguna fila reconocible pese a tener contenido')

  // El portal ignora en silencio una página fuera de rango: hay que leer el
  // marcador de página activa del paginador, no confiar en el `pagina` pedido.
  const activa = limpio($('.page-item.active a').first().text())
  const nota =
    activa && activa !== String(pagina)
      ? `Se pidió la página ${pagina}, pero el ICA devolvió la página ${activa} (fuera de rango; el portal no avisa, solo cae a la 1).`
      : undefined

  return { items, url, nota }
}

export default {
  id: 'ica',
  nombre: 'Instituto Colombiano Agropecuario (ICA)',
  sector: 'agropecuario, sanidad animal y vegetal',
  portal: BASE,
  advertencia:
    'Solo PDF, sin texto articulado. No publica un campo de vigencia, aunque algunas resoluciones traen una nota ' +
    'de "Observación" en texto libre que a veces dice qué derogan; no se puede confiar en que esté siempre. ' +
    'El listado por defecto es SOLO "Resoluciones MSF y RT" (medidas sanitarias y fitosanitarias, requisitos de ' +
    'importación, emergencias sanitarias): el ICA también publica acuerdos, conceptos jurídicos, resoluciones de ' +
    'carácter administrativo, resoluciones seccionales, resoluciones OVM, un decreto único reglamentario y normas ' +
    'nacionales (leyes/decretos que expide el Congreso o el Gobierno, no el ICA), y ninguna de esas categorías ' +
    'entra en el listado por defecto. Con "texto" se usa el buscador del propio portal, que sí cruza todas las ' +
    'categorías pero SIEMPRE limita a un puñado de resultados (medido: 5) y no pagina.',
  async buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial> {
    const texto = opts.texto?.trim()
    const anio = opts.anio?.trim()
    const limite = Math.max(1, Math.trunc(opts.limite ?? 20))

    if (texto) {
      const url = `${BASE}/normatividad/resultados-normas?searchmode=AnyWord&searchtext=${encodeURIComponent(texto)}`
      const r = await pedir(url, 40_000)
      if (r.status !== 200) throw new Error(`El portal del ICA respondió ${r.status} en ${url}.`)
      // La cabecera "Resultados de la(s) palabra(s):" aparece incluso sin
      // coincidencias: es lo que distingue "0 resultados reales" de "la
      // página cambió de estructura y no se pudo leer nada".
      if (!/Resultados de la/i.test(r.cuerpo)) {
        throw new CanarioError('la página de resultados de búsqueda del ICA cambió de estructura')
      }
      let items = filas(cargar(r.cuerpo))
      if (anio) items = items.filter((a) => a.anio === anio)
      items = items.slice(0, limite)

      return {
        items,
        total: items.length,
        nota:
          'Buscador propio del ICA: cruza todas las categorías de normatividad (leyes, decretos, resoluciones, ' +
          'conceptos jurídicos…) pero medido, SIEMPRE limita a 5 resultados sin importar el término, y no pagina ' +
          '("pagina" no tiene efecto aquí). Sirve para localizar un acto puntual, no para agotar un tema.',
        url,
      }
    }

    const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
    const { items: crudos, url, nota: notaPagina } = await paginaDefecto(pagina)
    let items = crudos
    if (anio) items = items.filter((a) => a.anio === anio)
    items = items.slice(0, limite)

    const notas = [
      'Listado por defecto: solo "Resoluciones MSF y RT" (los actos sanitarios/fitosanitarios propios del ICA), ' +
        'una de ~10 categorías del portal. Usa "texto" para llegar a las demás vía el buscador del portal.',
      notaPagina,
    ]
      .filter(Boolean)
      .join(' ')

    return { items, total: undefined, nota: notas, url }
  },
} satisfies Adaptador
