/**
 * `buscar_diario_oficial`: qué se publicó en el Diario Oficial y cuándo, por
 * número de diario, por rango de fechas o por la norma que contiene.
 *
 * Cubre el hueco que deja el Gestor Normativo: entre la publicación y su
 * catalogación pasan días, y «¿ya salió?» se responde aquí. Lo que NO cubre va
 * declarado en cada respuesta: el listado no dice qué normas trae cada diario,
 * y el PDF del diario no tiene enlace estable.
 *
 * Reutiliza `buscar` de `fuentes/diario_oficial.ts`, que es quien habla con el
 * portal (sesión JSF por llamada, canario por forma). Aquí solo va el esquema,
 * las validaciones que evitan consultar en vano y el texto de la respuesta.
 */
import { z } from 'zod'

import { BASE, MAXIMO, TIPOS, buscar, fechaPortal, type Resultado } from '../fuentes/diario_oficial.ts'

export const TITULO = 'Buscar en el Diario Oficial (Imprenta Nacional)'

export const DESCRIPCION =
  'Diarios Oficiales publicados: número, tipo de edición (Ordinaria, Extraordinaria, Especial, Oficio o ' +
  'Tributario) y fecha de publicación. Sirve para saber qué salió publicado y cuándo, incluso el mismo día, ' +
  'antes de que el Gestor Normativo lo catalogue. Filtra por número de diario, por rango de fechas y por el tipo ' +
  'y el número de una norma (encuentra el diario que la publicó: tipo="LEY" y numero_norma="2466" devuelve el ' +
  '53.160). NO dice qué normas contiene cada diario ni trae su texto, y el PDF del diario no tiene enlace estable.'

const esquema = z.object({
  numero: z.string().optional().describe('Número del diario, ej. "53.640"; identifica uno solo'),
  desde: z.string().optional().describe('Fecha de publicación inicial, "2026-09-01" o "01/09/2026"'),
  hasta: z.string().optional().describe('Fecha de publicación final, "2026-09-30" o "30/09/2026"'),
  tipo: z
    .enum(Object.keys(TIPOS) as [string, ...string[]])
    .optional()
    .describe('Tipo de norma: los diarios que la contienen; solo filtra junto con numero_norma'),
  numero_norma: z.string().optional().describe('Número de la norma, sin el año (ej. "2466"); exige tipo'),
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAXIMO)
    .default(20)
    .describe(`Cuántos diarios mostrar (hasta ${MAXIMO}); el portal los sirve de 10 en 10`),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

/**
 * Fecha de hoy en el formato del portal, para la nota de lo que puede faltar.
 * No se importa el `hoy()` de `index.ts`: ese módulo importa este, y la vuelta
 * sería circular.
 */
const hoy = (): string => {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** Los filtros, en prosa, para que la respuesta diga con qué se buscó. */
function conQue(p: Params, desde: string | null, hasta: string | null): string {
  const partes: string[] = []
  if (p.numero) partes.push(`número de diario ${p.numero.trim()}`)
  if (desde) partes.push(`publicados desde el ${desde}`)
  if (hasta) partes.push(`hasta el ${hasta}`)
  if (p.tipo) partes.push(`que contienen una norma de tipo ${p.tipo}${p.numero_norma ? ` número ${p.numero_norma.trim()}` : ''}`)
  return partes.length ? partes.join(', ') : 'sin filtros (los últimos 100 diarios publicados)'
}

/**
 * El texto de la respuesta. Exportada para poder probarla sin red con las filas
 * ya parseadas, como `formatearHistorial` en `historial_norma`.
 */
export function formatear(r: Resultado, p: Params, fechas: { desde: string | null; hasta: string | null }): string {
  const filtros = conQue(p, fechas.desde, fechas.hasta)
  const cabecera =
    'Alcance: consulté la consulta pública de diarios publicados de la Imprenta Nacional (Diario Oficial). ' +
    'Ninguna otra fuente de este servidor se consultó.\n\n' +
    `Búsqueda: ${filtros}.`

  if (!r.total) {
    return (
      `${cabecera}\n\n` +
      `La consulta pública no lista ningún diario con esos filtros. Eso NO significa que la norma no se haya ` +
      `publicado: los filtros del portal son exactos y el listado solo cubre lo que la Imprenta ya publicó.\n\n` +
      `Qué comprobar: que el número de diario o de norma no traiga el año, que las fechas sean las de ` +
      `publicación (no las de expedición) y que el rango no esté invertido. Un diario aparece el mismo día de su ` +
      `publicación o el siguiente; hoy es ${hoy()}.\n\n` +
      cierre()
    )
  }

  const mostrados = r.items.length
  const listado = r.items
    .map((d, i) => `${i + 1}. Diario ${d.numero} — ${d.tipoEdicion} — ${d.fecha}`)
    .join('\n')

  return (
    `${cabecera}\n\n` +
    `${r.total} diario(s) con esos filtros; se muestran ${mostrados}` +
    `${mostrados < r.total ? ` (los ${mostrados} más recientes: el portal los sirve de 10 en 10)` : ''}:\n\n` +
    `${listado}\n\n` +
    (mostrados < r.total
      ? `Faltan ${r.total - mostrados}. Sube "limite" (hasta ${MAXIMO}) o afina los filtros.\n\n`
      : '') +
    `Son los diarios como los publica la Imprenta; se citan por su número y su fecha («Diario Oficial No. ` +
    `${r.items[0]!.numero} del ${r.items[0]!.fecha}»). Para ver uno, ábrelo por su número en ${BASE}.\n\n` +
    cierre()
  )
}

/**
 * Lo que esta consulta NO puede hacer creer. Va en todas las respuestas, con
 * resultados o sin ellos: es la mitad útil del dato.
 */
function cierre(): string {
  return (
    `Qué NO dice esto: el listado no dice QUÉ normas contiene cada diario ni trae su texto. Para saber si una ` +
    `norma concreta salió, búscala por tipo y número («tipo="LEY", numero_norma="2466"»): eso devuelve el diario ` +
    `que la publicó, no su articulado. El texto se lee en el Gestor Normativo (obtener_documento), que puede ` +
    `tardar días en catalogarla.\n` +
    `El PDF de cada diario —el botón «Ver Diario»— no tiene enlace estable: la URL la firma la sesión del portal ` +
    `y sin su cookie responde 404 (medido), así que no se entrega como citable; y pesa entre 2,8 y 15 MB.\n` +
    `Y un vacío aquí NO prueba que la norma no exista: prueba que este listado no la muestra.`
  )
}

/** El aviso de una llamada que no llegó a salir, sin inventar una consulta. */
const noConsultado = (texto: string): string =>
  `Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).\n\n${texto}`

export async function escribir(p: Params): Promise<string> {
  // El número de norma sin tipo no filtra: el portal lo ignora y devuelve la
  // consulta sin filtro (medido: 2466 sin tipo → los mismos 100 diarios que una
  // búsqueda vacía). Se dice en vez de devolver una lista que no responde.
  if (p.numero_norma && !p.tipo) {
    return noConsultado(
      `Falta "tipo": el portal ignora "numero_norma" si no va acompañado del tipo de norma, así que la consulta ` +
        `devolvería los últimos 100 diarios y no lo que pides. Repite con los dos, por ejemplo ` +
        `tipo="LEY" y numero_norma="${p.numero_norma.trim()}".`,
    )
  }
  if (p.tipo && !p.numero_norma) {
    return noConsultado(
      `"tipo" solo no filtra: el portal devuelve TODOS los diarios que contienen alguna norma de ese tipo ` +
        `(medido: LEY son 2.167 diarios). Añade "numero_norma" para acotar a la norma que buscas, por ejemplo ` +
        `tipo="${p.tipo}" y numero_norma="2466", o quita "tipo" y busca por fechas.`,
    )
  }

  const desde = p.desde ? fechaPortal(p.desde) : null
  const hasta = p.hasta ? fechaPortal(p.hasta) : null
  for (const [campo, valor, crudo] of [
    ['desde', desde, p.desde],
    ['hasta', hasta, p.hasta],
  ] as const) {
    if (crudo && !valor) {
      return noConsultado(
        `No entendí la fecha de "${campo}": «${crudo}». Escríbela como "2026-09-27" o "27/09/2026" ` +
          `(día/mes/año, la del calendario del portal).`,
      )
    }
  }
  if (desde && hasta && anioMesDia(desde) > anioMesDia(hasta)) {
    return noConsultado(
      `El rango está invertido: "desde" (${desde}) es posterior a "hasta" (${hasta}), y con eso el portal no ` +
        `devuelve nada. Cámbialos de orden.`,
    )
  }

  const r = await buscar(
    {
      ...(p.numero?.trim() ? { numero: p.numero.trim() } : {}),
      ...(desde ? { desde } : {}),
      ...(hasta ? { hasta } : {}),
      ...(p.tipo ? { tipo: p.tipo as keyof typeof TIPOS } : {}),
      ...(p.numero_norma?.trim() ? { numeroNorma: p.numero_norma.trim() } : {}),
      limite: p.limite,
    },
  )
  return formatear(r, p, { desde, hasta })
}

/** dd/MM/yyyy comparable como número, solo para saber si el rango está invertido. */
const anioMesDia = (f: string): number => Number(`${f.slice(6)}${f.slice(3, 5)}${f.slice(0, 2)}`)
