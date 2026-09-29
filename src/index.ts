import './arranque.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { parsearCita, parsearRadicado } from './nucleo/citas.ts'
import { activa, alcance, apagadas, avisoApagada, DESCARGO, herramientaActiva, NOMBRE_FUENTE } from './nucleo/alcance.ts'
import { citaCorteConstitucional } from './nucleo/cita_oficial.ts'
import { CODIGOS, codigoDe, referencia as refCodigo } from './nucleo/codigos.ts'
import { cargarIndice, frescura } from './nucleo/indice.ts'
import { esCompiladora } from './nucleo/compiladas.ts'
import { validarUrl } from './nucleo/evidencia.ts'
import { advertenciaSnapshot } from './nucleo/snapshot.ts'
import { vacio as vacioTexto } from './nucleo/vacio.ts'
import * as consultarJerarquia from './herramientas/consultar_jerarquia.ts'
import * as analizarConflicto from './herramientas/analizar_conflicto.ts'
import * as cambiosDesde from './herramientas/cambios_desde.ts'
import * as validarCita from './herramientas/validar_cita.ts'
import * as compararArticulos from './herramientas/comparar_articulos.ts'
import * as expedientes from './herramientas/expedientes.ts'
import * as consultarPerfil from './herramientas/consultar_perfil.ts'
import * as consultarVigencia from './herramientas/consultar_vigencia.ts'
import * as historialNorma from './herramientas/historial_norma.ts'
import * as buscarUnificado from './herramientas/buscar_unificado.ts'
import * as buscarDiarioOficial from './herramientas/buscar_diario_oficial.ts'
import * as lineaJurisprudencial from './herramientas/linea_jurisprudencial.ts'
import * as buscarNormas from './herramientas/buscar_normas.ts'
import * as buscarPorTema from './herramientas/buscar_por_tema.ts'
import * as listarCatalogos from './herramientas/listar_catalogos.ts'
import * as explicarRelacionTema from './herramientas/explicar_relacion_tema.ts'
import * as buscarNormativaAnh from './herramientas/buscar_normativa_anh.ts'
import * as buscarNormativaUpme from './herramientas/buscar_normativa_upme.ts'
import * as buscarResolucionesCreg from './herramientas/buscar_resoluciones_creg.ts'
import * as listarNormativaAmbientalAnla from './herramientas/listar_normativa_ambiental_anla.ts'
import * as buscarJurisprudencia from './herramientas/buscar_jurisprudencia.ts'
import * as buscarNormativaTributaria from './herramientas/buscar_normativa_tributaria.ts'
import * as buscarJurisprudenciaSuprema from './herramientas/buscar_jurisprudencia_suprema.ts'
import * as buscarEnSuin from './herramientas/buscar_en_suin.ts'
import { resolverCodigo } from './herramientas/codigo_senado.ts'
import { resolverRadicado } from './herramientas/resolver_radicado.ts'
import * as obtenerDocumento from './herramientas/obtener_documento.ts'
import { advertenciasVigencia, articulo as extraerArticulo, sinTildes } from './nucleo/parse.ts'
import { redResumen, VERSION } from './nucleo/http.ts'
import { avisoVersion } from './nucleo/actualizacion.ts'
import * as gestor from './fuentes/gestor.ts'
import * as corte from './fuentes/jurisprudencia/corte.ts'
import * as suin from './fuentes/suin.ts'
import * as consejo from './fuentes/jurisprudencia/consejoestado.ts'
import * as sectorial from './fuentes/sectorial.ts'
import './fuentes/sectorial/registro.ts'


const hoy = () => new Date().toISOString().slice(0, 10)

/** Toda respuesta sale fechada y con el descargo: es la fuente lo que la hace útil. */
const txt = (s: string) => ({
  content: [{ type: 'text' as const, text: `${s}\n\nConsulta del ${hoy()}. ${DESCARGO}${avisoVersion()}` }],
})

/**
 * Nunca se devuelve una lista vacía a secas: el vacío se explica, y cuando se
 * sabe sobre qué fuentes es el vacío se declara, porque "no encontré" a secas se
 * lee como "no existe" y son dos cosas distintas.
 */
const vacio = (que: string, sugerencia: string, lineaAlcance?: string) =>
  txt(vacioTexto(que, sugerencia, lineaAlcance))

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
  const anio = c.anio ?? n.titulo.match(/\bde\s+(\d{4})\b/i)?.[1]
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

// --- índice temático empaquetado -----------------------------------------

// --- servidor ------------------------------------------------------------

/** Radicados ya devueltos de la última búsqueda en el Consejo de Estado, con la página en que salieron. */
const memoriaCE: { clave: string; paginas: Map<string, number> } = { clave: '', paginas: new Map() }

// --- servidor ------------------------------------------------------------

/**
 * Instrucciones de uso que viajan con el servidor: el cliente MCP las recibe en
 * el `initialize` y las pone en contexto. Es el único mecanismo que corrige lo
 * que ninguna prueba puede verificar —que se elija la herramienta correcta—,
 * así que aquí van las reglas de enrutamiento y las trampas del portal, no una
 * descripción del producto. Conviene que sea corto: ocupa contexto siempre.
 */
const INSTRUCCIONES = `Fuentes oficiales de normativa colombiana: Gestor Normativo de Función Pública, Corte Constitucional, Corte Suprema, Consejo de Estado, SUIN-Juriscol (MinJusticia) y normograma de la DIAN.

Qué herramienta usar:
- La pregunta menciona una norma concreta ("Ley 909 de 2004", "Decreto 1083", "C-337/11", "el art. 6 de la Ley 1221") o un CÓDIGO por su nombre ("el art. 191 del Código de Comercio", "el 83 del Código Penal") → resolver_cita. Es exacta; el buscador por palabras no. El CÓDIGO CIVIL no está en el Gestor: resolver_cita lo lee, artículo por artículo, de la Secretaría del Senado (HTTP sin cifrar; sin sus notas de vigencia, que remite al enlace).
- Saber si una norma sigue vigente (estado con nivel de confianza) → consultar_vigencia. No lo afirmes por tu cuenta: si no consta, la herramienta lo dice y orienta.
- La pregunta es por materia ("¿qué normas hay sobre teletrabajo?") → buscar_por_tema. El buscador por palabras del portal solo indexa resúmenes y encuentra poquísimo: "teletrabajo" casa con 3 documentos cuando el subtema oficial tiene 55.
- Hay que saber qué dice una norma sobre algo → obtener_documento con fuente="gestor" y buscar_en_texto. Esa es la verdadera búsqueda de texto completo; el portal no la ofrece.
- Sentencias y autos → buscar_jurisprudencia (Corte Constitucional, al día). El Gestor casi no tiene jurisprudencia reciente.
- Normativa que el Gestor no tiene, o exploración por materia/sector del corpus histórico (desde 1844) → buscar_en_suin. NUNCA la uses para saber si algo está vigente: su campo de vigencia es del índice de búsqueda y contradice la ficha. La vigencia sale de resolver_cita.
- Impuestos, aduanas o cambios (retención, IVA, renta, importación) → buscar_normativa_tributaria y obtener_documento con fuente="dian". Ninguna otra herramienta cubre esa materia.
- Jurisprudencia de la Corte SUPREMA (casación civil, laboral, penal y sus tutelas) → buscar_jurisprudencia_suprema, y obtener_documento con fuente="suprema" para el texto completo con la ruta y la sala de esa misma búsqueda. Es un tribunal DISTINTO de la Corte Constitucional: no las mezcles. Exige indicar sala, y cada resultado trae las normas que cita, que puedes resolver con resolver_cita.
- Qué le pasó a una norma o a un artículo (quién lo modificó, adicionó o derogó) → historial_norma (cadena de reformas ordenada por el año de la norma que las hizo, con la última reforma ANOTADA señalada: no es «la que rige») u obtener_documento con fuente="gestor" e historial=true (las mismas notas en el orden del documento). Son notas literales del portal; no se deduce cuál rige hoy. Para ver qué cambió en un artículo, comparar_articulos con con_reforma=true contrasta lo que dispuso su última reforma con lo que el portal publica hoy (el portal consolida el texto: el «antes» no está).
- Qué providencias citan una sentencia de la Corte Constitucional (y si hay SU o C posteriores que la mencionen) → linea_jurisprudencial. Que una la cite NO es que la reitere ni que la respete, y la lista es la de la relatoría (puede estar incompleta): hay que leer la providencia.
- Un RADICADO judicial de 23 dígitos ("11001-03-28-000-2022-00132-00") → resolver_cita: lo descompone y lo busca en las providencias tituladas del Consejo de Estado (SAMAI); la Corte Suprema no permite buscar por radicado. No da el estado del proceso.
- En qué Diario Oficial se publicó una norma (tipo + número), o qué diarios salieron en unas fechas → buscar_diario_oficial. Da el número y la fecha del diario, no el texto ni las normas que trae.
- El fallo de una sentencia, sin leerla entera → obtener_documento con fuente="corte" y seccion="decision": trae el RESUELVE. La T-099/24 pasa de 140.162 a 39.906 caracteres.
- Jurisprudencia del CONSEJO DE ESTADO (contencioso administrativo: nulidad y restablecimiento, contratación estatal, nulidad electoral, reparación directa) → buscar_jurisprudencia_consejo_estado, y obtener_documento con fuente="consejo" y el token de esa búsqueda para el texto completo. Tercer tribunal distinto de los otros dos; cada resultado trae el problema jurídico y su respuesta. El token caduca en una hora: para CITAR usa el radicado, nunca el enlace con token.
- Por qué una norma aplica a un tema → explicar_relacion_tema con el temsubid ("ts-…") y el normid de la MISMA fila de buscar_por_tema.
- Antes de decirle a alguien que una norma "no existe", o para saber si el índice de vigencia sigue fresco → describir_fuentes. Declara qué cubre cada fuente y qué NO, sin consultar la red.
- Energía, gas, tarifas o conexión → buscar_resoluciones_creg (y obtener_documento con fuente="creg" para el texto). Hidrocarburos, regalías o contratos E&P → buscar_normativa_anh. Planeación minero energética → buscar_normativa_upme. Qué normas aplican a un tema ambiental → listar_normativa_ambiental_anla, y resuelve cada cita con resolver_cita.
- Cuatro reguladores tienen herramienta propia (CREG, ANH, UPME y ANLA) y otros doce se consultan con buscar_normativa_sectorial y su parámetro entidad (la SIC, la Superfinanciera, la Supersalud, la ANT y la Unidad para las Víctimas entre ellos): pide la lista a describir_fuentes. Para lo que no esté en ninguna de las dos listas —la CRC, la Superservicios— este MCP no tiene nada, y un vacío no prueba que la norma no exista.
- Leer el acto de un regulador sectorial → obtener_documento con fuente="sectorial", entidad=<el id de la búsqueda> y url=<el enlace del acto>. El texto se extrae si es PDF o Word; si es un escaneo, se avisa y se remite al enlace. Para guardar el documento en disco, añade entero=true (devuelve la ruta del archivo y un trozo para leer, nunca el documento entero) o ruta_destino=<carpeta> (descarga el archivo sin devolver texto). En las fuentes con enlace directo (dian con link, sectorial con url) entero y ruta_destino descargan el archivo original; en gestor/corte/suprema/creg, entero reconstruye el texto y lo escribe como .txt.

Nota de versión: los nombres de las herramientas de lectura se unificaron. Antes eran obtener_norma, obtener_sentencia, obtener_providencia_suprema, obtener_providencia_consejo_estado, obtener_documento_dian y obtener_resolucion_creg; ahora es una sola obtener_documento con el parámetro fuente ("gestor", "corte", "suprema", "consejo", "dian", "creg" o "sectorial"). Los subtemas y los conceptos de Función Pública viven en listar_catalogos (catalogo="subtemas" y catalogo="conceptos_fp"); validar_cita es resolver_cita con validar=true; y los expedientes son expediente con accion="crear|agregar|leer".

Reglas al responder:
- Cita siempre el enlace y la fecha de consulta que devuelven las herramientas. Una afirmación normativa sin fuente verificable no sirve.
- NUNCA afirmes por tu cuenta que una norma o un artículo está vigente. El Gestor y la relatoría no publican la vigencia: solo hay marcas de "Derogado" y "Modificado por" dentro del texto. Traslada esas advertencias y di con claridad que no se puede confirmar.
- La vigencia sale de la ficha de SUIN-Juriscol, para leyes y decretos. Su índice público llega hasta 2020: de una norma posterior no hay ficha, y eso NO significa que esté derogada ni vigente: significa que no consta.
- La ÚNICA excepción: si resolver_cita devuelve un "Estado de vigencia según SUIN-Juriscol", cítalo con su fecha y su enlace, tal cual, sin traducirlo a un sí o un no ("Vigencia en Estudio" no es "vigente"). Si esa línea no aparece, es que no consta: vuelve a la regla anterior.
- Que una norma no esté en el Gestor NO significa que no exista: su corpus no cubre todo el país. Si resolver_cita responde que la norma está en SUIN-Juriscol y no en el Gestor, esa es una respuesta completa, no un fallo. Su articulado no se puede leer aquí: SUIN no sirve hoy el texto fuera de la red del Ministerio.
- El "extracto temático" que acompaña a cada resultado NO resume la norma: es el apunte de un tema al que está asociada. Para el objeto real usa obtener_documento con fuente="gestor".
- Si una herramienta devuelve vacío, es que no se encontró; no completes con conocimiento propio.
- Si resolver_cita responde que la cita es AMBIGUA, no escojas tú: el mismo número existe en varios años ("Decreto 1072" son cuatro decretos distintos). Pregunta el año o presenta los candidatos.
- Un documento sin texto NO es un documento que no diga nada. Si la respuesta avisa de que es un escaneo o de que el portal no publicó el texto, dilo así y remite al enlace; no concluyas nada sobre su contenido.
- La cita judicial viene ya compuesta ("Cita oficial: …") en sentencias (resolver_cita) y normas (obtener_documento con fuente="gestor"): úsala tal cual. Lo que dice "no consta" (entidad expedidora, Diario Oficial, día del fallo) NO lo completes por tu cuenta.
- Una norma puede haberse sancionado sin regir todavía o regir por tramos: si la cabecera dice "AÚN NO RIGE" o "Vigencia según su propio artículo de vigencia", dilo antes de aplicarla.
- Nunca inventes números de norma, artículos ni sentencias. Si no aparecen en una respuesta, no existen para efectos de esta conversación.
- Los ids temáticos vienen con prefijo y no son intercambiables: "ts-" de buscar_por_tema (va en explicar_relacion_tema), "sub-" de listar_catalogos con catalogo="subtemas" (va en buscar_normas) y "tema-" de listar_catalogos. Pégalos tal cual, con el prefijo: son tres numeraciones distintas del portal que reutilizan los mismos números.

Herramientas V2:
- Filtrar por rango de la jerarquía (leyes, decretos, conceptos, jurisprudencia) → consultar_por_jerarquia; la respuesta explica el carácter (vinculante/orientador/informativo).
- Comprobar que una cita y su enlace son de verdad → resolver_cita con validar=true. Clasifica en "validada", "parcialmente validada" o "no fue posible validar", y nunca afirma vigencia.
- Comparar dos normas o dos artículos → analizar_conflicto (reúne EVIDENCIA; no concluye) y comparar_articulos (diferencia por patrones; lo no clasificado se revisa a mano).
- Resumir qué le pasó a normas listadas desde una fecha → cambios_desde. NO descubre normas nuevas: solo lee lo que el Gestor anota.
- Consultar por sector preconfigurado → consultar_perfil (laboral, tributario, ambiental, contratación, energía); cada perfil declara su advertencia.
- Encadenar resultados sin releer texto → formato="json" en buscar_unificado, analizar_conflicto, historial_norma y resolver_cita (con validar=true): devuelve el objeto de datos, sin pie. Los resultados de buscar_unificado traen "Para leer", la llamada ya armada a obtener_documento.
- Expedientes temporales (EXPEDIENTES=1): expediente con accion="crear|agregar|leer". Son memoria de sesión con expiración, no almacenamiento.
- Una consulta ambigua → el prompt aclarar-consulta hace las preguntas precisas antes de buscar.

Esto no es asesoría jurídica.`

/**
 * FUENTES ya se validó en `arranque.ts`, el primer import. Lo que el operador
 * apagó se dice en las instrucciones: sin esto, el modelo lee arriba que existe
 * buscar_jurisprudencia y la busca en una lista que no la trae.
 */
const off = apagadas()
const server = new McpServer(
  { name: 'normativa-colombia', version: VERSION },
  {
    instructions: off.length
      ? `${INSTRUCCIONES}\n\nEn esta instalación el operador DESACTIVÓ: ${off.map((k) => NOMBRE_FUENTE[k]).join(', ')}. ` +
        `Sus herramientas no existen aquí y ninguna otra las consulta. Que no aparezcan resultados de ellas no dice ` +
        `nada sobre lo que publican: dilo así si la pregunta las necesita.`
      : INSTRUCCIONES,
  },
)

/**
 * Una línea JSON por llamada, SIEMPRE a stderr: stdout es el canal JSON-RPC y
 * escribir ahí rompe el protocolo. Los clientes MCP guardan el stderr del
 * servidor en su log, así que esto es lo único que permite saber después qué
 * herramienta se usa, cuánto tarda y cuál falla —el servidor no emitía nada, y
 * un fallo contra un portal era indistinguible de una consulta sin resultados.
 *
 * Se envuelve `registerTool` una vez en lugar de tocar veintiséis handlers. Y
 * aquí mismo se omite la herramienta de una fuente que el operador apagó
 * (FUENTES): una sola puerta, en vez de un `if` delante de cada registro.
 *
 * ponytail: sin muestreo ni niveles; una línea por llamada es despreciable
 * cuando cada llamada cuesta una petición de red. Si algún día molesta, se
 * apaga por variable de entorno, no se filtra por nivel.
 *
 * ponytail: los tres `as never` de aquí abajo se quedan y son deliberados.
 * `registerTool` del SDK es genérico sobre el `inputSchema` e infiere de él el
 * tipo del handler; este envoltorio es justamente el sitio donde el esquema aún
 * no se conoce, así que la inferencia no tiene de dónde tirar. Son tres, en un
 * único punto, y no crecen al añadir herramientas. El salto siguiente, si
 * alguna vez compensa, es hacer genérica esta función sobre el shape de zod.
 */
type Registrar = typeof server.registerTool
const registrarOriginal = server.registerTool.bind(server) as Registrar
server.registerTool = ((nombre: string, config: unknown, handler: (...a: unknown[]) => unknown) =>
  !herramientaActiva(nombre) ? undefined : registrarOriginal(
    nombre as never,
    config as never,
    (async (...args: unknown[]) => {
      const t0 = performance.now()
      const anotar = (ok: boolean, error?: string) => {
        const red = redResumen()
        process.stderr.write(
          `${JSON.stringify({ ts: new Date().toISOString(), herramienta: nombre, ms: Math.round(performance.now() - t0), ok, peticiones: red.peticiones, bytes: red.bytes, repetidas: red.repetidas, copias: red.copias, ...(error ? { error } : {}) })}\n`,
        )
      }
      try {
        const r = await handler(...args)
        anotar(true)
        return r
      } catch (e) {
        // Se anota y se relanza: el enrutado de errores del SDK no cambia.
        anotar(false, e instanceof Error ? `${e.name}: ${e.message}` : String(e))
        throw e
      }
    }) as never,
  )) as Registrar

server.registerTool(
  'resolver_cita',
  {
    title: 'Resolver una cita normativa',
    description:
      'Ruta rápida y exacta para citas como "Ley 909 de 2004", "Decreto 1083", "C-337/11" o "artículo 6 de la ' +
      'Ley 1221 de 2008". Úsala SIEMPRE que la pregunta mencione una norma concreta: el buscador por palabras ' +
      'es impreciso. Los CÓDIGOS se citan por su nombre ("art. 191 del Código de Comercio", "art. 164 del ' +
      'CPACA") y la respuesta dice contra qué norma se resolvió. Acepta un LOTE con citas (["Ley 909 de 2004", ' +
      '"C-337/11"]), que resuelve cada una en una sola llamada, y varios ARTÍCULOS de la MISMA norma con ' +
      'articulos (["705", "710"]) y cita apuntando a la norma: se descarga una vez y la ficha no se repite.',
    inputSchema: {
      cita: z
        .string()
        .optional()
        .describe('Ej.: "Ley 909 de 2004", "C-337/11", "art. 6 de la Ley 1221 de 2008", "art. 191 del Código de Comercio"'),
      citas: z
        .array(z.string())
        .optional()
        .describe('Varias citas a la vez, ej. ["Ley 909 de 2004", "C-337/11"]: cada una se resuelve y se devuelve con su enlace'),
      articulos: z
        .array(z.string())
        .optional()
        .describe(
          'Varios artículos de la MISMA norma en una sola llamada, ej. ["705", "707", "710"]. Se usa con cita ' +
            'apuntando a la norma ("Decreto Ley 624 de 1989"); la norma se descarga una vez y se extrae cada artículo.',
        ),
      contexto: z
        .boolean()
        .optional()
        .describe(
          'Por defecto true. Con false se omite el extracto de tema asociado y queda solo la identificación, la ' +
            'vigencia y el texto pedido.',
        ),
      validar: z
        .boolean()
        .optional()
        .describe(
          'En vez de la resolución, comprueba que la cita (y el enlace, si se da con url) coincide con lo que ' +
            'devuelve el Gestor: número/año, dominio y artículo. Clasifica en "cita validada", "parcialmente ' +
            'validada" o "no fue posible validar". NUNCA afirma vigencia.',
        ),
      url: z.string().optional().describe('Enlace a comprobar (solo con validar=true)'),
      formato: z
        .enum(['markdown', 'json'])
        .optional()
        .describe(
          'Solo con validar=true: "json" devuelve el resultado como objeto (fecha_consulta, y por cita: resultado, ' +
            'comprobaciones, titulo, url, nota), sin cabecera ni pie, para encadenarlo sin releer texto.',
        ),
    },
  },
  async ({ cita, citas, articulos, contexto, validar, url, formato }) => {
    if (validar) {
      const datos = await validarCita.escribir({
        ...(cita !== undefined ? { cita } : {}),
        ...(citas !== undefined ? { citas } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(formato !== undefined ? { formato } : {}),
      })
      return formato === 'json' ? { content: [{ type: 'text' as const, text: datos }] } : txt(datos)
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
              `Vuelve a intentarlo antes de afirmar nada.\nEnlace: (sin enlace)`,
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
      return txt(citaSuelta + sobrante + bloques.join('\n\n'))
    }
    if (!cita) {
      return vacio(
        'una cita normativa',
        'Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11" (y varias a la vez con citas), o usa buscar_normas.',
      )
    }
    return txt(await resolverUnaCita(cita, { articulos, contexto }))
  },
)

registrarHerramienta('buscar_normas', buscarNormas)

registrarHerramienta('buscar_por_tema', buscarPorTema)

registrarHerramienta('listar_catalogos', listarCatalogos)

registrarHerramienta('buscar_jurisprudencia', buscarJurisprudencia)

registrarHerramienta('buscar_normativa_tributaria', buscarNormativaTributaria)

registrarHerramienta('buscar_jurisprudencia_suprema', buscarJurisprudenciaSuprema)

server.registerTool(
  'buscar_jurisprudencia_consejo_estado',
  {
    title: 'Buscar jurisprudencia del Consejo de Estado',
    description:
      'Providencias tituladas del Consejo de Estado, el supremo de lo contencioso administrativo (nulidad y ' +
      'restablecimiento, contratación estatal, nulidad electoral, reparación directa, conceptos de la Sala de ' +
      'Consulta): tribunal DISTINTO de la Corte Constitucional y de la Suprema. Cada resultado trae el problema ' +
      'jurídico y su respuesta, más el enlace a la ficha en SAMAI. ' +
      'CÓMO BUSCA: con exacto=true (activado) busca la FRASE EXACTA y, si no aparece, se amplía solo a OR ' +
      'avisándolo; en modo OR el número de páginas mide el corpus, no la pertinencia. Avanza con pagina.',
    inputSchema: {
      texto: z.string().describe('Términos a buscar, ej. "nulidad electoral", "liquidación del contrato"'),
      exacto: z
        .boolean()
        .default(true)
        .describe(
          'Frase exacta en SAMAI (activado); si no aparece, se amplía solo a OR con aviso. Ponlo en false para ' +
            'ampliar a propósito.',
        ),
      pagina: z.coerce
        .number()
        .int()
        .min(1)
        .default(1)
        .describe(
          'Página de resultados, desde 1. SAMAI pagina en bloques de ~10 y no admite un desplazamiento libre, ' +
            'por eso aquí se pide la página y no el "desde" del resto de herramientas.',
        ),
      limite: z.coerce.number().int().min(1).max(10).default(5).describe('Cuántas mostrar de la página (hasta 10)'),
    },
  },
  async ({ texto, pagina, limite, exacto }) => {
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
          : 'Prueba con un término más general.',
      )
    }
    return txt(
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
                (t.nota ? `\n    Nota de relatoría: ${t.nota.slice(0, 300)}` : ''),
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
        r.items.map((p) => p.radicado).join(' · '),
    )
  },
)

registrarHerramienta('buscar_en_suin', buscarEnSuin)

registrarHerramienta('explicar_relacion_tema', explicarRelacionTema)

// Las cuatro de este corte van registradas aquí, en el mismo orden en que
// estaban en línea: `tools/list` se sirve en orden de registro y cambiarlo
// cambiaría su respuesta byte a byte.
registrarHerramienta('buscar_normativa_anh', buscarNormativaAnh)
registrarHerramienta('buscar_normativa_upme', buscarNormativaUpme)
registrarHerramienta('buscar_resoluciones_creg', buscarResolucionesCreg)
registrarHerramienta('listar_normativa_ambiental_anla', listarNormativaAmbientalAnla)

// --- reguladores sectoriales --------------------------------------------

server.registerTool(
  'buscar_normativa_sectorial',
  {
    title: 'Buscar normativa de un regulador sectorial',
    description:
      'Actos administrativos —resoluciones, circulares, acuerdos— de los reguladores y ministerios sectoriales ' +
      'que el Gestor Normativo NO cataloga; elige cuál en `entidad`. CUÁNDO NO USARLA: para leyes y decretos ' +
      'nacionales de cualquier sector usa resolver_cita o buscar_por_tema, que dan texto completo y vigencia; el ' +
      'Decreto Único Reglamentario de cada sector (1071, 1072, 1074, 1076, 1079…) ya está en el Gestor.\n' +
      'Casi todas entregan PDF sin texto extraíble, y la mayoría no publica estado de vigencia; donde aparece ' +
      '(ANM, Supersociedades) es la fila del propio portal, no una verificación: para el estado real de una ley ' +
      'o un decreto, resolver_cita.\n' +
      'LOS FILTROS NO SE COMPORTAN IGUAL EN TODAS: el Invima exige texto o año; la Superfinanciera y la ' +
      'Supertransporte se quedan en el año en curso si no indicas otro; la ANM no aplica el año a las ' +
      'circulares. Cada respuesta dice qué hizo, pero no lo adivines: indica el año si lo esperabas.',
    inputSchema: {
      entidad: z
        .enum(sectorial.ids() as [string, ...string[]])
        .describe('Regulador a consultar. Usa describir_fuentes para ver qué sector cubre cada uno.'),
      texto: z.string().optional().describe('Filtra por número, año o epígrafe'),
      anio: z.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos'),
      categoria: z
        .string()
        .optional()
        .describe('Tipo de acto o categoría (cada fuente declara cuáles soporta; solo Unidad de Víctimas lo filtra hoy)'),
      solo_entidad: z
        .boolean()
        .optional()
        .describe(
          'Solo INVIMA/Supersalud: excluye la compilación sectorial del normograma (leyes, decretos y sentencias) ' +
            'y deja solo los actos que la entidad expide (Resolución, Circular…).',
        ),
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(15),
    },
  },
  async ({ entidad, texto, anio, pagina, limite, categoria, solo_entidad }) => {
    const a = sectorial.adaptador(entidad)
    if (!a) return vacio(`un regulador llamado "${entidad}"`, `Disponibles: ${sectorial.ids().join(', ')}.`)

    const r = await a.buscar({ texto, anio, pagina, limite, categoria, ...(solo_entidad !== undefined ? { solo_entidad } : {}) })
    // Un parámetro mal usado que devuelve resultados SIN filtrar es el peor
    // desenlace: se lee «estos son los actos de esa categoría» y no lo son. El
    // adaptador que sí lo aplica lo dice en su nota (medido: solo Unidad para
    // las Víctimas); el que no, calla. Aquí se convierte ese silencio en aviso.
    const categoriaIgnorada =
      categoria && !/categor[íi]a consultada/i.test(r.nota ?? '')
        ? `\nAVISO: el filtro categoria="${categoria}" NO se aplicó: esta fuente no filtra por categoría (hoy solo ` +
          `lo hace Unidad para las Víctimas). Los actos que siguen NO están acotados por esa categoría.`
        : ''
    // La advertencia de la fuente viaja SIEMPRE, haya resultados o no: es lo que
    // impide que un vacío de un regulador se lea como que la norma no existe.
    // A partir de la segunda página se abrevia: paginar 480 resoluciones de 15 en
    // 15 repetía el párrafo entero 32 veces, y quien pagina ya lo leyó. En un
    // vacío y en la primera página va completa, que son los dos casos en que se
    // puede concluir de más.
    const fuente = `\n\nFuente: ${a.nombre} — ${a.portal}\nQué NO cubre: `
    const completo = `${fuente}${a.advertencia}`
    const cierre =
      pagina > 1 ? `${fuente}lo mismo que declaró la página 1 de esta consulta; pídela con pagina=1 para releerlo.` : completo

    if (!r.items.length) {
      return vacio(
        `actos de ${a.nombre}${texto ? ` que coincidan con "${texto}"` : ''}${anio ? ` de ${anio}` : ''}`,
        `${r.nota ? `${r.nota} ` : ''}Consultado: ${r.url}.${categoriaIgnorada}${completo}`,
      )
    }

    // Parques lista dos veces la Ley 1333 de 2009 en la misma página, con fecha y
    // enlace distintos. Son dos filas reales de una página mantenida a mano, no un
    // duplicado nuestro, pero contarlas como dos normas es un error de quien lee.
    const repes = new Map<string, number>()
    for (const d of r.items) {
      const k = `${d.tipo} ${d.numero} de ${d.anio}`.toLowerCase()
      repes.set(k, (repes.get(k) ?? 0) + 1)
    }
    const dobles = [...repes].filter(([, n]) => n > 1).map(([k]) => k)

    return txt(
      `${alcance([{ clave: 'sectorial', detalle: `${a.nombre}: ${r.items.length} acto(s)` }])}\n\n` +
        `${r.items.length} acto(s) de ${a.nombre} (${a.sector})` +
        (r.total ? ` de ${r.total} que reúne el filtro` : '') +
        `.${r.nota ? `\n${r.nota}` : ''}${categoriaIgnorada}` +
        (dobles.length
          ? `\nEl portal repite en esta misma página ${dobles.length === 1 ? 'una entrada' : `${dobles.length} entradas`} ` +
            `(${dobles.join('; ')}), con fecha o enlace distintos. Son filas suyas, no copias nuestras: son menos ` +
            `normas de las que parecen.`
          : '') +
        `\n\n` +
        r.items
          .map(
            (d) =>
              `- ${d.tipo} ${d.numero}${d.anio ? ` de ${d.anio}` : ''}${d.fecha ? ` (${d.fecha})` : ''}\n` +
              `  ${d.epigrafe || '(sin epígrafe)'}\n` +
              (d.url ? `  ${d.url}` : '  (el portal no publicó enlace para este acto)'),
          )
          .join('\n') +
        cierre,
    )
  },
)

/**
 * Las claves de `describir_fuentes.fuente`. Los ids de los reguladores salen
 * del registro sectorial para que el catálogo no se duplique en el esquema; los
 * tres alias cortos existen porque el nombre largo de las cortes se escribe de
 * forma natural sin el apellido, y antes se resolvían por coincidencia parcial.
 */
const ALIAS_FUENTES: Record<string, string> = {
  corte: 'corte-constitucional',
  suprema: 'corte-suprema',
  consejo: 'consejo-de-estado',
}
/** De la clave larga de describir_fuentes a la de FUENTES y la línea de alcance. */
const ALIAS_INVERSO = Object.fromEntries(Object.entries(ALIAS_FUENTES).map(([k, v]) => [v, k]))
const CLAVES_FUENTES = [
  'gestor',
  'corte-constitucional',
  'corte-suprema',
  'consejo-de-estado',
  'dian',
  'suin',
  'senado',
  'diario',
  'creg',
  'anh',
  'upme',
  'anla',
  ...sectorial.ids(),
  ...Object.keys(ALIAS_FUENTES),
] as [string, ...string[]]

server.registerTool(
  'describir_fuentes',
  {
    title: 'Qué cubre este MCP, y qué no',
    description:
      'Declara el alcance real: qué fuente responde cada pregunta, qué NO está cubierto y con qué fecha se ' +
      'generaron los índices que viajan empaquetados. Úsala ANTES de concluir que algo "no existe" a partir de ' +
      'una búsqueda vacía, y para saber si el índice de vigencia sigue fresco. No consulta la red. ' +
      'Con el parámetro `fuente` devuelve SOLO el alcance de esa fuente, que es lo que suele hacer falta; sin él, ' +
      'el cuadro completo, que es largo.',
    inputSchema: {
      fuente: z
        .enum(CLAVES_FUENTES)
        .optional()
        .describe('Clave de una sola fuente ("creg", "suin", "sic"…). Sin ella se devuelven todas.'),
    },
  },
  ({ fuente }) => {
    const idx = cargarIndice()
    const suinIdx = suin.coberturaIndice()
    const normasIndexadas = idx?.filas.reduce((n, f) => n + f.n.length, 0) ?? 0

    const fuentes = ([
      ['gestor', `- Gestor Normativo (Función Pública) — normas del sector público: leyes, decretos, resoluciones, circulares y ` +
        `conceptos. Es el corpus principal. NO publica estado de vigencia, y su buscador por palabras solo indexa los ` +
        `resúmenes temáticos, no el articulado: para buscar dentro de una norma, obtener_documento con fuente="gestor" y buscar_en_texto.`],
      ['corte-constitucional', `- Corte Constitucional — relatoría al día, sentencias y autos con texto completo.`],
      ['corte-suprema', `- Corte Suprema de Justicia — cuatro salas (Tutelas, Civil, Laboral, Penal) desde 1991. Entrega la referencia, ` +
        `las normas citadas y el TEXTO COMPLETO con obtener_documento con fuente="suprema", que necesita la ruta y la misma sala ` +
        `de la búsqueda.`],
      ['consejo-de-estado', `- Consejo de Estado (SAMAI) — providencias tituladas de lo contencioso administrativo, con el problema jurídico, ` +
        `su respuesta y el TEXTO COMPLETO con obtener_documento con fuente="consejo". El texto sale del PDF que publica ` +
        `el buscador; su token caduca en una hora, así que para citar se usa el radicado, no el enlace.`],
      ['dian', `- DIAN — normograma tributario, aduanero y cambiario. Ninguna otra herramienta cubre esa materia.`],
      ['suin', `- SUIN-Juriscol (MinJusticia) — corpus histórico desde 1844 y, sobre todo, la ÚNICA fuente que publica el ` +
        `estado de vigencia como dato.`],
      ['senado', `- Secretaría del Senado — solo el CÓDIGO CIVIL (Ley 84 de 1873), artículo por artículo, porque el Gestor no lo ` +
        `publica y SUIN no sirve su texto. Solo HTTP sin cifrar: el texto no se puede autenticar en tránsito. Trae los ` +
        `apartes tachados (inexequibles o derogados) marcados con ~~ ~~, y NO reproduce las notas de vigencia y ` +
        `jurisprudencia del portal (son de su editor): remite al enlace.`],
      ['diario', `- Diario Oficial (Imprenta Nacional) — la consulta pública de diarios publicados: en qué diario (número, edición, ` +
        `fecha) salió una norma, dado su tipo y número, o qué diarios salieron en unas fechas. Cubre normas de la misma ` +
        `semana que el Gestor aún no cataloga. NO da el texto (el PDF del diario es de sesión, pesa hasta 15 MB y no es ` +
        `citable), NO sabe qué normas trae cada diario y NO filtra por entidad. Un vacío no prueba que no se haya publicado.`],
      ['creg', `- CREG — resoluciones de energía y gas. La única fuente sectorial cuyo TEXTO se puede leer aquí, y la única ` +
        `que separa las no derogadas de las derogadas en compilaciones distintas.`],
      ['anh', `- ANH — 785 actos de hidrocarburos (contratos, regalías, fiscalización). Solo PDF: epígrafe y enlace.`],
      ['upme', `- UPME — circulares y resoluciones de planeación minero energética. Solo PDF. Su fecha es la de publicación ` +
        `en la web, no la de la norma.`],
      ['anla', `- ANLA (Eureka) — clasificación temática de la normativa ambiental. Aporta el mapa, no los documentos: casi ` +
        `todo lo que lista son leyes y decretos que resolver_cita ya resuelve mejor.`],
      ...sectorial
        .adaptadores()
        .map(
          (a) =>
            [a.id, `- ${a.nombre} (entidad="${a.id}" en buscar_normativa_sectorial) — ${a.sector}. ${a.advertencia}`] as [
              string,
              string,
            ],
        ),
    ] as [string, string][]).map(([k, t]): [string, string] => {
      // Se sigue describiendo lo que el operador apagó: quien pregunta por la
      // CREG tiene que saber que existe y que esta instalación no la consulta.
      const clave = ALIAS_INVERSO[k] ?? (sectorial.ids().includes(k) ? 'sectorial' : k)
      return activa(clave) ? [k, t] : [k, `${t} [DESACTIVADA en esta instalación (FUENTES): no se consulta y sus herramientas no existen aquí.]`]
    })

    // Pedir el alcance de la CREG no debería costar el texto de las otras veinte.
    if (fuente) {
      const crudo = sinTildes(fuente).toLowerCase().trim()
      const q = ALIAS_FUENTES[crudo] ?? crudo
      const una = fuentes.find(([k]) => k === q) ?? fuentes.find(([k, t]) => k.includes(q) || sinTildes(t).toLowerCase().includes(q))
      if (!una) {
        return vacio(
          `una fuente llamada "${fuente}"`,
          `Las claves son: ${fuentes.map(([k]) => k).join(', ')}. Sin el parámetro fuente se devuelven todas.`,
        )
      }
      return txt(
        `normativa-colombia ${VERSION} — alcance de una sola fuente.\n\n${una[1]}\n\n` +
          `Esto es SOLO esa fuente: llama a describir_fuentes sin parámetros para el cuadro completo, con lo que ` +
          `no está cubierto y la fecha de los índices empaquetados. Que una búsqueda salga vacía aquí significa ` +
          `que no se encontró en ESTA fuente, no que la norma no exista.`,
      )
    }

    const empaquetado = [
      idx
        ? `- Índice temático: ${idx.filas.length.toLocaleString('es')} pares tema/subtema y ` +
          `${normasIndexadas.toLocaleString('es')} asociaciones norma–subtema. Generado el ${idx.generado}.${frescura(idx.generado)}${advertenciaSnapshot(idx.generado)}`
        : `- Índice temático: NO viaja con esta instalación. buscar_por_tema consultará el portal en vivo y será más lento.`,
      suinIdx
        ? `- Índice de SUIN: ${suinIdx.leyes.toLocaleString('es')} leyes, para resolver una cita escrita como texto sin red. Generado el ${suinIdx.generado}.${advertenciaSnapshot(suinIdx.generado)}`
        : `- Índice de SUIN: NO viaja con esta instalación. buscar_en_suin irá directo al buscador del portal; la ` +
          `vigencia no depende de él.`,
    ]

    return txt(
      `normativa-colombia ${VERSION} — alcance declarado.\n\n` +
        `FUENTES (pide una sola con fuente="creg", "suin", "sic"…)\n${fuentes.map(([, t]) => t).join('\n')}\n\n` +
        `ÍNDICES EMPAQUETADOS (responden sin red)\n${empaquetado.join('\n')}\n\n` +
        `LO QUE NO ESTÁ CUBIERTO — decirlo importa más que la lista de arriba:\n` +
        `- El ESTADO PROCESAL de un caso: si un proceso sigue abierto, en qué etapa va o cuándo se falla. Aquí solo ` +
        `hay normas y providencias YA PUBLICADAS.\n` +
        `- La vigencia de lo POSTERIOR A 2020: la ficha de SUIN sale de su índice público, que llega hasta 2020. Que ` +
        `una norma de 2021 en adelante no traiga estado NO significa que esté derogada ni vigente: no consta.\n` +
        `- El TEXTO de los documentos de SUIN: su visor lo pide a una dirección privada del Ministerio y se queda en ` +
        `blanco. Se da la ficha y el estado; el articulado, del Gestor o del Diario Oficial.\n` +
        `- Los códigos se citan por su nombre (Comercio, Sustantivo del Trabajo, Procesal del Trabajo, Penal, ` +
        `Procedimiento Penal, General del Proceso, CPACA, Infancia y Adolescencia, Estatuto Tributario) y salen del ` +
        `Gestor. El CÓDIGO CIVIL (${refCodigo(CODIGOS.find((c) => c.senado)!)}) no está allí: se lee artículo por artículo de la ` +
        `Secretaría del Senado, que solo sirve HTTP sin cifrar y cuyas notas de vigencia y jurisprudencia de cada ` +
        `artículo NO se reproducen (están en el enlace). Con esa fuente apagada (FUENTES) o caída, el Civil no se puede leer.\n` +
        `- Las leyes que MODIFICAN un código se leen a través de la ley modificatoria: el artículo devuelve su ` +
        `encabezado y el texto que sustituye; el cuerpo del código modificado, con su propia cita ("art. N del Código ` +
        `Civil", "art. N del Código de Comercio").\n` +
        `- La normativa departamental y municipal, salvo la que el Gestor recoja por su cuenta.\n` +
        `- Los tribunales y juzgados distintos de las tres altas cortes.\n` +
        `- EL RESTO DE LA REGULACIÓN SECTORIAL. Con herramienta propia hay cuatro reguladores —CREG, ANH, UPME y ` +
        `ANLA—; los demás que aparecen en la lista de FUENTES se consultan por el parámetro entidad de ` +
        `buscar_normativa_sectorial (${sectorial.ids().join(', ')}). Fuera de esas dos listas no hay nada: NO están ` +
        `la CRC, la Superservicios, la Supersalud ni las demás comisiones y superintendencias. Que este MCP tenga ` +
        `"algo sectorial" no significa que tenga lo sectorial.\n` +
        `- El RASTREO AUTOMÁTICO DE NOVEDADES: ninguna fuente publica un feed de cambios; cambios_desde solo resume ` +
        `lo que el Gestor anota sobre las normas que se le listan.\n` +
        `- La DETECCIÓN SEMÁNTICA DE CONFLICTOS entre normas: analizar_conflicto reúne evidencia, no concluye.\n` +
        `- Los EXPEDIENTES de investigación (expediente) existen pero vienen DESACTIVADOS por defecto: se activan ` +
        `con EXPEDIENTES=1 (y persisten en disco con EXPEDIENTES_DIR). No es un fallo: es una capacidad que el ` +
        `operador decide encender.\n\n` +
        `CÓMO LEER UN VACÍO: que una búsqueda no devuelva nada significa que no se encontró en ESTAS fuentes, con ` +
        `estos índices y con estos huecos. No significa que la norma no exista. El corpus del Gestor no cubre todo ` +
        `el país, y el índice de SUIN tiene agujeros conocidos.`,
    )
  },
)

// --- herramientas V2 (módulos de la Ola 1) -------------------------------

// El formato común (fecha, descargo, aviso de versión, logging) lo pone `txt`;
// cada módulo solo exporta título, descripción, esquema y el texto puro.
type HerramientaV2 = {
  TITULO: string
  DESCRIPCION: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  escribir: (p: any) => Promise<string>
}

function registrarHerramienta(nombre: string, m: HerramientaV2) {
  return server.registerTool(
    nombre,
    { title: m.TITULO, description: m.DESCRIPCION, inputSchema: m.schema },
    // Con `formato: "json"` la respuesta es SOLO el JSON: el pie de fecha y descargo lo rompería, así
    // que ese modo lleva dentro `fecha_consulta`, `alcance` y `avisos` (lo escribe cada herramienta).
    //
    // ponytail: el `as never` del final es el mismo caso que en el gancho de arriba —`registerTool`
    // infiere el handler del `inputSchema`, y aquí el shape llega en una variable—. Es UNO, no uno
    // por herramienta: las 16 llamadas de abajo ya no llevan ninguno.
    (async (p: { formato?: string }) =>
      p?.formato === 'json'
        ? { content: [{ type: 'text' as const, text: await m.escribir(p) }] }
        : txt(await m.escribir(p))) as never,
  )
}

registrarHerramienta('consultar_por_jerarquia', consultarJerarquia)
registrarHerramienta('analizar_conflicto', analizarConflicto)
registrarHerramienta('cambios_desde', cambiosDesde)
registrarHerramienta('comparar_articulos', compararArticulos)
registrarHerramienta('consultar_perfil', consultarPerfil)
registrarHerramienta('consultar_vigencia', consultarVigencia)
registrarHerramienta('historial_norma', historialNorma)
registrarHerramienta('buscar_unificado', buscarUnificado)
registrarHerramienta('linea_jurisprudencial', lineaJurisprudencial)
registrarHerramienta('buscar_diario_oficial', buscarDiarioOficial)
registrarHerramienta('obtener_documento', obtenerDocumento)
registrarHerramienta('expediente', expedientes)

// --- prompts (aparecen como comandos en Claude Desktop) ------------------

server.registerPrompt(
  'normas-sobre',
  {
    title: '¿Qué normas aplican sobre un tema?',
    description: 'Busca la normativa aplicable a un tema y explica por qué aplica cada una.',
    argsSchema: { tema: z.string() },
  },
  ({ tema }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `¿Qué normas del sector público colombiano aplican sobre "${tema}"? Usa buscar_por_tema, y para las más ` +
            `relevantes usa explicar_relacion_tema para decirme por qué aplican. Cita siempre con enlace.`,
        },
      },
    ],
  }),
)

server.registerPrompt(
  'sigue-vigente',
  {
    title: '¿Esta norma sigue vigente?',
    description: 'Revisa el texto en busca de derogatorias y modificaciones.',
    argsSchema: { norma: z.string() },
  },
  ({ norma }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `¿"${norma}" sigue vigente? Consúltala con consultar_vigencia (estado con nivel de confianza) y, para ` +
            `las marcas de derogatorias y modificaciones, revisa el texto con obtener_documento con fuente="gestor" ` +
            `buscando "derogad" y "modificado por", o el historial con historial_norma. Dime qué encontraste y ` +
            `advierte con claridad si no puedes confirmarlo: el Gestor no tiene un campo de vigencia.`,
        },
      },
    ],
  }),
)

server.registerPrompt(
  'explicar-sencillo',
  {
    title: 'Explícame esta norma en lenguaje sencillo',
    description: 'Resume una norma sin jerga, para cualquier persona.',
    argsSchema: { norma: z.string() },
  },
  ({ norma }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Explícame "${norma}" en lenguaje sencillo, sin jerga jurídica: qué regula, a quién aplica y qué obliga. ` +
            `Consúltala primero con resolver_cita y cita los artículos con su enlace.`,
        },
      },
    ],
  }),
)

server.registerPrompt(
  'comparar-normas',
  {
    title: 'Compara dos normas',
    description: 'Contrasta el alcance de dos normas.',
    argsSchema: { primera: z.string(), segunda: z.string() },
  },
  ({ primera, segunda }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Compara "${primera}" y "${segunda}": qué regula cada una, en qué se solapan y en qué se contradicen. Consulta ambas y cita con enlaces.`,
        },
      },
    ],
  }),
)

// Idea 9 — aclarar la consulta antes de buscar, para no elegir una norma
// ambigua ni consultar fuentes de más. Es texto que guía al modelo.
server.registerPrompt(
  'aclarar-consulta',
  {
    title: 'Aclarar una consulta ambigua',
    description: 'Haz las preguntas precisas antes de consultar una norma.',
    argsSchema: { consulta: z.string() },
  },
  ({ consulta }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text:
            `Antes de responder a "${consulta}", si falta algún dato, pregunta lo siguiente:\n` +
            `1. ¿Qué año de la norma necesitas? (el número solo no identifica la norma: "Decreto 1072" son varios)\n` +
            `2. ¿Qué jurisdicción aplica? (nacional, sectorial, de una alta corte…)\n` +
            `3. ¿Qué sector o entidad está involucrado?\n` +
            `4. ¿Buscas texto, vigencia, historial o jurisprudencia?\n` +
            `5. ¿Necesitas la norma completa o solo un artículo?\n` +
            `Haz solo las preguntas que falten; no repitas las que ya estén respondidas. Luego consulta con las herramientas de este MCP.`,
        },
      },
    ],
  }),
)

await server.connect(new StdioServerTransport())
