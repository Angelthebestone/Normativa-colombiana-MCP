import { buscar, type ResultadoSuin } from './buscador.ts'
import { buscarEnIndice } from './indice.ts'

/**
 * Búsqueda por texto que primero prueba el índice de leyes empaquetado y, si
 * rinde 0, cae al buscador vivo de Azure (que sí normaliza y deriva: encuentra
 * la Ley 1221 de 2008 para "teletrabajo"). El hueco del índice se declara en la
 * respuesta; si el fallback tampoco encuentra nada, la norma puede existir
 * igual: ese vacío no es palabra final.
 */
export async function buscarEnSuin(
  deps: { buscar?: typeof buscar },
  opts: {
    texto: string
    vigencia?: string | undefined
    sector?: string | undefined
    desde?: number | undefined
    limite?: number | undefined
  },
): Promise<{ total: number; items: ResultadoSuin[]; nota?: string | undefined; aplicados: string[] }> {
  const aplicados: string[] = []
  const notas: string[] = []

  const delIndice = buscarEnIndice(opts.texto, opts.limite ?? 15)
  if (delIndice.items.length) {
    aplicados.push('índice de leyes empaquetado')
    return { total: delIndice.total, items: delIndice.items, aplicados }
  }

  // El índice solo cubre un subconjunto (leyes del sitemap de leyes). Antes de
  // concluir "no existe", se consulta el buscador del portal: es OTRO índice y
  // normaliza tildes y derivación.
  const vivo = await (deps.buscar ?? buscar)({
    texto: opts.texto,
    ...(opts.vigencia ? { vigencia: opts.vigencia } : {}),
    ...(opts.sector ? { sector: opts.sector } : {}),
    ...(opts.desde ? { desde: opts.desde } : {}),
    ...(opts.limite ? { limite: opts.limite } : {}),
  })
  aplicados.push('buscador del portal (Azure)')
  if (vivo.items.length) {
    notas.push(
      'El índice empaquetado no cubría el término; se consultó el buscador del portal, que normaliza tildes y derivación.',
    )
  } else {
    notas.push(
      'El índice empaquetado no cubría el término y el buscador del portal tampoco lo encontró. ' +
        'Eso NO significa que la norma no exista: el índice tiene huecos y el buscador solo indexa título, epígrafe ' +
        'y materia. Prueba con buscar_por_tema (Gestor Normativo) o resuelve la cita con resolver_cita.',
    )
  }
  return { total: vivo.total, items: vivo.items, nota: notas.join(' ') || undefined, aplicados }
}
