/** `buscar_jurisprudencia_consejo_estado`: providencias de SAMAI, con su radicado. */
import { z } from 'zod'

import { alcance } from '../nucleo/alcance.ts'
import { sinTildes } from '../nucleo/parse.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as consejo from '../fuentes/jurisprudencia/consejoestado.ts'



/** Radicados ya devueltos de la última búsqueda en el Consejo de Estado, con la página en que salieron. */
const memoriaCE: { clave: string; paginas: Map<string, number> } = { clave: '', paginas: new Map() }

export const TITULO = 'Buscar jurisprudencia del Consejo de Estado'

export const DESCRIPCION =
  'Providencias tituladas del Consejo de Estado, el supremo de lo contencioso administrativo (nulidad y ' +
  'restablecimiento, contratación estatal, nulidad electoral, reparación directa, conceptos de la Sala de ' +
  'Consulta): tribunal DISTINTO de la Corte Constitucional y de la Suprema. Cada resultado trae el problema ' +
  'jurídico y su respuesta, más el enlace a la ficha en SAMAI. ' +
  'CÓMO BUSCA: con exacto=true (activado) busca la FRASE EXACTA y, si no aparece, se amplía solo a OR ' +
  'avisándolo; en modo OR el número de páginas mide el corpus, no la pertinencia. Avanza con pagina.'

const esquema = z.object({
  texto: z.string().describe('Términos a buscar, ej. "nulidad electoral", "liquidación del contrato"'),
  exacto: z
    .boolean()
    .default(true)
    .describe(
      'Frase exacta en SAMAI (activado); si no aparece, se amplía solo a OR con aviso. Ponlo en false para ' +
        'ampliar a propósito.'
    ),
  pagina: z.coerce
    .number()
    .int()
    .min(1)
    .default(1)
    .describe(
      'Página de resultados, desde 1. SAMAI pagina en bloques de ~10 y no admite un desplazamiento libre, ' +
        'por eso aquí se pide la página y no el "desde" del resto de herramientas.'
    ),
  limite: z.coerce.number().int().min(1).max(10).default(5).describe('Cuántas mostrar de la página (hasta 10)'),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export async function escribir({ texto, pagina, limite, exacto }: Params): Promise<string> {
  const r = await consejo.buscar(texto, limite, pagina, exacto)

  // SAMAI pagina por titulación, no por caso: el radicado 25000233600020190090701
  // sale en la página 1 y otra vez en la 2 con otras tesis, y quien suma páginas
  // cuenta el mismo precedente dos veces. Desde una sola página no hay forma de
  // saberlo, así que se recuerda lo ya devuelto de ESTA búsqueda. Solo la última,
  // que es como se pagina: cambiar de término vacía la memoria en vez de
  // acumularla toda la sesión.
  const clave = sinTildes(texto).toLowerCase().trim()
  if (memoriaCE.clave !== clave) {
    memoriaCE.clave = clave
    memoriaCE.paginas.clear()
  }
  const repetidos = new Map<string, number>()
  for (const p of r.items) {
    const antes = memoriaCE.paginas.get(p.radicado)
    if (antes !== undefined && antes !== r.pagina) repetidos.set(p.radicado, antes)
    else if (antes === undefined) memoriaCE.paginas.set(p.radicado, r.pagina)
  }

  if (!r.items.length) {
    return vacio(
      `providencias del Consejo de Estado sobre "${texto}" en la página ${r.pagina}`,
      r.paginas > 0
        ? `La búsqueda tiene ${r.paginas} página(s): pide una entre 1 y ${r.paginas}.`
        : 'Prueba con un término más general.'
    )
  }
  return (
    `${alcance([{ clave: 'consejo', detalle: `${r.items.length} providencia(s)` }])}\n\n` +
      `Página ${r.pagina} de ${r.paginas} en el Consejo de Estado; se muestran ${r.items.length} providencia(s).\n` +
      `El buscador une los términos con OR, así que ese número de páginas NO mide pertinencia: mide cuántas ` +
      `providencias contienen alguna de las palabras.\n\n` +
      r.items
        .map((p) => {
          const yaSalio = repetidos.get(p.radicado)
          const cabecera = [
            `- ${p.radicado}${p.clase ? ` (${p.clase})` : ''}` +
              (yaSalio ? ` — REPETIDA: ya salió en la página ${yaSalio} con otras tesis; no la cuentes dos veces` : ''),
            p.fecha ? `  Fecha: ${p.fecha}` : '',
            p.sala ? `  Sala: ${p.sala}` : '',
            p.ponente ? `  Ponente: ${p.ponente}` : '',
            p.actor || p.demandado ? `  ${p.actor} contra ${p.demandado || '(sin demandado)'}` : '',
            `  Ficha del proceso: ${p.url}`,
            // La ficha pide una verificación anti-robot; este enlace, que emite
            // el propio buscador, abre la providencia sin pedir nada. Se dan los
            // dos porque el primero es el citable y el segundo el que se lee.
            p.token ? `  Leerla: ${consejo.enlaceProvidencia(p.token)}` : '',
            p.token ? `  Texto completo: obtener_documento con fuente="consejo" y token="${p.token}"` : '',
          ].filter(Boolean)
          const tesis = p.titulaciones.map(
            (t) =>
              `  · Problema jurídico: ${t.problema.slice(0, 400)}` +
              (t.respuesta ? `\n    Respuesta: ${t.respuesta}` : '') +
              (t.nota ? `\n    Nota de relatoría: ${t.nota.slice(0, 300)}` : '')
          )
          return [...cabecera, ...tesis].join('\n')
        })
        .join('\n\n') +
      (r.pagina < r.paginas ? `\n\nHay más: repite con pagina=${r.pagina + 1}.` : '') +
      (repetidos.size
        ? `\n\n${repetidos.size} de estas ${r.items.length} ya se devolvieron en páginas anteriores de esta misma ` +
          `búsqueda (${[...repetidos.keys()].join(', ')}): van marcadas arriba. SAMAI pagina por problema ` +
          `jurídico y no por caso, así que ${r.items.length - repetidos.size} son nuevas.`
        : `\n\nUNA PROVIDENCIA PUEDE REPETIRSE ENTRE PÁGINAS: SAMAI pagina por problema jurídico, no por caso, ` +
          `así que un radicado con varias tesis puede reaparecer en la página siguiente. Aquí se marcan las que ` +
          `ya salieron mientras se pagine la MISMA búsqueda; en esta página no hay ninguna.`) +
      `\n\nLOS TOKENS CADUCAN EN UNA HORA: sirven para leer, no para citar. Para citar usa el radicado, que es ` +
      `lo que se pega en ${consejo.BUSCADOR}: ` +
      r.items.map((p) => p.radicado).join(' · ')
  )
}
