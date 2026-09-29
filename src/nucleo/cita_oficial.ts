/**
 * Cita canónica de providencias y normas, precalculada a partir de los campos
 * que cada fuente ya trae. La cita viaja ya compuesta en la respuesta, para que
 * el modelo no la arme y no pueda equivocar el ponente, la fecha ni el radicado.
 *
 * Regla que gobierna todo el módulo: NADA SE INVENTA NI SE DEDUCE. Cada
 * componente sale de un campo de la fuente; el que no conste se OMITE de la
 * cita y se declara en `faltan`. Se devuelve `null` solo cuando no hay ni
 * identificador.
 *
 * Antes de rotular un campo se midió qué es de verdad (2026-09-28, contra las
 * fuentes reales; el detalle numérico va en el informe del encargo):
 *
 * - Corte Constitucional: `prov_magistrados` es el PONENTE, no la Sala. De 240
 *   aciertos de búsqueda, 238 traían un solo nombre y 2 dos (ponencias
 *   conjuntas), y el texto de la providencia declara «Magistrado ponente:» con
 *   ese mismo nombre (C-117/26, T-287/26, C-337/11…). OJO: el endpoint de
 *   `ultimas` NO trae `prov_magistrados` (0 de 50), solo el buscador.
 * - Consejo de Estado: `fecha` (LblFECHAPROC) es la fecha del PROCESO, no la de
 *   la providencia —cinco casos con las dos legibles arrojaron fechas
 *   distintas (p. ej. 2022-10-06 frente a 2026-02-23)—, así que no se usa.
 *   `sala` sí trae la Sección ("Sección Tercera (Subsección C)").
 * - Corte Suprema: `magistrado` es el ponente, pero `fecha` (fechaCreacion) es
 *   la de CARGA del índice, no la del fallo (STL2503-2025: campo 2025-02-27,
 *   providencia 2025-02-12); el año fiable es `anio`. `sala` es la pestaña
 *   consultada, no la sala de casación (que va en `ruta`).
 * - Gestor: la ficha trae "Fecha de Expedición" y "Medio de Publicación"
 *   (Diario Oficial), que sí se usan. La entidad expedidora solo consta en la
 *   prosa del encabezado y su forma cambia demasiado, así que se omite.
 */
import type { Providencia as ProvidenciaCorte } from '../fuentes/jurisprudencia/corte.ts'
import type { Providencia as ProvidenciaConsejo } from '../fuentes/jurisprudencia/consejoestado.ts'
import type { Providencia as ProvidenciaSuprema } from '../fuentes/jurisprudencia/cortesuprema.ts'
import type { Norma } from './parse.ts'

/** Cita lista para pegar, con la lista de componentes que la fuente no dio. */
export type Cita = { cita: string; faltan: string[] }

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const

const RE_ISO = /^(\d{4})-(\d{2})-(\d{2})$/
// "23 de septiembre de 2004", "jueves, 3 de abril de 2009", "16 de julio".
const RE_LARGA = /^(?:[^\s,]+,\s*)?(\d{1,2})\s+de\s+([a-záéíóúñ]+)(?:\s+de\s+(\d{4}))?$/i

/**
 * Fecha en palabras. Acepta la ISO de las providencias ("2011-05-04") y la que
 * ya viene en palabras ("23 de septiembre de 2004", o "jueves, 3 de abril de
 * 2009" de SAMAI, cuyo día de la semana se descarta).
 *
 * `estilo` decide el orden: el de las providencias —"4 de mayo de 2011"— o el
 * que usan las normas en su propio encabezado —"septiembre 23", mes y día, sin
 * año porque el año ya va en "Ley 909 de 2004"—. Devuelve "" si no reconoce la
 * fecha, para que quien llame la trate como ausente en vez de imprimirla cruda.
 */
export function fechaLarga(iso: string, estilo: 'providencia' | 'norma' = 'providencia'): string {
  const t = (iso ?? '').trim()
  let dia = ''
  let mes = ''
  let anio = ''

  const iso3 = t.match(RE_ISO)
  if (iso3) {
    const n = Number(iso3[2])
    if (n < 1 || n > 12) return ''
    anio = iso3[1]!
    mes = MESES[n - 1]!
    dia = String(Number(iso3[3]))
  } else {
    const larga = t.match(RE_LARGA)
    if (!larga) return ''
    const nombre = larga[2]!.toLowerCase()
    if (!(MESES as readonly string[]).includes(nombre)) return ''
    dia = String(Number(larga[1]))
    mes = nombre
    anio = larga[3] ?? ''
  }

  if (estilo === 'norma') return `${mes} ${dia}`
  return anio ? `${dia} de ${mes} de ${anio}` : `${dia} de ${mes}`
}

/** "a, b y c": la enumeración de un abogado, con "y" antes del último. */
const enumerar = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} y ${xs.at(-1)!}`

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])

/**
 * SAMAI publica el ponente en versal ("PABLO ANDRÉS CÓRDOBA ACOSTA"). En un
 * memorial el nombre va como lo escribe una persona, así que se pasa a
 * capitalización de título, con las partículas internas en minúscula. Solo se
 * reescribe lo que venía EN VERSAL: un nombre ya capitalizado ("Jorge Ignacio
 * Pretelt Chaljub") se deja intacto, y nunca se añaden tildes que la fuente no
 * traiga.
 */
function nombreEnTitulo(s: string): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  if (!t || !/[A-ZÁÉÍÓÚÑ]/.test(t) || t !== t.toUpperCase()) return t
  return t
    .toLowerCase()
    .split(' ')
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ')
}

/**
 * El radicado de SAMAI son 23 dígitos y su forma citable lleva guiones en
 * bloques 5-2-2-3-4-5-2. La segmentación no es un invento: el propio documento
 * imprime el radicado con guiones ("11001-03-26-000-2023-00093-00" para
 * 11001032600020230009300, medido el 2026-09-28 en el auto del 31-08-2023). Un
 * radicado que no tenga 23 dígitos se deja como venga: no se adivina.
 */
function radicadoConGuiones(r: string): string {
  const d = (r ?? '').replace(/\s+/g, '')
  if (!/^\d{23}$/.test(d)) return d
  return `${d.slice(0, 5)}-${d.slice(5, 7)}-${d.slice(7, 9)}-${d.slice(9, 12)}-${d.slice(12, 16)}-${d.slice(16, 21)}-${d.slice(21)}`
}

// --- Corte Constitucional -------------------------------------------------

/** Formas reales: "C-337/11", "SU.371/21", "A. 193/22", "T-578A/10", "SU508/20". */
const RE_SENTENCIA_CC = /^\s*(SU|C|T|A)\W*(\d+[A-Za-z]?)\s*[/-]\s*(\d{2,4})\s*$/i

/** 11 → 2011, 24 → 2024. La Corte Constitucional existe desde 1991. */
const anioCompleto = (yy: string): string =>
  yy.length === 4 ? yy : String(Number(yy) >= 50 ? 1900 + Number(yy) : 2000 + Number(yy))

export type DatosCorteConstitucional = Pick<ProvidenciaCorte, 'sentencia' | 'fecha' | 'magistrados'>

/**
 * `Corte Constitucional, Sentencia C-337 de 2011 (M.P. Jorge Ignacio Pretelt
 * Chaljub; 4 de mayo de 2011)`. La palabra Sentencia/Auto sale de la letra del
 * número (C, T, SU → sentencia; A → auto), no del campo `tipo`, que viene con
 * más texto ("Sentencia de unificación", "Constitucionalidad"). Dos ponentes se
 * rotulan "M.PP.". Devuelve `null` solo si no hay número de providencia.
 */
export function citaCorteConstitucional(p: DatosCorteConstitucional): Cita | null {
  const bruto = (p.sentencia ?? '').trim()
  if (!bruto) return null

  const m = bruto.match(RE_SENTENCIA_CC)
  const faltan: string[] = []
  // El año se toma de la fecha del fallo y, solo si no la hay, del sufijo del
  // número ("/11"): la fuente lo escribe así y expandirlo no es deducir nada.
  const anio = (p.fecha ?? '').match(RE_ISO)?.[1] ?? (m ? anioCompleto(m[3]!) : '')
  let identificador = bruto
  if (m) {
    const letra = m[1]!.toUpperCase()
    // En los autos el "A-" es redundante con la palabra "Auto", así que el
    // número va solo; en las sentencias el prefijo (C, T, SU) sí se conserva.
    identificador = letra === 'A' ? `Auto ${m[2]!} de ${anio}` : `Sentencia ${letra}-${m[2]!} de ${anio}`
  }

  const ponentes = (p.magistrados ?? []).map((n) => (n ?? '').trim()).filter(Boolean)
  const ponente = ponentes.length ? `${ponentes.length > 1 ? 'M.PP.' : 'M.P.'} ${enumerar(ponentes)}` : ''
  const fecha = fechaLarga(p.fecha ?? '')

  if (!ponentes.length) faltan.push('ponente')
  if (!fecha) faltan.push('fecha')

  const cuerpo = [ponente, fecha].filter(Boolean).join('; ')
  return { cita: `Corte Constitucional, ${identificador}${cuerpo ? ` (${cuerpo})` : ''}`, faltan }
}

// --- Consejo de Estado ----------------------------------------------------

export type DatosConsejoEstado = Pick<ProvidenciaConsejo, 'radicado' | 'ponente' | 'sala'>

/**
 * `Consejo de Estado, Sala de lo Contencioso Administrativo, Sección Tercera
 * (Subsección C), Rad. 25000-23-36-000-2019-00682-01 (C.P. Adriana Polidura
 * Castillo)`.
 *
 * NO lleva fecha: el campo `fecha` de SAMAI es la del proceso, no la de la
 * providencia, y escribirla como si fuera la del fallo es justo el error que
 * esta cita existe para evitar. Queda declarada en `faltan`.
 *
 * El tipo NO incluye `fecha` a propósito: así no se puede pasar por descuido.
 */
export function citaConsejoEstado(p: DatosConsejoEstado): Cita | null {
  const radicado = radicadoConGuiones(p.radicado ?? '')
  if (!radicado) return null

  const faltan: string[] = []
  const sala = (p.sala ?? '').replace(/\s+/g, ' ').trim()
  if (!sala) faltan.push('sala')
  const ponente = nombreEnTitulo(p.ponente ?? '')
  if (!ponente) faltan.push('ponente')
  faltan.push('fecha del fallo (SAMAI publica la del proceso, no la de la providencia)')

  const corporacion = `Consejo de Estado, Sala de lo Contencioso Administrativo${sala ? `, ${sala}` : ''}`
  return { cita: `${corporacion}, Rad. ${radicado}${ponente ? ` (C.P. ${ponente})` : ''}`, faltan }
}

// --- Corte Suprema de Justicia --------------------------------------------

export type DatosCorteSuprema = Pick<ProvidenciaSuprema, 'titulo' | 'sala' | 'clase' | 'magistrado' | 'anio' | 'ruta'>

const SALAS_CASACION: Record<string, string> = { civil: 'Civil', laboral: 'Laboral', penal: 'Penal' }

/**
 * La sala que de verdad decide. La búsqueda devuelve en `sala` la PESTAÑA
 * consultada —cuatro valores fijos: Tutelas, Civil, Laboral, Penal—, y "Tutelas"
 * no es una sala de casación: una tutela la decide Civil, Laboral o Penal. La
 * sala real va en `ruta` ("…/Index/TUTELAS/LABORAL/2025/…" o "…/Index/CIVIL/
 * 1995/…"), así que se lee de ahí; si no, se usa `sala` cuando ya es de
 * casación. Sin poder determinarla, se omite.
 */
function salaDeCasacion(p: DatosCorteSuprema): string {
  const m = (p.ruta ?? '').match(/Index\/(TUTELAS|CIVIL|LABORAL|PENAL)(?:\/(CIVIL|LABORAL|PENAL))?/i)
  const clave = (m?.[2] ?? m?.[1] ?? p.sala ?? '').toLowerCase()
  const casacion = SALAS_CASACION[clave]
  return casacion ? `Sala de Casación ${casacion}` : ''
}

/**
 * `Corte Suprema de Justicia, Sala de Casación Laboral, Sentencia STL2503-2025
 * (M.P. Marjorie Zúñiga Romero; 2025)`.
 *
 * El identificador es el `titulo` tal cual: su índice mezcla formatos
 * ("STL2503-2025", "AC4729-2024 [2024-01302-00]", "28483(31-10-06)") y
 * reescribirlo sería inventar. La fecha NO se incluye: `fecha` es la de carga
 * del índice, no la del fallo; solo el año (`anio`) es de fiar, y el día y el
 * mes quedan declarados en `faltan`. `clase` solo distingue "SENTENCIA" y
 * "AUTO"; si viene vacío, no se escribe la palabra. Devuelve `null` sin
 * `titulo`.
 */
export function citaCorteSuprema(p: DatosCorteSuprema): Cita | null {
  const titulo = (p.titulo ?? '').trim()
  if (!titulo) return null

  const faltan: string[] = []
  const sala = salaDeCasacion(p)
  if (!sala) faltan.push('sala')

  const clase = (p.clase ?? '').trim().toUpperCase()
  const etiqueta = clase === 'SENTENCIA' ? 'Sentencia' : clase === 'AUTO' ? 'Auto' : ''
  if (!etiqueta) faltan.push('tipo (sentencia o auto)')

  const ponente = (p.magistrado ?? '').replace(/\s+/g, ' ').trim()
  if (!ponente) faltan.push('ponente')

  const anio = Number.isInteger(p.anio) && p.anio > 0 ? String(p.anio) : ''
  if (!anio) faltan.push('año')
  faltan.push('día y mes del fallo (la fuente solo publica el año)')

  const partes = ['Corte Suprema de Justicia', sala, [etiqueta, titulo].filter(Boolean).join(' ')].filter(Boolean)
  const cola = [ponente ? `M.P. ${ponente}` : '', anio].filter(Boolean).join('; ')
  return { cita: `${partes.join(', ')}${cola ? ` (${cola})` : ''}`, faltan }
}

// --- Normas (Gestor Normativo) --------------------------------------------

export type DatosNorma = Pick<Norma, 'titulo' | 'fechas'>

/** "Ley 909 de 2004", "Decreto Ley 2739 de 2012", "Resolución 0785 de 2021 …". */
const RE_TITULO_NORMA = /^\s*([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+)?)\s+(\d[\d.-]*)\s+de\s+(\d{4})/

const capitalizar = (s: string): string =>
  s
    .trim()
    .split(/\s+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')

/**
 * `Ley 909 de 2004 (septiembre 23), Diario Oficial No. 45.680`.
 *
 * Lo identificador ("Ley 909 de 2004") sale del título de la ficha; la fecha de
 * expedición y el número del Diario Oficial, de sus metadatos. La entidad
 * expedidora NO se incluye: solo consta en la prosa del encabezado y su forma
 * cambia demasiado ("EL CONGRESO DE COLOMBIA", "EL CONGRESO DE LA REPÚBLICA",
 * "EL PRESIDENTE DE LA REPÚBLICA DE COLOMBIA", "LA COMISIÓN NACIONAL DEL
 * SERVICIO CIVIL"), y en resoluciones y circulares ni siquiera aparece así, de
 * modo que leerla sin equivocarse no es posible hoy. Se omite y se declara.
 *
 * ponytail: el techo es esa entidad expedidora. El salto, si algún día importa,
 * es que la ficha del Gestor exponga un campo "Entidad" estructurado, no un
 * parser sobre el encabezado. Devuelve `null` sin título.
 */
export function citaNorma(datos: DatosNorma): Cita | null {
  const titulo = (datos.titulo ?? '').replace(/\s+/g, ' ').trim()
  if (!titulo) return null

  const m = titulo.match(RE_TITULO_NORMA)
  const identificador = m ? `${capitalizar(m[1]!)} ${m[2]!} de ${m[3]!}` : titulo
  const faltan = ['entidad expedidora']

  const expedicion = fechaLarga(datos.fechas?.['Fecha de Expedición'] ?? '', 'norma')
  if (!expedicion) faltan.push('fecha de expedición')

  const diario = (datos.fechas?.['Medio de Publicación'] ?? '').match(/Diario Oficial\s+([\d.]+)/i)?.[1] ?? ''
  if (!diario) faltan.push('Diario Oficial')

  const partes = [
    `${identificador}${expedicion ? ` (${expedicion})` : ''}`,
    diario ? `Diario Oficial No. ${diario}` : '',
  ].filter(Boolean)
  return { cita: partes.join(', '), faltan }
}
