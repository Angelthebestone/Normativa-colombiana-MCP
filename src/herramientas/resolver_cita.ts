/**
 * `resolver_cita`: de una cita escrita como la escribe un abogado al documento
 * oficial. Es la puerta exacta del MCP; el buscador por palabras no lo es.
 */
import { z } from 'zod'

import { activa, alcance, avisoApagada } from '../nucleo/alcance.ts'
import { citaCorteConstitucional } from '../nucleo/cita_oficial.ts'
import { parsearCita, parsearRadicado } from '../nucleo/citas.ts'
import { codigoDe, referencia as refCodigo } from '../nucleo/codigos.ts'
import { esCompiladora } from '../nucleo/compiladas.ts'
import { validarUrl } from '../nucleo/evidencia.ts'
import { advertenciasVigencia, articulo as extraerArticulo } from '../nucleo/parse.ts'
import { estricto, numeroDeArticulo } from '../nucleo/normalizar.ts'
import { vacio } from '../nucleo/vacio.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as suin from '../fuentes/suin.ts'
import { resolverCodigo } from './codigo_senado.ts'
import { resolverRadicado } from './resolver_radicado.ts'
import * as validarCita from './validar_cita.ts'



type OpcionesCita = {
  /** Artículos de la MISMA norma: se resuelve y se descarga una vez, y se extrae cada uno. */
  articulos?: string[] | undefined
  /** Con false se omite el extracto de tema asociado, que es lo más caro de la respuesta. */
  contexto?: boolean | undefined
  /**
   * Ids de norma cuyo extracto ya salió en ESTA respuesta. Un lote de citas de
   * la misma norma repetía el mismo extracto en cada bloque —en el Estatuto
   * Tributario son unas 90 palabras cada vez—; se emite una vez y las demás lo
   * dicen en una línea. Es deduplicación por respuesta, sin estado entre
   * llamadas: una caché haría que la misma llamada devolviera cosas distintas.
   */
  yaConExtracto?: Set<string> | undefined
}

/**
 * Bloque de UN artículo con sus advertencias de vigencia, o el aviso de que no
 * aparece. La ruta de artículo único y la de `articulos` comparten esta función
 * porque el formato tiene que ser idéntico, y porque un artículo que falte se
 * marca en su propio bloque sin abortar los demás.
 *
 * La URL va pegada al ENCABEZADO, no al final: el articulado trae líneas en
 * blanco dentro, así que un `URL:` al pie queda en otro párrafo y el fragmento
 * citable se copia sin su origen. Aquí se lee antes del texto y viaja con él.
 */
/** La línea de cita judicial ya compuesta, con lo que la relatoría no da declarado (nada se inventa). */
function citaOficial(p: Parameters<typeof citaCorteConstitucional>[0]): string {
  const c = citaCorteConstitucional(p)
  return c ? `Cita oficial: ${c.cita}${c.faltan.length ? ` (no consta: ${c.faltan.join(', ')})` : ''}` : ''
}

function bloqueArticulo(texto: string, numero: string, url: string): string {
  const art = extraerArticulo(texto, numero)
  return art
    ? `\n\n--- Artículo ${numero} ---\nURL: ${url}\n${art}\n${advertenciasVigencia(art).join('\n')}`
    : `\n\nNo encontré un "artículo ${numero}" en el texto. Usa obtener_documento con fuente="gestor" y buscar_en_texto.`
}

/**
 * Resuelve UNA cita de `resolver_cita` en texto puro (sin el envoltorio `txt`,
 * que lo pone quien llama). La ruta individual llama con una sola cita; el
 * lote itera sobre esta misma función, así que ambas vías resuelven igual.
 */
async function resolverUnaCita(cita: string, opciones: OpcionesCita = {}): Promise<string> {
  // Un radicado judicial de 23 dígitos no es una cita normativa: se identifica y se enruta a la corte.
  const radicado = parsearRadicado(cita)
  if (radicado) return resolverRadicado(cita, radicado)
  const c = parsearCita(cita)
  if (!c) return `### ${cita}\nNo encontré una cita normativa en "${cita}". Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11", o usa buscar_normas.`

  /**
   * `articulos` manda sobre el artículo escrito en la cita, y se anuncia:
   * callarlo sería contestar a otra pregunta con el mismo aire de certeza.
   */
  const pedidos = opciones.articulos?.length ? opciones.articulos : c.articulo ? [c.articulo] : []
  const articuloIgnorado =
    opciones.articulos?.length && c.articulo
      ? `Se ignoró el "artículo ${c.articulo}" de la cita: manda el parámetro articulos (${opciones.articulos.join(', ')}).\n`
      : ''

  /**
   * Nadie cita "Decreto 410 de 1971": cita el Código de Comercio. Cuando la
   * cita llegó por el nombre del código se dice contra qué norma se resolvió,
   * porque es la que hay que escribir en un escrito judicial.
   */
  const cod = codigoDe(c.tipo, c.numero, c.anio)
  const equivalencia =
    c.codigo && cod
      ? `\n«${cod.nombre}» se cita aquí como ${refCodigo(cod)}, que es su norma contenedora y lo que hay que escribir en un escrito.`
      : ''
  // El Código Civil no está en el Gestor: su texto sale de la Secretaría del Senado.
  if (cod?.senado) return resolverCodigo({ cita, c, codigo: cod, pedidos, articuloIgnorado })

  // Las sentencias de la Corte se resuelven contra su relatoría, que está al día.
  // Con la Corte apagada no se cae al Gestor —que no publica sentencias— para
  // salir por un «no encontré» que se leería como «no existe».
  if (c.sentencia && !activa('corte')) {
    return `### ${cita}\n${alcance([])}\n\n${avisoApagada('corte')} Por eso no se puede ni afirmar ni negar que exista la sentencia ${c.sentencia}.`
  }
  if (c.sentencia) {
    const v = await corte.verificar(c.sentencia)
    if (v.estado === 'existe' && v.providencia) {
      const p = v.providencia
      return [
        `### ${cita}`,
        alcance([{ clave: 'corte', detalle: 'providencia verificada por su número' }]),
        `${p.sentencia} (${p.tipo}) — Corte Constitucional`,
        `Fecha: ${p.fecha} · Publicación: ${p.publicacion} · Expediente: ${p.expediente}`,
        // El campo de la relatoría es el PONENTE, no la Sala (medido: 238 de 240 aciertos traen un solo nombre).
        p.magistrados.length ? `Ponente${p.magistrados.length > 1 ? 's' : ''} (según la relatoría): ${p.magistrados.join(', ')}` : '',
        citaOficial(p),
        p.tema ? `Tema: ${p.tema}` : '',
        p.sintesis ? `Síntesis: ${p.sintesis}` : '',
        `Texto completo: usa obtener_documento con fuente="corte" y ruta="${p.ruta}"`,
        `URL: ${p.url}`,
      ]
        .filter(Boolean)
        .join('\n')
    }
    /**
     * Negativa firme. Antes, una sentencia que la relatoría no tiene caía a la
     * rama del Gestor —que no publica sentencias— y salía por el "No encontré la
     * cita", que obliga a quien pregunta a decidir entre "no existe" y "no supe
     * buscarla". Con el número sondeado en las dos formas que la relatoría indexa
     * (medido el 2026-09-16: las C y las T casan con guion, las SU solo sin él),
     * la ausencia ya es un dato.
     */
    if (v.estado === 'no-existe') {
      return (
        `### ${cita}\n` +
        `${alcance([{ clave: 'corte', detalle: `sondeada con ${v.sondeos.map((s) => `«${s}»`).join(' y ')}` }])}\n\n` +
        `No existe ninguna providencia con el número ${c.sentencia} en la relatoría de la Corte Constitucional.\n\n` +
        `Se buscó por el NÚMERO, no por el contenido, así que esto no dice nada sobre si hay una sentencia ` +
        `parecida: para eso, buscar_jurisprudencia por materia.`
      )
    }
    if (v.estado === 'no-medido') {
      return (
        `### ${cita}\n` +
        `No pude comprobar la sentencia ${c.sentencia} contra la relatoría de la Corte Constitucional: ` +
        `${v.motivo ?? 'la fuente no respondió'}.\n\n` +
        `Esto NO significa que no exista —significa que no se pudo comprobar—. Vuelve a intentarlo, o búscala ` +
        `por materia con buscar_jurisprudencia.`
      )
    }
  }

  // La corrección del tipo escrito vive en validar_cita.ts para que el lote con
  // validar=true la aplique también: allí no se hacía, y devolvía "no fue
  // posible validar" para citas que esta ruta resolvía sin problema.
  const { r, tipoOficial, otroTitulo } = await validarCita.buscarCorrigiendoTipo(c)
  const tipoCorregido = tipoOficial
    ? `\nNo existe un «${c.tipo} ${c.numero} de ${c.anio}»; el tipo oficial es «${tipoOficial}».\n`
    : ''
  const otroTipo = otroTitulo
    ? ` Con ese número y año el Gestor sí tiene «${otroTitulo}», que es de otro tipo: si te referías` +
      ` a esa, pídela con su tipo exacto.`
    : ''

  if (!r.items.length) {
    // Que el Gestor no la tenga no significa que no exista: su corpus no
    // cubre todo el país. Antes de decir "no encontré" —que se lee como "esa
    // norma no existe"— se pregunta a SUIN, que sí la puede registrar.
    const f = c.anio && activa('suin') ? await suin.ficha(c.tipo, c.numero, c.anio) : null
    if (f?.ok) {
      const v = f.ficha
      return (
        `### ${cita}${equivalencia}\n` +
        `${alcance([{ clave: 'gestor', detalle: '0 documentos' }, { clave: 'suin', detalle: 'ficha encontrada' }])}\n` +
        `${articuloIgnorado}${cita} no está en el Gestor Normativo de Función Pública, pero SUIN-Juriscol sí la registra.\n` +
        (v.epigrafe ? `${v.epigrafe}\n` : '') +
        `Estado de vigencia según SUIN-Juriscol (ficha consultada hoy): ${v.estado || 'SUIN no publica el estado de esta norma'}\n` +
        `URL: ${v.url}\n\n` +
        suin.TEXTO_NO_PUBLICO +
        (pedidos.length ? ` Por eso no se puede devolver el artículo ${pedidos.join(', ')}: búscalo en el Diario Oficial.` : '')
      )
    }
    const suinCayo = f?.ok === false && f.razon === 'ficha-caida'
    return (
      `### ${cita}${equivalencia}\n` +
      `${alcance([
        { clave: 'gestor', detalle: '0 documentos' },
        ...(f ? [{ clave: 'suin', detalle: suinCayo ? 'no respondió' : 'sin ficha' }] : []),
      ])}\n\n` +
      `${articuloIgnorado}No encontré la cita "${cita}" en las fuentes consultadas.\n\n` +
      ((c.anio ? `Prueba sin el año, o verifica el número.` : `Prueba indicando el año.`) + otroTipo) +
      (f?.ok === false && f.detalle
        ? suinCayo
          ? `\n\nSUIN-Juriscol no respondió (${f.detalle}): no se pudo comprobar si la registra. Vuelve a intentarlo antes de concluir que no existe.`
          : `\n\nSUIN-Juriscol: ${f.detalle}.`
        : '') +
      (c.anio && !activa('suin') ? `\n\n${avisoApagada('suin')} Una norma que el Gestor no tiene solo la podía registrar SUIN.` : '')
    )
  }
  /**
   * Sin año, el número NO identifica una norma. "Decreto 1072" existe en 2025
   * (tarifas de energía), 2015 (Único Reglamentario del Sector Trabajo), 2004
   * y 1999, y el Gestor devuelve primero el más reciente. Entregar ese como si
   * fuera "el" Decreto 1072 es el error caro de esta herramienta: acierta la
   * forma —es un decreto real con ese número— y falla el fondo, sin que nada
   * en la respuesta invite a sospecharlo. Se devuelven los candidatos y se
   * pide el año, igual que ya se hace cuando el tipo no coincide.
   */
  if (!c.anio) {
    const conAnio = r.items
      .map((i) => ({ i, anio: i.titulo.match(/\bde\s+(\d{4})\b/i)?.[1] ?? '' }))
      .filter((x) => x.anio)
    if (new Set(conAnio.map((x) => x.anio)).size > 1) {
      return (
        `### ${cita}\nLa cita "${cita}" es ambigua: el Gestor tiene ${conAnio.length} normas con ese tipo y número, de años ` +
        `distintos. No se elige una por ti.\n\n` +
        conAnio
          .sort((a, b) => Number(b.anio) - Number(a.anio))
          .map(({ i }) => `- ${i.titulo} (id ${i.id})\n  ${i.url}`)
          .join('\n') +
        `\n\nRepite la cita con el año ("${c.tipo} ${c.numero} de ${conAnio[0]!.anio}")` +
        (c.articulo ? `, conservando el artículo ("art. ${c.articulo} de …")` : '') +
        `. Si no sabes cuál es, díselo a quien pregunta en vez de escoger: el número solo no identifica la norma.`
      )
    }
  }

  const n = r.items[0]!
  // Idea 11 — el dominio del enlace se comprueba siempre (falla blanda): si
  // no coincide con el esperado, se avisa en vez de devolver un enlace a ciegas.
  const dominioOk = validarUrl(n.url, 'funcionpublica.gov.co')
  const avisoDominio = dominioOk
    ? ''
    : `\nAVISO: el enlace devuelto no pertenece al dominio esperado (funcionpublica.gov.co): ${n.url}. Verifícalo antes de citarlo.`

  // La vigencia solo la publica SUIN, y solo si el índice empaquetado tiene
  // esta norma. Que falte no es un fallo: se calla y sigue mandando la regla
  // de no afirmar vigencia.
  // Si la cita vino sin año ("Decreto 1083"), se toma el del título que
  // resolvió el Gestor: sin esto la vigencia se perdía justo en las citas
  // cómodas, que son las que la gente escribe.
  // SUIN no tiene ficha de la Constitución (medido: «no consta… constitucion
  // politica 1 de 1991»), así que no se le pregunta.
  const anio = c.tipo === 'constitucion politica' ? undefined : (c.anio ?? n.titulo.match(/\bde\s+(\d{4})\b/i)?.[1])
  const conVigencia = anio && activa('suin')
  let vig = anio && !conVigencia ? `\nEstado de vigencia: ${avisoApagada('suin')}` : ''
  let detalleSuin = ''
  if (conVigencia) {
    // Dos silencios distintos que antes se veían iguales: que la fuente no
    // responda y que no tenga la norma. El primero es un estado del sistema, no
    // una respuesta sobre la norma, y presentarlo como ausencia de dato induce a
    // concluir de más. Por eso va con el motivo literal: quince consultas
    // seguidas devolvieron "no respondió" sin decir si era el corte del cliente,
    // un HTTP de error o el portal caído, que es justo lo que hay que comprobar.
    const f = await suin.ficha(c.tipo, c.numero, anio)
    if (f.ok) {
      detalleSuin = 'estado consultado'
      vig =
        `\nEstado de vigencia según SUIN-Juriscol (ficha consultada hoy): ` +
        `${f.ficha.estado || 'SUIN no publica el estado de esta norma'}\n  ${f.ficha.url}`
    } else if (f.razon === 'no-consta') {
      detalleSuin = 'sin ficha'
      vig =
        `\nEstado de vigencia: no consta. SUIN-Juriscol no tiene una ficha de ${c.tipo} ${c.numero} de ${anio}` +
        `${f.detalle ? ` (${f.detalle})` : ''}. No concluyas ni que está vigente ni que está derogada: revísalo en el enlace.`
    } else {
      detalleSuin = 'no respondió'
      vig =
        `\nEstado de vigencia: la ficha de SUIN-Juriscol no respondió en esta consulta (${f.detalle}). Vuelve a ` +
        `intentarlo antes de afirmar nada; no es que esta norma carezca de estado.`
    }
  }

  // La norma se descarga UNA vez, cualesquiera que sean los artículos pedidos:
  // seis llamadas separadas bajaban seis veces el mismo documento y repetían
  // seis veces la ficha y el bloque de vigencia.
  let extra = ''
  if (pedidos.length) {
    const norma = await gestor.obtenerNorma(n.id)
    extra = pedidos.map((num) => bloqueArticulo(norma.texto, num, n.url)).join('')
  }
  // No es un resumen de la norma: el Gestor no publica uno. Es el extracto de
  // UN tema al que está asociada, y en normas compiladoras como el Decreto 1083
  // describe una porción mínima del contenido. Sale una sola vez por norma y
  // por respuesta; cuando se omite se dice con qué parámetro vuelve, porque
  // callarlo se lee como que la norma no tiene tema asociado (mismo criterio
  // que sin_temas en obtener_documento).
  const repetido = opciones.yaConExtracto?.has(String(n.id)) ?? false
  opciones.yaConExtracto?.add(String(n.id))
  const contextoTema = !n.resumen
    ? ''
    : opciones.contexto === false
      ? '(Extracto de tema asociado omitido con contexto=false; vuelve con contexto=true.)\n'
      : repetido
        ? '(Extracto de tema asociado ya emitido más arriba para esta misma norma.)\n'
        : `Extracto de un tema asociado (NO resume la norma; usa obtener_documento con fuente="gestor" para su objeto y articulado): ${n.resumen}\n`
  const conSuin = conVigencia ? [{ clave: 'suin', detalle: detalleSuin }] : []
  /**
   * La llamada siguiente, escrita para poder copiarla. El id ya está en la
   * respuesta, pero convertirlo en la llamada siguiente obliga a recordar que la
   * fuente se llama "gestor" y que el parámetro se llama "id"; quien lee esto a
   * las once de la noche no debería tener que recordarlo.
   */
  const siguiente = pedidos.length
    ? `Siguiente paso: la norma completa está con obtener_documento con fuente="gestor", id="${n.id}".`
    : `Siguiente paso: el articulado, con obtener_documento con fuente="gestor", id="${n.id}"` +
      ` (o pide un artículo concreto en la cita: "art. 3 de ${cita}").`
  return (
    `### ${cita}${equivalencia}\n` +
    `${alcance([{ clave: 'gestor', detalle: 'norma resuelta' }, ...conSuin])}\n` +
    `${articuloIgnorado}${n.titulo}\n${tipoCorregido}id: ${n.id}\n` +
    contextoTema +
    (esCompiladora(n.titulo, 0) ? '\nAVISO: esta es una norma compilada que incorpora reformas; para un tema concreto usa obtener_documento con fuente="gestor" y buscar_en_texto.\n' : '') +
    `${siguiente}\n` +
    `URL: ${n.url}${avisoDominio}${vig}${extra}`
  )
}

export const TITULO = 'Resolver una cita normativa'

export const DESCRIPCION =
  'Ruta rápida y exacta para citas como "Ley 909 de 2004", "Decreto 1083", "C-337/11" o "artículo 6 de la ' +
  'Ley 1221 de 2008". Úsala SIEMPRE que la pregunta mencione una norma concreta: el buscador por palabras ' +
  'es impreciso. Los CÓDIGOS se citan por su nombre ("art. 191 del Código de Comercio", "art. 164 del ' +
  'CPACA") y la respuesta dice contra qué norma se resolvió. Acepta un LOTE con citas (["Ley 909 de 2004", ' +
  '"C-337/11"]), que resuelve cada una en una sola llamada, y varios ARTÍCULOS de la MISMA norma con ' +
  'articulos (["705", "710"]) y cita apuntando a la norma: se descarga una vez y la ficha no se repite.'

const esquema = z.object({
  cita: z
    .string()
    .optional()
    .describe('Ej.: "Ley 909 de 2004", "C-337/11", "art. 6 de la Ley 1221 de 2008", "art. 191 del Código de Comercio"'),
  citas: z
    .array(z.string())
    .optional()
    .describe('Varias citas a la vez, ej. ["Ley 909 de 2004", "C-337/11"]: cada una se resuelve y se devuelve con su enlace'),
  articulos: z
    .preprocess((v) => (Array.isArray(v) ? v.map(numeroDeArticulo) : v), z.array(z.string()).optional())
    .describe(
      'Varios artículos de la MISMA norma en una sola llamada, ej. ["705", "707", "710"]. Se usa con cita ' +
        'apuntando a la norma ("Decreto Ley 624 de 1989"); la norma se descarga una vez y se extrae cada artículo.'
    ),
  contexto: z
    .boolean()
    .optional()
    .describe(
      'Por defecto true. Con false se omite el extracto de tema asociado y queda solo la identificación, la ' +
        'vigencia y el texto pedido.'
    ),
  validar: z
    .boolean()
    .optional()
    .describe(
      'En vez de la resolución, comprueba que la cita (y el enlace, si se da con url) coincide con lo que ' +
        'devuelve el Gestor: número/año, dominio y artículo. Clasifica en "cita validada", "parcialmente ' +
        'validada" o "no fue posible validar". NUNCA afirma vigencia.'
    ),
  url: z.string().optional().describe('Enlace a comprobar (solo con validar=true)'),
  formato: z
    .enum(['markdown', 'json'])
    .optional()
    .describe(
      'Solo con validar=true: "json" devuelve el resultado como objeto (fecha_consulta, y por cita: resultado, ' +
        'comprobaciones, titulo, url, nota), sin cabecera ni pie, para encadenarlo sin releer texto.'
    ),
})

export const schema = estricto(esquema.shape)

type Params = z.infer<typeof esquema>

export async function escribir({ cita, citas, articulos, contexto, validar, url, formato }: Params): Promise<string> {
  if (validar) {
    const datos = await validarCita.escribir({
      ...(cita !== undefined ? { cita } : {}),
      ...(citas !== undefined ? { citas } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(formato !== undefined ? { formato } : {}),
    })
    // El modo json y el de texto devuelven el MISMO string: quien envuelve es
    // `registrarHerramienta`, que ya distingue los dos casos igual que hacía
    // este bloque cuando el registro estaba en línea.
    return datos
  }
  // Lote sin validación: cada cita se resuelve por la misma vía que una
  // cita individual, con su bloque propio. Un fallo de red de una cita se
  // anota en su bloque y no tumba a las demás.
  if (citas?.length) {
    // El extracto de tema sale una vez por norma en toda la respuesta: un
    // lote de citas de la misma norma lo repetía íntegro en cada bloque.
    const yaConExtracto = new Set<string>()
    const bloques: string[] = []
    for (const una of citas) {
      try {
        bloques.push(await resolverUnaCita(una, { contexto, yaConExtracto }))
      } catch (e) {
        bloques.push(
          `### ${una}\nLa fuente no respondió en esta consulta (${(e as Error).message}). ` +
            `Vuelve a intentarlo antes de afirmar nada.\nEnlace: (sin enlace)`
        )
      }
    }
    // `articulos` es de UNA norma: con un lote no se sabe a cuál aplicarlo, y
    // dejarlo caer en silencio contestaría a otra pregunta.
    const sobrante = articulos?.length
      ? `articulos (${articulos.join(', ')}) se ignoró: es para varios artículos de UNA norma, no para un lote. ` +
        `Pídelos con cita apuntando a la norma.\n\n`
      : ''
    // Igual con `cita`: el lote manda, pero callarlo dejaría creer que también
    // se resolvió la cita suelta.
    const citaSuelta = cita
      ? `cita ("${cita}") se ignoró: manda el lote citas (${citas.length}). Usa una vía u otra, no las dos.\n\n`
      : ''
    return (citaSuelta + sobrante + bloques.join('\n\n'))
  }
  if (!cita) {
    return vacio(
      'una cita normativa',
      'Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11" (y varias a la vez con citas), o usa buscar_normas.'
    )
  }
  return (await resolverUnaCita(cita, { articulos, contexto }))
}
