/**
 * Superintendencia Financiera de Colombia.
 *
 * La página que se ve al entrar (`publicaciones/19167/...`) es solo un índice
 * temático. Lo que hace falta —Circulares Externas, Cartas Circulares y
 * Resoluciones, que es donde vive la instrucción vigente— está un nivel más
 * adentro, en `publicaciones/20149/`: una tabla con UNA fila por año desde
 * 2005 y tres columnas, cada celda un enlace al listado de ese año y ese tipo.
 * Hay que leer esa tabla primero para saber a qué URL ir, porque los ids no
 * siguen ningún patrón previsible (10115974, 10114895, 80293, 20143…).
 *
 * Lo más costoso de averiguar fue que el sitio encadena redirecciones que
 * `pedir` no sigue solo (no las sigue ninguna fuente de este proyecto, porque
 * ninguna otra las necesitaba): `/10115974` → 301 a `/10115974/` → 302 a
 * `/loader.php?lServicio=Publicaciones&id=...` → termina en la URL canónica
 * `/publicaciones/10115974/circulares-externas-2026/`. Hasta tres saltos, sin
 * cookies de por medio (se probó sin ellas y llega igual). De ahí
 * `pedirSiguiendoRedirecciones`, local a este fichero.
 *
 * La tabla de cada año trae Número, Fecha y Descripción — pero la "Fecha" es
 * solo día y mes ("Mayo 11"): el año no se repite por fila porque ya lo dice
 * el título de la página. Se arma la fecha completa apoyándose en ESE dato
 * verificado, no en una suposición.
 *
 * El marcado cambia entre años: 2024-2026 usa `class="tabla_nuevoGris"` con
 * celdas limpias; 2005-2013 usa `class="tablaPub1"` con `<div align>` dentro
 * de cada `<td>`. Ambas comparten lo único que importa: una tabla por página,
 * con exactamente tres `<td>` útiles por fila y el número como enlace de
 * descarga. Por eso no se filtra por clase.
 */
import { CanarioError, cargar, colapsarEspacios, limpiarTermino, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { Adaptador, ActoSectorial } from '../sectorial.ts'

const BASE = 'https://www.superfinanciera.gov.co'
const INDICE = `${BASE}/publicaciones/20149/`

type TipoActo = 'Circular Externa' | 'Carta Circular' | 'Resolución'

/**
 * El sitio no sigue el estándar de un único salto: encadena hasta tres
 * redirecciones (301 y 302 mezclados) antes de llegar al HTML real. `pedir`
 * no las sigue —ninguna otra fuente las necesitaba— así que se resuelven aquí
 * a mano, leyendo `Location` de las cabeceras que `pedir` ya expone.
 */
async function pedirSiguiendoRedirecciones(url: string, saltos = 6): ReturnType<typeof pedir> {
  let actual = url
  for (let i = 0; i < saltos; i++) {
    const r = await pedir(actual, 40_000)
    if (r.status >= 300 && r.status < 400 && r.cabeceras['location']) {
      actual = new URL(r.cabeceras['location'], actual).toString()
      continue
    }
    return r
  }
  throw new Error(`La Superfinanciera encadenó más de ${saltos} redirecciones al pedir ${url}.`)
}

/** Año → URL del listado de cada uno de los tres tipos, leído de la tabla índice. */
async function indice(): Promise<Map<string, Record<TipoActo, string>>> {
  const r = await pedirSiguiendoRedirecciones(INDICE)
  if (r.status !== 200) throw new Error(`La Superfinanciera respondió ${r.status} al pedir el índice de circulares.`)

  const $ = cargar(r.cuerpo)
  const tabla = $('table').first()
  if (!tabla.length) {
    throw new CanarioError('la página de circulares, cartas circulares y resoluciones ya no trae su tabla de años')
  }

  const mapa = new Map<string, Record<TipoActo, string>>()
  tabla.find('tr').each((_, tr) => {
    const $tr = $(tr)
    if ($tr.find('th').length) return // fila de encabezado
    const enlaces = $tr.find('td a[href]')
    if (enlaces.length < 3) return
    const anio = colapsarEspacios(enlaces.eq(0).text())
    if (!/^\d{4}$/.test(anio)) return
    mapa.set(anio, {
      'Circular Externa': new URL(enlaces.eq(0).attr('href') ?? '', INDICE).toString(),
      'Carta Circular': new URL(enlaces.eq(1).attr('href') ?? '', INDICE).toString(),
      Resolución: new URL(enlaces.eq(2).attr('href') ?? '', INDICE).toString(),
    })
  })
  if (!mapa.size) {
    throw new CanarioError('la tabla de años de circulares de la Superfinanciera no trajo ningún año legible')
  }
  return mapa
}

/** Lee la tabla de un listado anual (Circulares Externas, Cartas Circulares o Resoluciones). */
async function filasDeAnio(url: string, tipo: TipoActo, anio: string): Promise<ActoSectorial[]> {
  const r = await pedirSiguiendoRedirecciones(url)
  if (r.status !== 200) {
    throw new CanarioError(`la página de ${tipo.toLowerCase()}s de ${anio} respondió ${r.status} (la tabla de años apuntaba aquí)`)
  }

  const $ = cargar(r.cuerpo)
  const tabla = $('table').first()
  if (!tabla.length) {
    throw new CanarioError(`la página de ${tipo.toLowerCase()}s de ${anio} ya no trae su tabla de actos`)
  }

  const items: ActoSectorial[] = []
  tabla.find('tr').each((_, tr) => {
    const $tr = $(tr)
    if ($tr.find('th').length) return
    const celdas = $tr.find('td')
    if (celdas.length < 3) return
    const numero = colapsarEspacios(celdas.eq(0).text())
    const fecha = colapsarEspacios(celdas.eq(1).text())
    const epigrafe = colapsarEspacios(celdas.eq(2).text())
    if (!numero && !epigrafe) return
    const href = celdas.eq(0).find('a').first().attr('href') ?? ''
    items.push({
      tipo,
      numero,
      anio,
      // La tabla solo da "Mayo 11": el año lo aporta el título de la propia
      // página, verificado al construir el índice, no adivinado.
      fecha: fecha ? `${fecha} de ${anio}` : anio,
      epigrafe,
      url: href ? new URL(href, url).toString() : url,
    })
  })
  return items
}

export default {
  id: 'superfinanciera',
  nombre: 'Superintendencia Financiera de Colombia',
  sector: 'Sector financiero, asegurador y bursátil',
  portal: INDICE,
  dominioPermitido: 'https://www.superfinanciera.gov.co',
  tiposDocumento: ['Circular Externa', 'Carta Circular', 'Resolución'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Solo cubre Circulares Externas, Cartas Circulares y Resoluciones desde 2005 (antes de eso, nada publicado ' +
    'aquí). No incluye la Circular Básica Jurídica, la Financiera ni la Contable y Financiera: esas son ' +
    'compilaciones vivas que se actualizan por capítulos, no actos individuales con número y fecha propios, y no ' +
    'aparecen en este listado. Los documentos son PDF sin texto extraíble aquí. La "fecha" que da el portal por ' +
    'fila es solo día y mes; el año se toma de la página en la que aparece, no del propio acto. No publica vigencia.',

  async buscar(opts): Promise<{ items: ActoSectorial[]; total?: number; nota?: string; url: string }> {
    const anio = opts.anio?.trim() || String(new Date().getFullYear())
    if (!/^\d{4}$/.test(anio)) throw new Error(`Año inválido: "${anio}". Usa cuatro dígitos, p.ej. "2024".`)

    const mapa = await indice()
    if (!mapa.has(anio)) {
      const anios = [...mapa.keys()].sort()
      throw new Error(
        `La Superfinanciera no publica circulares para ${anio}. Cubre de ${anios[0]} a ${anios[anios.length - 1]}.`,
      )
    }
    const urls = mapa.get(anio)!

    const tipos: TipoActo[] = ['Circular Externa', 'Carta Circular', 'Resolución']
    const porTipo = await Promise.all(tipos.map((t) => filasDeAnio(urls[t], t, anio)))
    const todas = porTipo.flat()
    if (!todas.length) {
      throw new CanarioError(`ninguna de las tres tablas de ${anio} (circulares, cartas circulares, resoluciones) trajo filas legibles`)
    }

    const q = opts.texto ? sinTildes(limpiarTermino(opts.texto)).toLowerCase().trim() : ''
    const filtradas = q
      ? todas.filter((x) => sinTildes(`${x.numero} ${x.epigrafe}`).toLowerCase().includes(q))
      : todas

    const pagina = Math.max(1, Math.trunc(opts.pagina ?? 1))
    const limite = Math.min(Math.max(opts.limite ?? 20, 1), 100)
    const desde = (pagina - 1) * limite

    return {
      items: filtradas.slice(desde, desde + limite),
      total: filtradas.length,
      nota: `También se consultaron las cartas circulares (${urls['Carta Circular']}) y las resoluciones (${urls.Resolución}) de ${anio}; esta URL es solo la de circulares externas.`,
      url: urls['Circular Externa'],
    }
  },
} satisfies Adaptador
