/**
 * Mintransporte — Ministerio de Transporte de Colombia.
 *
 * Dos fuentes del mismo portal, según el año pedido (medido el 2026-10-14):
 *
 * 1. **Tabla de actos** de «Normatividad» (`/normatividad/actos/`, `#tableActos`), para
 *    `anio` ≥ 2025 o sin `anio`. 255 filas en una sola página: 2025 (1) y 2026 (254).
 *    Fecha ISO, tipo «Resolucion» o «Circular» y PDF directo.
 * 2. **Catálogo antiguo** (`/documentos/…`), para `anio` 2016–2024. Cada año es una
 *    página (`/documentos/<id>/<año>/`) con `paginateDocs=100` (100 por página) y
 *    `genPagDocs=N`. Medido: resoluciones 2020 (115), 2021 (153), 2022 (363), 2023 (349),
 *    2024 (6); Direcciones Territoriales 2023 (306) y 2024 (110); «Decretos 2024» (222,
 *    en su mayoría resoluciones). Decretos 2016 (1), 2017 (3), 2018 (3), 2019 (2),
 *    2020 (27), 2021 (0), 2022 (4), 2023 (3), 2024 (1). Raíz de decretos
 *    (`/documentos/13/decretos/`) con 80 decretos de 2008–2022, sin página por año.
 *    La fecha de expedición coincide con el año de la página en casi todos los casos
 *    (2020: 115/115; 2021: 153/153; 2022: 353/363).
 *
 * Lo que costó averiguar:
 *
 * - El catálogo mezcla actos con avisos, notificaciones, certificados, tablas y anexos.
 *   Esos se omiten por el nombre del archivo y su número aparece en la `nota`.
 * - «Tipo de documento» es «Tipo no definido» en casi todo el catálogo: el tipo sale del
 *   nombre del archivo y, si no lo dice, de la sección.
 * - El número sale del epígrafe («Resolución 123 de…») o, si no, del radicado del nombre
 *   del archivo (p. ej. `R.20233040051625-…`), igual que la tabla de actos.
 *
 * Fuentes descartadas:
 *
 * - **Buscador del catálogo** (`/documentos/buscar/`): el texto pasa por
 *   `loader.php?lServicio=Search` y exige validar reCAPTCHA v2 (`validarProcess`). El
 *   endpoint DataTables `buscarAdmin` responde 404 a GET y redirige a inicio a POST.
 *   Por eso `texto` sin `anio` solo busca en la tabla de actos.
 * - **Enlace de descarga** del catálogo (`loader.php?…Tools2…descargar&idHash=…`): responde
 *   302 a `…lFuncion=validar&reqId=…`, así que `url` apunta a la página del año.
 * - **DSpace** (`web.mintransporte.gov.co/jspui`): fechas de emisión con placeholders
 *   («1900») y rango hasta 2018. Archivo congelado, no el listado vigente.
 * - **Circulares** del catálogo antiguo: no se incluyen.
 */
import { CanarioError, cargar, colapsarEspacios, sinTildes } from '../../nucleo/parse.ts'
import { pedir } from '../../nucleo/http.ts'
import type { ActoSectorial, Adaptador, OpcionesSectorial, ResultadoSectorial } from '../sectorial.ts'

const ORIGEN = 'https://mintransporte.gov.co'
const PAGINA = `${ORIGEN}/normatividad/actos/`
/** Desde este año el listado vigente es la tabla de actos; antes, el catálogo antiguo. */
const ANIO_TABLA = 2025
/** Tope de peticiones al catálogo antiguo por llamada (incluye la primera página de cada sección). */
const TOPE_PAGINAS = 8
const POR_PAGINA = 100
const TIMEOUT = 90_000

/** Secciones del catálogo antiguo, por año (rutas medidas el 2026-10-14). */
const RES_ANIO: Record<number, string> = {
  2020: '/documentos/479/2020/',
  2021: '/documentos/559/2021/',
  2022: '/documentos/671/2022/',
  2023: '/documentos/811/2023/',
  2024: '/documentos/992/2024/',
}
const DT_ANIO: Record<number, string> = {
  2023: '/documentos/839/resoluciones-direcciones-territoriales-2023/',
  2024: '/documentos/912/resoluciones-direcciones-territoriales-2024/',
}
const DEC_ANIO: Record<number, string> = {
  2016: '/documentos/287/2016/',
  2017: '/documentos/302/2017/',
  2018: '/documentos/313/2018/',
  2019: '/documentos/355/2019/',
  2020: '/documentos/481/2020/',
  2021: '/documentos/745/2021/',
  2022: '/documentos/746/2022/',
  2023: '/documentos/902/2023/',
  2024: '/documentos/954/2024/',
}
/** Raíz de decretos: 80 decretos de 2008–2022 sin página por año. */
const RAIZ_DECRETOS = '/documentos/13/decretos/'
/** «Decretos 2024»: contiene sobre todo resoluciones (2024–2025). */
const DECRETOS_2024 = '/documentos/910/decretos-2024/'

/** Avisos, notificaciones, certificados, tablas y anexos mezclados en el catálogo. */
const RUIDO = /notific|certific|aviso|prueba de envio|\btabla\b|anexo|checklist|lista-de|oficio|invitaci|manual|circular|cronograma/i
const DECRETO = /^\W*decreto/i
const NUMERO_EPIGRAFE = /^\W*(?:resoluci[oó]n|decreto)\s*(?:n[uú]mero|n[º°o.]|no\.?|n\.?)?\s*[:.]?\s*(\d[\d.]*)/i
const NUMERO_ARCHIVO = /(?:decreto|resoluci[oó]n|n[uú]mero|n[º°o]|\bno\.?)\s*[:.]?\s*(\d+)/i
const RADICADO_ARCHIVO = /^\W*R\.?\s*(\d{6,})/i
const FECHA_EXPEDICION = /Expedici[oó]n:?\s*(\d{2})\/(\d{2})\/(\d{4})/i
const FECHA_CUALQUIERA = /(\d{2})\/(\d{2})\/(\d{4})/

/** Fecha ISO de la columna «Fecha de expedición» de la tabla; de ella sale el año del acto. */
const FECHA_ISO = /^((?:19|20)\d{2})-\d{2}-\d{2}$/

type FilaActo = { acto: ActoSectorial; tema: string }
type Grupo = 'res' | 'dec'
type Seccion = { nombre: string; ruta: string; grupo: Grupo }
/** Documento del catálogo antiguo ya leído: fecha ISO y tipo decidido. */
type Documento = { archivo: string; tipo: string; numero: string; anio: string; fecha: string; epigrafe: string; ruta: string }

const normaliza = (s: string): string => sinTildes(s).toLowerCase()
const palabrasDe = (texto?: string): string[] => (texto ? normaliza(texto).split(/\s+/).filter(Boolean) : [])

function fechaIso(texto: string): string {
  const m = texto.match(FECHA_EXPEDICION) ?? texto.match(FECHA_CUALQUIERA)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}

function tipoDe(archivo: string, epigrafe: string, grupo: Grupo): string {
  if (DECRETO.test(archivo) || DECRETO.test(epigrafe)) return 'Decreto'
  if (/resol/i.test(archivo)) return 'Resolucion'
  return grupo === 'res' ? 'Resolucion' : 'Decreto'
}

function numeroDe(archivo: string, epigrafe: string): string {
  return (
    epigrafe.match(NUMERO_EPIGRAFE)?.[1] ??
    archivo.match(NUMERO_ARCHIVO)?.[1] ??
    archivo.match(RADICADO_ARCHIVO)?.[1] ??
    archivo.replace(/\.pdf$/i, '')
  )
}

/** Secciones del catálogo antiguo que contienen el año pedido, en orden de lectura. */
function seccionesDe(anio: number, categoria: string): Seccion[] {
  const quiereRes = !categoria || categoria.includes('resol')
  const quiereDec = !categoria || categoria.includes('decre')
  const out: Seccion[] = []
  if (quiereRes && RES_ANIO[anio]) out.push({ nombre: `Resoluciones ${anio}`, ruta: RES_ANIO[anio], grupo: 'res' })
  if (quiereDec && DEC_ANIO[anio]) out.push({ nombre: `Decretos ${anio}`, ruta: DEC_ANIO[anio], grupo: 'dec' })
  if (quiereDec && anio <= 2022) out.push({ nombre: 'Decretos (raíz, 2008–2022)', ruta: RAIZ_DECRETOS, grupo: 'dec' })
  if (quiereRes && DT_ANIO[anio]) out.push({ nombre: `Resoluciones Direcciones Territoriales ${anio}`, ruta: DT_ANIO[anio], grupo: 'res' })
  if (quiereRes && anio === 2024) out.push({ nombre: 'Decretos 2024 (contiene resoluciones)', ruta: DECRETOS_2024, grupo: 'res' })
  return out
}

async function descargar(url: string, pedirFn: typeof pedir): Promise<string> {
  const r = await pedirFn(url, TIMEOUT)
  if (r.status !== 200) throw new Error(`El catálogo de Mintransporte respondió ${r.status} en ${url}.`)
  return r.cuerpo
}

/** Lee una página de año: cada documento es un bloque con `strong.nombre` y campos `strong.title`. */
function leerPagina(html: string, seccion: Seccion): { docs: Documento[]; paginas: number; ruido: number } {
  const $ = cargar(html)
  let paginas = 1
  $('a[href*="genPagDocs="]').each((_, a) => {
    const n = Number(($(a).attr('href') ?? '').match(/genPagDocs=(\d+)/)?.[1] ?? 1)
    if (n > paginas) paginas = n
  })
  const docs: Documento[] = []
  let ruido = 0
  $('strong.nombre').each((_, el) => {
    let bloque = $(el)
    while (bloque.parent().length && bloque.parent().find('strong.nombre').length === 1) bloque = bloque.parent()
    const campo = new Map<string, string>()
    bloque.find('strong.title').each((_, t) => {
      campo.set(colapsarEspacios($(t).text()), colapsarEspacios($(t).parent().next().text()))
    })
    const archivo = colapsarEspacios($(el).text())
    const fecha = fechaIso(campo.get('Fechas') ?? '')
    if (!fecha) return
    if (RUIDO.test(archivo)) {
      ruido++
      return
    }
    const epigrafe = (campo.get('Descripción') ?? '').replace(/^["“”\s]+/, '')
    docs.push({
      archivo,
      tipo: tipoDe(archivo, epigrafe, seccion.grupo),
      numero: numeroDe(archivo, epigrafe),
      anio: fecha.slice(0, 4),
      fecha,
      epigrafe,
      ruta: seccion.ruta,
    })
  })
  return { docs, paginas, ruido }
}

/** Lee las secciones en orden, sin pasar de `TOPE_PAGINAS` peticiones. */
async function leerCatalogo(secciones: Seccion[], pedirFn: typeof pedir): Promise<{ docs: Documento[]; ruido: number; sinLeer: string[] }> {
  const docs: Documento[] = []
  const sinLeer: string[] = []
  let ruido = 0
  let restantes = TOPE_PAGINAS
  for (const s of secciones) {
    if (restantes <= 0) {
      sinLeer.push(s.nombre)
      continue
    }
    const url = (p: number) => `${ORIGEN}${s.ruta}?genPagDocs=${p}&paginateDocs=${POR_PAGINA}`
    restantes--
    const primera = leerPagina(await descargar(url(1), pedirFn), s)
    docs.push(...primera.docs)
    ruido += primera.ruido
    let completa = true
    for (let p = 2; p <= primera.paginas; p++) {
      if (restantes <= 0) {
        completa = false
        break
      }
      restantes--
      const pag = leerPagina(await descargar(url(p), pedirFn), s)
      docs.push(...pag.docs)
      ruido += pag.ruido
    }
    if (!completa) sinLeer.push(s.nombre)
  }
  return { docs, ruido, sinLeer }
}

function paginar(lista: ActoSectorial[], opts: OpcionesSectorial): { items: ActoSectorial[]; aviso?: string | undefined } {
  const tope = Math.min(Math.max(opts.limite ?? 20, 1), 100)
  const pagina = Math.max(opts.pagina ?? 1, 1)
  const desde = (pagina - 1) * tope
  const items = lista.slice(desde, desde + tope)
  const aviso =
    lista.length > desde + tope
      ? `Coinciden ${lista.length}; se muestran ${items.length} (página ${pagina}). Sube limite o pagina para ver más.`
      : undefined
  return { items, aviso }
}

/** Tabla de actos 2025–2026 (anio ≥ 2025 o sin anio). */
async function buscarTabla(opts: OpcionesSectorial, anio: string, pedirFn: typeof pedir): Promise<ResultadoSectorial> {
  const r = await pedirFn(PAGINA, TIMEOUT)
  if (r.status !== 200) throw new Error(`El portal del Ministerio de Transporte respondió ${r.status}.`)

  const $ = cargar(r.cuerpo)
  const filas = $('#tableActos tbody tr')
  // Sin la tabla no hay forma de distinguir «no hay actos» de «la página cambió».
  if (!filas.length) throw new CanarioError('no se encontró la tabla #tableActos de actos administrativos')

  const todas: FilaActo[] = []
  let descartadas = 0
  filas.each((_, tr) => {
    const celdas = $(tr).children('td')
    if (celdas.length < 5) {
      descartadas++
      return
    }
    const href = celdas.eq(0).find('a[href]').attr('href') ?? ''
    const epigrafe = colapsarEspacios(celdas.eq(0).text())
    const tema = colapsarEspacios(celdas.eq(1).text())
    const numero = colapsarEspacios(celdas.eq(2).text())
    const tipo = colapsarEspacios(celdas.eq(3).text())
    const fecha = colapsarEspacios(celdas.eq(4).text())
    const anioFila = fecha.match(FECHA_ISO)?.[1] ?? ''
    if (!href || !numero || !tipo || !anioFila) {
      descartadas++
      return
    }
    todas.push({
      acto: { tipo, numero, anio: anioFila, fecha, epigrafe, url: new URL(href, ORIGEN).toString() },
      tema,
    })
  })
  // Si ninguna fila cumple el formato, la tabla cambió: no es un listado vacío.
  if (!todas.length) throw new CanarioError('ninguna fila de #tableActos tiene la forma esperada (epígrafe, tema, número, tipo, fecha ISO)')

  const palabras = palabrasDe(opts.texto)
  const categoria = opts.categoria ? normaliza(opts.categoria).trim() : ''

  const coinciden = todas.filter(({ acto, tema }) => {
    if (anio && acto.anio !== anio) return false
    if (categoria && !normaliza(acto.tipo).includes(categoria)) return false
    if (palabras.length) {
      const hay = normaliza(`${acto.epigrafe} ${tema} ${acto.numero}`)
      if (!palabras.every((p) => hay.includes(p))) return false
    }
    return true
  })

  const { items, aviso } = paginar(
    coinciden.map((f) => f.acto),
    opts,
  )

  const avisos: string[] = []
  if (aviso) avisos.push(aviso)
  if (!anio) {
    avisos.push('Sin anio solo se consulta la tabla de actos 2025–2026. Para 2016–2024 indica anio: el catálogo antiguo se lee por año.')
  }
  if (descartadas) {
    avisos.push(`${descartadas} fila(s) de la tabla no tienen la forma esperada y se omitieron.`)
  }

  return {
    items,
    total: coinciden.length,
    url: PAGINA,
    ...(avisos.length ? { nota: avisos.join(' ') } : {}),
  }
}

/** Catálogo antiguo (anio 2008–2024). Lee páginas por año con `paginateDocs=100`. */
async function buscarAntiguo(opts: OpcionesSectorial, anio: number, pedirFn: typeof pedir): Promise<ResultadoSectorial> {
  const categoria = opts.categoria ? normaliza(opts.categoria).trim() : ''
  const palabras = palabrasDe(opts.texto)
  const secciones = seccionesDe(anio, categoria)
  const avisos: string[] = []
  if (!secciones.length) {
    avisos.push(`El catálogo antiguo no tiene secciones para ${anio}${opts.categoria ? ` con categoría «${opts.categoria}»` : ''}.`)
  }

  const { docs, ruido, sinLeer } = await leerCatalogo(secciones, pedirFn)

  const vistos = new Set<string>()
  const coinciden = docs
    .filter((d) => {
      if (d.anio !== String(anio)) return false
      const clave = `${d.fecha}|${d.archivo}`
      if (vistos.has(clave)) return false
      vistos.add(clave)
      if (categoria && !normaliza(d.tipo).includes(categoria)) return false
      if (palabras.length) {
        const hay = normaliza(`${d.epigrafe} ${d.numero} ${d.archivo}`)
        if (!palabras.every((p) => hay.includes(p))) return false
      }
      return true
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .map<ActoSectorial>((d) => ({ tipo: d.tipo, numero: d.numero, anio: d.anio, fecha: d.fecha, epigrafe: d.epigrafe, url: `${ORIGEN}${d.ruta}` }))

  const { items, aviso } = paginar(coinciden, opts)
  if (aviso) avisos.push(aviso)
  if (sinLeer.length) {
    avisos.push(
      `Consulta parcial: el tope es ${TOPE_PAGINAS} páginas del catálogo por llamada y no se leyeron completas: ${sinLeer.join('; ')}. Acota con categoria para leer menos secciones.`,
    )
  }
  if (ruido) {
    avisos.push(`${ruido} entrada(s) del catálogo son avisos, notificaciones, certificados, tablas o anexos y se omitieron.`)
  }

  return {
    items,
    total: coinciden.length,
    url: `${ORIGEN}${secciones[0]?.ruta ?? '/documentos/14/resoluciones/'}`,
    ...(avisos.length ? { nota: avisos.join(' ') } : {}),
  }
}

export async function buscar(opts: OpcionesSectorial, deps: { pedir?: typeof pedir } = {}): Promise<ResultadoSectorial> {
  const pedirFn = deps.pedir ?? pedir
  const anio = opts.anio?.trim() ?? ''
  if (anio && !/^\d{4}$/.test(anio)) throw new Error(`anio debe tener cuatro dígitos (AAAA); llegó «${anio}».`)
  if (anio && Number(anio) < ANIO_TABLA) return buscarAntiguo(opts, Number(anio), pedirFn)
  return buscarTabla(opts, anio, pedirFn)
}

export default {
  id: 'mintransporte',
  nombre: 'Ministerio de Transporte',
  sector: 'transporte, tránsito e infraestructura',
  portal: PAGINA,
  dominioPermitido: ORIGEN,
  tiposDocumento: ['Resolucion', 'Decreto', 'Circular'],
  soportaTexto: false,
  soportaVigencia: false,
  pruebasMinimas: 'todo regulador sectorial declara qué NO cubre',
  advertencia:
    'Cubre la tabla de actos del portal (2025–2026, 255 filas, medidas el 2026-10-14) y el catálogo antiguo de ' +
    'resoluciones (2020–2024) y decretos (2016–2024) por año, más decretos de 2008–2022 de la raíz de decretos ' +
    'cuando se pide anio ≤ 2022. NO cubre actos de antes de 2016 (salvo decretos de 2008–2015 de la raíz), ' +
    'circulares del catálogo antiguo, proyectos de acto, conceptos jurídicos ni el archivo histórico de DSpace ' +
    '(web.mintransporte.gov.co/jspui, hasta 2018). 2025 se consulta solo en la tabla. «texto» busca en el epígrafe, ' +
    'el número y el nombre del archivo; sin anio solo busca en la tabla. El número es el del acto cuando aparece en ' +
    'el epígrafe; si no, el radicado del archivo. Los enlaces de la tabla son PDF; los del catálogo antiguo apuntan a la ' +
    'página del año porque su descarga exige validación. Este adaptador no lee el contenido de los documentos.',
  buscar,
} satisfies Adaptador
