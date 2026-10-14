import { idTipo, parsearCita, candidatosAmbiguos, type Cita } from '../../nucleo/citas/index.ts'
import { clasificarValidacion, parametroEs, validarArticulo, validarNumeroAnio, validarUrl } from '../../nucleo/evidencia.ts'
import { sinTildes } from '../../nucleo/parse/texto.ts'
import * as gestor from '../../fuentes/gestor/index.ts'

export type Comprobacion = { nombre: string; ok: boolean }

/**
 * Los datos de validar UNA cita, antes de darles forma. El texto y el json
 * salen de aquí: partirlos evita reescribir la lógica dos veces. `estado` es el
 * discriminador y el que lleva el json; los casos de error (sin forma, no
 * encontrada, ambigua, fuente caída) traen `detalle` y nunca lanzan.
 */
export type DatosCita =
  | { estado: 'sin-forma'; cita: string; detalle: string }
  | { estado: 'no-encontrada'; cita: string; detalle: string }
  | {
      estado: 'ambigua'
      cita: string
      detalle: string
      candidatos: { titulo: string; id: string; anio: string; url: string }[]
    }
  | { estado: 'fuente-caida'; cita: string; detalle: string }
  | {
      estado: 'validada' | 'parcialmente-validada' | 'no-validada'
      cita: string
      /** El veredicto en las palabras de siempre ("cita validada", …). */
      resultado: string
      comprobaciones: Comprobacion[]
      encontrada?: { titulo: string; url: string }
      nota?: string
    }

export const SIN_FORMA =
  'No fue posible validar: la cita no tiene forma de cita colombiana. Escríbela como "Ley 909 de 2004" o "C-337/11".'

/** El aviso de forma si `cita` no parsea; texto vacío si sí. */
export function sinForma(cita: string): string {
  return parsearCita(cita) ? '' : SIN_FORMA
}

/** Texto puro de un resultado de validación, inyectable para las pruebas. */
export function formatear(
  _cita: string,
  resultado: string,
  comprobaciones: { nombre: string; ok: boolean }[],
  encontrada?: { titulo: string; url: string },
  nota?: string,
): string {
  const lineas = comprobaciones.map((c) => `- ${c.nombre}: ${c.ok ? '✓' : '✗'}`)
  const cuerpo = encontrada
    ? [encontrada.titulo, encontrada.url]
    : ['Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.']
  return [`Resultado: ${resultado}`, ...lineas, ...(nota ? [nota] : []), ...cuerpo].join('\n')
}

/**
 * Busca en el Gestor corrigiendo el tipo escrito, que casi nunca es el oficial:
 * «Decreto 1567 de 1998» no existe, pero «Decreto Ley 1567 de 1998» sí. Se
 * reintenta sin filtrar por tipo, PERO solo se acepta si el tipo oficial
 * contiene al escrito: número y año no identifican una norma —existen a la vez
 * la Ley 1541 de 2012 y el Decreto 1541 de 2012—, y devolver el otro sería peor
 * que no encontrar nada, porque nadie sospecharía del cambio.
 *
 * Nació dentro de `resolverUnaCita` en index.ts y se mudó aquí porque index.ts
 * ya importa este módulo: dejarla allí y llamarla desde aquí sería un ciclo de
 * imports. Compartirla es justo el arreglo: sin ella el lote con validar=true
 * respondía «no fue posible validar» a «Decreto 624 de 1989» mientras la
 * consulta individual devolvía el id 6533.
 */
export async function buscarCorrigiendoTipo(
  c: Cita,
  buscar: typeof gestor.buscar = gestor.buscar,
): Promise<{
  r: Awaited<ReturnType<typeof gestor.buscar>>
  /** Tipo oficial cuando el escrito se quedó corto; vacío si no hubo corrección. */
  tipoOficial: string
  /** Norma homónima de OTRO tipo que sí tiene el Gestor; pista para explicar el vacío. */
  otroTitulo: string
}> {
  const r = await buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  if (r.items.length || !c.anio) return { r, tipoOficial: '', otroTitulo: '' }

  const sinTipo = await buscar({ numero: c.numero, anio: c.anio })
  const real = sinTipo.items[0]?.titulo.match(/^(.+?)\s+\d/)?.[1]?.trim()
  if (!real) return { r, tipoOficial: '', otroTitulo: '' }
  if (new RegExp(`\\b${sinTildes(c.tipo).toLowerCase()}\\b`, 'i').test(sinTildes(real).toLowerCase())) {
    return { r: sinTipo, tipoOficial: real, otroTitulo: '' }
  }
  // No se corta aquí: la norma puede existir en SUIN aunque el Gestor solo
  // tenga la homónima de otro tipo. La pista se guarda para el vacío.
  return { r, tipoOficial: '', otroTitulo: sinTipo.items[0]!.titulo }
}

/**
 * Valida UNA cita y devuelve sus DATOS. Nunca lanza por la forma: una cita que
 * no parsea sale como `sin-forma`. Los errores de red sí pueden lanzar; quien
 * llama en lote los captura para que una cita no tumbe a las demás.
 * `buscar` y `obtenerNorma` son inyectables para probar sin red (patrón del repo).
 */
export async function calcularDatos(
  cita: string,
  url?: string,
  deps: { buscar?: typeof gestor.buscar; obtenerNorma?: typeof gestor.obtenerNorma } = {},
): Promise<DatosCita> {
  const buscar = deps.buscar ?? gestor.buscar
  const obtenerNorma = deps.obtenerNorma ?? gestor.obtenerNorma
  const aviso = sinForma(cita)
  if (aviso) return { estado: 'sin-forma', cita, detalle: aviso }

  const c = parsearCita(cita)!
  const { r, tipoOficial } = await buscarCorrigiendoTipo(c, buscar)
  const item = r.items[0]
  if (!item) {
    return {
      estado: 'no-encontrada',
      cita,
      detalle:
        'No fue posible validar: la cita no se encontró en el Gestor Normativo. Que no aparezca NO significa que la norma no exista; pruébala en SUIN con resolver_cita.',
    }
  }

  // Sin año, el número no identifica la norma: se pide el año en vez de elegir.
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      const candidatos = [...ambiguos].sort((a, b) => Number(b.anio) - Number(a.anio))
      return {
        estado: 'ambigua',
        cita,
        candidatos,
        detalle:
          `No fue posible validar: la cita "${cita}" es ambigua. El Gestor tiene ${ambiguos.length} normas con ese ` +
          `tipo y número, de años distintos; no se elige una por ti:\n` +
          candidatos.map((x) => `- ${x.titulo} (id ${x.id})\n  ${x.url}`).join('\n') +
          `\n\nRepite con el año ("${c.tipo} ${c.numero} de ${candidatos[0]!.anio}").`,
      }
    }
  }

  const comprobaciones: Comprobacion[] = [
    { nombre: 'número y año', ok: validarNumeroAnio(item.titulo, c.numero, c.anio) },
    // El dominio a comprobar es SIEMPRE el enlace que el usuario dio (si lo dio):
    // validar el del item cuando el usuario pasó uno ajeno sería un falso positivo.
    { nombre: 'dominio del enlace', ok: validarUrl(url ?? item.url, 'funcionpublica.gov.co') },
    // Si el usuario dio un enlace, además debe apuntar al MISMO id de la norma.
    ...(url ? [{ nombre: 'el enlace corresponde a esta norma', ok: parametroEs(url, 'i', item.id) }] : []),
  ]
  if (c.articulo) {
    const norma = await obtenerNorma(item.id)
    comprobaciones.push({ nombre: 'artículo', ok: validarArticulo(norma.texto, c.articulo) })
  }
  // La corrección de tipo se anuncia: la cita se validó contra otra forma de
  // escribirla, y quien la use en un escrito debe escribir la oficial.
  const nota = tipoOficial ? `No existe un «${c.tipo} ${c.numero} de ${c.anio}»; el tipo oficial es «${tipoOficial}».` : ''
  const resultado = clasificarValidacion(comprobaciones)
  const estado =
    resultado === 'cita validada' ? 'validada' : resultado === 'cita parcialmente validada' ? 'parcialmente-validada' : 'no-validada'
  return {
    estado,
    cita,
    resultado,
    comprobaciones,
    encontrada: { titulo: item.titulo, url: item.url },
    ...(nota ? { nota } : {}),
  }
}

/** El texto de siempre para unos datos. Cada rama reproduce su salida previa. */
export function textoDeDatos(d: DatosCita): string {
  switch (d.estado) {
    case 'sin-forma':
    case 'no-encontrada':
    case 'ambigua':
    case 'fuente-caida':
      return d.detalle
    default:
      return formatear(d.cita, d.resultado, d.comprobaciones, d.encontrada, d.nota)
  }
}
