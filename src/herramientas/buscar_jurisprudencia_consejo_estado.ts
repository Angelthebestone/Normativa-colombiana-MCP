/** `buscar_jurisprudencia_consejo_estado`: providencias de SAMAI, con su radicado. */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { estricto } from '../nucleo/normalizar.ts'
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
  'Consulta). Para la Corte Constitucional usa buscar_jurisprudencia; para la Suprema, ' +
  'buscar_jurisprudencia_suprema; con un radicado concreto, resolver_cita. Cada resultado trae el problema ' +
  'jurídico y su respuesta, el enlace a la ficha en SAMAI y el token con el que obtener_documento ' +
  '(fuente="consejo") devuelve el texto. ' +
  'CÓMO BUSCA: con exacto=true (activado) busca la FRASE EXACTA y, si no aparece, se amplía solo a OR ' +
  'avisándolo; en modo OR el número de páginas mide el corpus, no la pertinencia. Avanza con pagina; limite ' +
  'recorta DENTRO de la página y lo que deja fuera no sale en la siguiente.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

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

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

/** `deps.buscar` inyecta la fuente para probar sin red. */
export async function escribir(
  { texto, pagina, limite, exacto }: Params,
  deps: { buscar?: typeof consejo.buscar } = {},
): Promise<string> {
  const r = await (deps.buscar ?? consejo.buscar)(texto, limite, pagina, exacto)

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
  // Sentencia y salvamento, o dos tesis de la misma providencia, llegan como
  // entradas distintas del mismo radicado en la misma página: repetían entera la
  // cabecera del proceso. Se agrupan por radicado en el orden de primera
  // aparición, y cada documento conserva su token y sus tesis.
  const porRadicado = new Map<string, consejo.Providencia[]>()
  for (const p of r.items) {
    const docs = porRadicado.get(p.radicado)
    if (docs) docs.push(p)
    else porRadicado.set(p.radicado, [p])
  }
  const documentos = r.items.length
  const radicados = porRadicado.size
  const conToken = r.items.some((p) => p.token)

  const bloques = [...porRadicado.values()].map((docs) => {
    const p = docs[0]!
    const yaSalio = repetidos.get(p.radicado)
    const cabecera = [
      `- ${p.radicado}${p.clase ? ` (${p.clase})` : ''}` +
        (yaSalio ? ` — REPETIDA: ya salió en la página ${yaSalio} con otras tesis; no la cuentes dos veces` : ''),
      p.fecha ? `  Fecha del proceso: ${p.fecha}` : '',
      p.sala ? `  Sala: ${p.sala}` : '',
      p.ponente ? `  Ponente: ${p.ponente}` : '',
      p.actor || p.demandado ? `  ${p.actor} contra ${p.demandado || '(sin demandado)'}` : '',
      `  Ficha del proceso: ${p.url}`,
    ].filter(Boolean)
    const cuerpo = docs.flatMap((d) => [
      // El token, una vez: cómo leerlo (obtener_documento o el enlace del
      // navegador, que no pide la verificación anti-robot de la ficha) se
      // explica una sola vez en el pie. Repetido por entrada, era la mitad del listado.
      d.token ? `  token: ${d.token}` : '',
      ...d.titulaciones.map(
        (t) =>
          `  · Problema jurídico: ${t.problema.slice(0, 400)}` +
          (t.respuesta ? `\n    Respuesta: ${t.respuesta}` : '') +
          (t.nota ? `\n    Nota de relatoría: ${t.nota.slice(0, 300)}` : '')
      ),
    ])
    return [...cabecera, ...cuerpo].filter(Boolean).join('\n')
  })

  return (
    `${alcance([{ clave: 'consejo', detalle: `${documentos} providencia(s)` }])}\n\n` +
      `Página ${r.pagina} de ${r.paginas}${exacto && !r.ampliada ? ' (con la frase exacta)' : ''} en el Consejo de Estado; ` +
      (documentos === radicados
        ? `se muestran ${documentos} providencia(s).\n`
        : `se muestran ${documentos} documento(s) de ${radicados} radicado(s).\n`) +
      // Lo dice la fuente según el modo: el aviso de OR solo acompaña a una búsqueda hecha en OR.
      `${r.nota ? `${r.nota}\n` : ''}\n` +
      bloques.join('\n\n') +
      (r.pagina < r.paginas ? `\n\nHay más: repite con pagina=${r.pagina + 1}.` : '') +
      // Solo cuando hay repetidas: en una página sin ellas el aviso no informa de nada.
      (repetidos.size
        ? `\n\nUNA PROVIDENCIA PUEDE REPETIRSE ENTRE PÁGINAS: ${repetidos.size} de estos ${radicados} radicado(s) ` +
          `ya se devolvieron en páginas anteriores de esta misma búsqueda y van marcados arriba. SAMAI pagina por ` +
          `problema jurídico y no por caso, así que ${radicados - repetidos.size} son nuevos.`
        : '') +
      (conToken
        ? `\n\nPara leer una: obtener_documento con fuente="consejo" y token=<token de la entrada>; en el ` +
          `navegador, ${consejo.enlaceProvidencia('<token>')}`
        : '') +
      `\n\nLa fecha que se muestra es la del PROCESO, no la de la providencia: esa se lee en su texto. ` +
      `LOS TOKENS CADUCAN EN UNA HORA: sirven para leer, no para citar. Para citar usa el radicado, que es ` +
      `lo que se pega en ${consejo.BUSCADOR}.`
  )
}
