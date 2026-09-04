import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { idTipo, parsearCita } from './nucleo/citas.ts'
import { codigoDe, codigosAusentes, referencia as refCodigo } from './nucleo/codigos.ts'
import { cargarIndice, temaDelIndice, frescura } from './nucleo/indice.ts'
import { normalizarEntidad, NO_EN_GESTOR } from './nucleo/entidades.ts'
import { esCompiladora } from './nucleo/compiladas.ts'
import { conAlternativas } from './nucleo/alternativas.ts'
import { validarUrl } from './nucleo/evidencia.ts'
import { advertenciaSnapshot } from './nucleo/snapshot.ts'
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
import * as obtenerDocumento from './herramientas/obtener_documento.ts'
import {
  advertenciasVigencia,
  articulo as extraerArticulo,
  indiceArticulos,
  normalizarRotulo,
  sinTildes,
} from './nucleo/parse.ts'
import { redResumen, VERSION } from './nucleo/http.ts'
import { avisoVersion } from './nucleo/actualizacion.ts'
import * as gestor from './fuentes/gestor.ts'
import * as corte from './fuentes/jurisprudencia/corte.ts'
import * as suin from './fuentes/suin.ts'
import * as dian from './fuentes/normograma.ts'
import * as suprema from './fuentes/jurisprudencia/cortesuprema.ts'
import * as consejo from './fuentes/jurisprudencia/consejoestado.ts'
import * as anh from './fuentes/anh.ts'
import * as upme from './fuentes/upme.ts'
import * as creg from './fuentes/creg.ts'
import * as anla from './fuentes/anla.ts'
import * as sectorial from './fuentes/sectorial.ts'
import './fuentes/sectorial/registro.ts'


const DESCARGO =
  'Fuente oficial; los datos se publican con propósitos informativos. Verifica siempre en el enlace antes de tomar una decisión.'

const hoy = () => new Date().toISOString().slice(0, 10)

/** Toda respuesta sale fechada y con el descargo: es la fuente lo que la hace útil. */
const txt = (s: string) => ({
  content: [{ type: 'text' as const, text: `${s}\n\nConsulta del ${hoy()}. ${DESCARGO}${avisoVersion()}` }],
})

/** Nunca se devuelve una lista vacía a secas: el vacío se explica. */
const vacio = (que: string, sugerencia: string) =>
  txt(`No encontré ${que} en las fuentes consultadas.\n\n${sugerencia}`)

/**
 * Resuelve UNA cita de `resolver_cita` en texto puro (sin el envoltorio `txt`,
 * que lo pone quien llama). La ruta individual llama con una sola cita; el
 * lote itera sobre esta misma función, así que ambas vías resuelven igual.
 */
async function resolverUnaCita(cita: string): Promise<string> {
  const c = parsearCita(cita)
  if (!c) return `### ${cita}\nNo encontré una cita normativa en "${cita}". Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11", o usa buscar_normas.`

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
  /** Un código que se sabe fuera del corpus se nombra como ausente, no como inexistente. */
  const ausente = cod?.ausente

  // Las sentencias de la Corte se resuelven contra su relatoría, que está al día.
  if (c.sentencia) {
    const p = await corte.porSentencia(c.sentencia)
    if (p) {
      return [
        `### ${cita}`,
        `${p.sentencia} (${p.tipo}) — Corte Constitucional`,
        `Fecha: ${p.fecha} · Publicación: ${p.publicacion} · Expediente: ${p.expediente}`,
        p.magistrados.length ? `Magistrados: ${p.magistrados.join(', ')}` : '',
        p.tema ? `Tema: ${p.tema}` : '',
        p.sintesis ? `Síntesis: ${p.sintesis}` : '',
        `Texto completo: usa obtener_documento con fuente="corte" y ruta="${p.ruta}"`,
        `URL: ${p.url}`,
      ]
        .filter(Boolean)
        .join('\n')
    }
  }

  let r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })

  /**
   * El tipo escrito casi nunca es el tipo oficial: "Decreto 1567 de 1998" no
   * existe, pero "Decreto Ley 1567 de 1998" sí. Se reintenta sin filtrar por
   * tipo, PERO solo se acepta si el tipo oficial contiene al escrito: número y
   * año no identifican una norma —existen a la vez la Ley 1541 de 2012 y el
   * Decreto 1541 de 2012—, y devolver el otro sería peor que no encontrar
   * nada, porque nadie sospecharía del cambio.
   */
  let tipoCorregido = ''
  let otroTipo = ''
  if (!r.items.length && c.anio) {
    const sinTipo = await gestor.buscar({ numero: c.numero, anio: c.anio })
    const real = sinTipo.items[0]?.titulo.match(/^(.+?)\s+\d/)?.[1]?.trim()
    const escrito = sinTildes(c.tipo).toLowerCase()
    if (real && new RegExp(`\\b${escrito}\\b`, 'i').test(sinTildes(real).toLowerCase())) {
      r = sinTipo
      tipoCorregido = `\nNo existe un «${c.tipo} ${c.numero} de ${c.anio}»; el tipo oficial es «${real}».\n`
    } else if (real) {
      // No se corta aquí: la norma puede existir en SUIN aunque el Gestor solo
      // tenga la homónima de otro tipo. La pista se guarda para el vacío.
      otroTipo =
        ` Con ese número y año el Gestor sí tiene «${sinTipo.items[0]!.titulo}», que es de otro tipo: si te referías` +
        ` a esa, pídela con su tipo exacto.`
    }
  }

  if (!r.items.length) {
    // Que el Gestor no la tenga no significa que no exista: su corpus no
    // cubre todo el país. Antes de decir "no encontré" —que se lee como "esa
    // norma no existe"— se pregunta a SUIN, que sí la puede registrar.
    const v = c.anio ? await suin.vigencia(c.tipo, c.numero, c.anio).catch(() => null) : null
    if (v) {
      const arts = indiceArticulos(v.texto)
      const art = c.articulo ? extraerArticulo(v.texto, c.articulo) : null
      return (
        `### ${cita}${equivalencia}\n${cita} no está en el Gestor Normativo de Función Pública, pero SUIN-Juriscol sí la publica.\n` +
        (v.epigrafe ? `${v.epigrafe}\n` : '') +
        `Estado de vigencia según SUIN (índice del ${v.generado}): ` +
        `${v.estado || 'SUIN no publica el estado de esta norma'}\n` +
        `URL: ${v.url}\n` +
        `Texto: ${v.texto.length} caracteres${arts.length ? `; artículos ${arts.join(', ')}` : ''}.` +
        (art
          ? `\n\n--- Artículo ${c.articulo} ---\n${art}\n${advertenciasVigencia(art).join('\n')}`
          : `\n\nEl articulado no se devuelve entero: pide el artículo que necesitas en la cita ("art. 3 de ${cita}") o abre el enlace.`)
      )
    }
    // Sin la línea de equivalencia: el propio texto de la ausencia ya nombra la
    // norma, y repetirla dos veces distrae de lo único que importa aquí.
    if (ausente) return `### ${cita}\n${ausente}`
    return (
      `### ${cita}${equivalencia}\nNo encontré la cita "${cita}" en las fuentes consultadas.\n\n` +
      ((c.anio ? `Prueba sin el año, o verifica el número.` : `Prueba indicando el año.`) + otroTipo)
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
  let vig = ''
  if (anio) {
    // Tres silencios distintos que antes se veían iguales: que la capacidad no
    // esté instalada, que la fuente no responda y que la norma no conste en el
    // índice. Solo el tercero se sigue callando —la regla general ya cubre "no
    // consta"—; los otros dos son estados del sistema, no respuestas sobre la
    // norma, y presentarlos como ausencia de dato induce a concluir de más.
    if (!suin.coberturaIndice()) {
      vig =
        `\nEstado de vigencia: NO SE PUEDE CONSULTAR en esta instalación, porque el índice de SUIN no viaja con ` +
        `ella. Es una capacidad ausente, no un dato negativo: no concluyas nada sobre la vigencia.`
    } else {
      try {
        const v = await suin.vigencia(c.tipo, c.numero, anio)
        if (v) {
          vig =
            `\nEstado de vigencia según SUIN-Juriscol (índice del ${v.generado}): ` +
            `${v.estado || 'SUIN no publica el estado de esta norma'}\n  ${v.url}`
        } else {
          // Callarse aquí era una asimetría: las leyes siempre traían la línea
          // —aunque fuera para decir que SUIN no respondió— y los decretos la
          // perdían sin más, que se lee como "el dato no aplica" en vez de "no
          // se puede saber". El índice de SUIN son casi solo leyes.
          vig =
            `\nEstado de vigencia: no consta. El índice de SUIN que viaja aquí son casi solo leyes (los sitemaps ` +
            `de decretos del portal devuelven 404), así que de esta norma no hay estado que consultar. No ` +
            `concluyas ni que está vigente ni que está derogada: revísalo en el enlace.`
        }
      } catch (e) {
        // SUIN es un complemento y la cita se resuelve igual, pero que se haya
        // caído no puede parecerse a que la norma no tenga estado publicado.
        //
        // Y hay que nombrar QUÉ se cayó: SUIN vive en dos servidores distintos
        // —la ficha en www.suin-juriscol.gov.co y el buscador en un índice de
        // Azure—, y el primero se cae solo. Sin decirlo, ver esta línea junto a
        // un buscar_en_suin que responde llevaba a la conclusión contraria: que
        // fallaba el índice empaquetado y funcionaba lo que consulta en vivo.
        //
        // Y con el motivo literal: quince consultas seguidas devolvieron "no
        // respondió" sin decir si era el corte de 8 s del cliente, un HTTP de
        // error o el portal caído, que es justo lo que hay que comprobar.
        vig =
          `\nEstado de vigencia: la ficha de SUIN-Juriscol (www.suin-juriscol.gov.co) no respondió en esta ` +
          `consulta (${(e as Error).message}). Vuelve a intentarlo antes de afirmar nada; no es que esta norma ` +
          `carezca de estado. Que ` +
          `buscar_en_suin sí funcione no lo desmiente: esa herramienta consulta OTRO servidor (el índice de ` +
          `búsqueda), y no publica el estado de vigencia.`
      }
    }
  }

  let extra = ''
  if (c.articulo) {
    const norma = await gestor.obtenerNorma(n.id)
    const art = extraerArticulo(norma.texto, c.articulo)
    extra = art
      ? `\n\n--- Artículo ${c.articulo} ---\n${art}\n${advertenciasVigencia(art).join('\n')}`
      : `\n\nNo encontré un "artículo ${c.articulo}" en el texto. Usa obtener_documento con fuente="gestor" y buscar_en_texto.`
  }
  return (
    `### ${cita}${equivalencia}\n${n.titulo}\n${tipoCorregido}id: ${n.id}\n` +
    // No es un resumen de la norma: el Gestor no publica uno. Es el extracto
    // de UN tema al que está asociada, y en normas compiladoras como el
    // Decreto 1083 describe una porción mínima del contenido.
    (n.resumen
      ? `Extracto de un tema asociado (NO resume la norma; usa obtener_documento con fuente="gestor" para su objeto y articulado): ${n.resumen}\n`
      : '') +
    (esCompiladora(n.titulo, 0) ? '\nAVISO: esta es una norma compilada que incorpora reformas; para un tema concreto usa obtener_documento con fuente="gestor" y buscar_en_texto.\n' : '') +
    `URL: ${n.url}${avisoDominio}${vig}${extra}`
  )
}

// --- índice temático empaquetado -----------------------------------------

// --- servidor ------------------------------------------------------------

/**
 * Los tres catálogos temáticos del portal numeran cada uno por su cuenta, así
 * que el mismo entero existe en los tres queriendo decir cosas distintas: el
 * 38968 es «Teletrabajo durante jornada día sin carro» en listar_catalogos
 * (catalogo="subtemas") e «INHABILIDADES E INCOMPATIBILIDADES / Ex Diputados» en el de buscar_por_tema.
 * Advertirlo en las descripciones no bastaba: un id cruzado no fallaba, contestaba
 * por el subtema equivocado con el mismo aire de certeza. Con el prefijo pegado
 * al id, cruzarlos es un error explícito y no una respuesta creíble sobre otra cosa.
 */
const CATALOGOS = {
  ts: { de: 'buscar_por_tema', ejemplo: 'ts-38872' },
  sub: { de: 'listar_catalogos con catalogo="subtemas"', ejemplo: 'sub-38968' },
  tema: { de: 'listar_catalogos con catalogo="temas"', ejemplo: 'tema-24457' },
} as const
type Catalogo = keyof typeof CATALOGOS

const conPrefijo = (c: Catalogo, id: string | number): string => `${c}-${id}`

/** Radicados ya devueltos de la última búsqueda en el Consejo de Estado, con la página en que salieron. */
const memoriaCE: { clave: string; paginas: Map<string, number> } = { clave: '', paginas: new Map() }

/** Filtros que aceptan el nombre o el id: solo lo que parece un id pasa por la aduana. */
const idOnombre = (c: Catalogo, valor: string | undefined): string | undefined =>
  valor && /^([a-z]+-)?\d+$/i.test(valor.trim()) ? sinPrefijo(c, valor) : valor

/** Devuelve el número que entiende el portal, o explica de qué catálogo salió el id equivocado. */
function sinPrefijo(c: Catalogo, valor: string): string {
  const v = valor.trim()
  const propio = v.match(new RegExp(`^${c}-(\\d+)$`, 'i'))
  if (propio) return propio[1]!
  const ajeno = (Object.keys(CATALOGOS) as Catalogo[]).find((k) => new RegExp(`^${k}-\\d+$`, 'i').test(v))
  throw new Error(
    `"${valor}" no sirve aquí: este parámetro lleva un id de ${CATALOGOS[c].de}, que se escribe como ` +
      `"${CATALOGOS[c].ejemplo}". ` +
      (ajeno
        ? `El prefijo "${ajeno}-" lo emite ${CATALOGOS[ajeno].de}, que es OTRA taxonomía del portal: sus números ` +
          `coinciden con los de esta y significan otra cosa, así que antes esto respondía por el tema equivocado.`
        : `Los ids pelados no se aceptan justo para que no se puedan cruzar los tres catálogos temáticos del ` +
          `portal, que reutilizan los mismos números. Pide el id a ${CATALOGOS[c].de} y pégalo con su prefijo.`),
  )
}

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
- La pregunta menciona una norma concreta ("Ley 909 de 2004", "Decreto 1083", "C-337/11", "el art. 6 de la Ley 1221") o un CÓDIGO por su nombre ("el art. 191 del Código de Comercio", "el 83 del Código Penal") → resolver_cita. Es exacta; el buscador por palabras no. El único código que NO está en el corpus es el CIVIL: ante una consulta civil, dilo en vez de dar por buena una búsqueda vacía.
- Saber si una norma sigue vigente (estado con nivel de confianza) → consultar_vigencia. No lo afirmes por tu cuenta: si no consta, la herramienta lo dice y orienta.
- La pregunta es por materia ("¿qué normas hay sobre teletrabajo?") → buscar_por_tema. El buscador por palabras del portal solo indexa resúmenes y encuentra poquísimo: "teletrabajo" casa con 3 documentos cuando el subtema oficial tiene 55.
- Hay que saber qué dice una norma sobre algo → obtener_documento con fuente="gestor" y buscar_en_texto. Esa es la verdadera búsqueda de texto completo; el portal no la ofrece.
- Sentencias y autos → buscar_jurisprudencia (Corte Constitucional, al día). El Gestor casi no tiene jurisprudencia reciente.
- Normativa que el Gestor no tiene, o exploración por materia/sector del corpus histórico (desde 1844) → buscar_en_suin. NUNCA la uses para saber si algo está vigente: su campo de vigencia es del índice de búsqueda y contradice la ficha. La vigencia sale de resolver_cita.
- Impuestos, aduanas o cambios (retención, IVA, renta, importación) → buscar_normativa_tributaria y obtener_documento con fuente="dian". Ninguna otra herramienta cubre esa materia.
- Jurisprudencia de la Corte SUPREMA (casación civil, laboral, penal y sus tutelas) → buscar_jurisprudencia_suprema, y obtener_documento con fuente="suprema" para el texto completo con la ruta y la sala de esa misma búsqueda. Es un tribunal DISTINTO de la Corte Constitucional: no las mezcles. Exige indicar sala, y cada resultado trae las normas que cita, que puedes resolver con resolver_cita.
- Qué le pasó a una norma o a un artículo (quién lo modificó, adicionó o derogó) → historial_norma (cadena navegable de reformas) u obtener_documento con fuente="gestor" e historial=true. Devuelve las notas literales del portal, sin ordenarlas ni deducir cuál rige hoy.
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
- La vigencia solo existe para LEYES: el índice de SUIN cubre 11.585 leyes y casi ningún decreto, porque los sitemaps de decretos del portal devuelven 404. Que no aparezca para un decreto NO significa que esté derogado ni vigente: significa que no consta.
- La ÚNICA excepción: si resolver_cita devuelve un "Estado de vigencia según SUIN-Juriscol", cítalo con su fecha y su enlace, tal cual, sin traducirlo a un sí o un no ("Vigencia en Estudio" no es "vigente"). Si esa línea no aparece, es que no consta: vuelve a la regla anterior.
- Que una norma no esté en el Gestor NO significa que no exista: su corpus no cubre todo el país. Si resolver_cita responde que la norma está en SUIN-Juriscol y no en el Gestor, esa es una respuesta completa, no un fallo; para un artículo concreto vuelve a preguntar citándolo ("art. 3 de la Ley 1541 de 2012").
- El "extracto temático" que acompaña a cada resultado NO resume la norma: es el apunte de un tema al que está asociada. Para el objeto real usa obtener_documento con fuente="gestor".
- Si una herramienta devuelve vacío, es que no se encontró; no completes con conocimiento propio.
- Si resolver_cita responde que la cita es AMBIGUA, no escojas tú: el mismo número existe en varios años ("Decreto 1072" son cuatro decretos distintos). Pregunta el año o presenta los candidatos.
- Un documento sin texto NO es un documento que no diga nada. Si la respuesta avisa de que es un escaneo o de que el portal no publicó el texto, dilo así y remite al enlace; no concluyas nada sobre su contenido.
- Nunca inventes números de norma, artículos ni sentencias. Si no aparecen en una respuesta, no existen para efectos de esta conversación.
- Los ids temáticos vienen con prefijo y no son intercambiables: "ts-" de buscar_por_tema (va en explicar_relacion_tema), "sub-" de listar_catalogos con catalogo="subtemas" (va en buscar_normas) y "tema-" de listar_catalogos. Pégalos tal cual, con el prefijo: son tres numeraciones distintas del portal que reutilizan los mismos números.

Herramientas V2:
- Filtrar por rango de la jerarquía (leyes, decretos, conceptos, jurisprudencia) → consultar_por_jerarquia; la respuesta explica el carácter (vinculante/orientador/informativo).
- Comprobar que una cita y su enlace son de verdad → resolver_cita con validar=true. Clasifica en "validada", "parcialmente validada" o "no fue posible validar", y nunca afirma vigencia.
- Comparar dos normas o dos artículos → analizar_conflicto (reúne EVIDENCIA; no concluye) y comparar_articulos (diferencia por patrones; lo no clasificado se revisa a mano).
- Resumir qué le pasó a normas listadas desde una fecha → cambios_desde. NO descubre normas nuevas: solo lee lo que el Gestor anota.
- Consultar por sector preconfigurado → consultar_perfil (laboral, tributario, ambiental, contratación, energía); cada perfil declara su advertencia.
- Expedientes temporales (EXPEDIENTES=1): expediente con accion="crear|agregar|leer". Son memoria de sesión con expiración, no almacenamiento.
- Una consulta ambigua → el prompt aclarar-consulta hace las preguntas precisas antes de buscar.

Esto no es asesoría jurídica.`

const server = new McpServer({ name: 'normativa-colombia', version: VERSION }, { instructions: INSTRUCCIONES })

/**
 * Una línea JSON por llamada, SIEMPRE a stderr: stdout es el canal JSON-RPC y
 * escribir ahí rompe el protocolo. Los clientes MCP guardan el stderr del
 * servidor en su log, así que esto es lo único que permite saber después qué
 * herramienta se usa, cuánto tarda y cuál falla —el servidor no emitía nada, y
 * un fallo contra un portal era indistinguible de una consulta sin resultados.
 *
 * Se envuelve `registerTool` una vez en lugar de tocar veintiséis handlers.
 *
 * ponytail: sin muestreo ni niveles; una línea por llamada es despreciable
 * cuando cada llamada cuesta una petición de red. Si algún día molesta, se
 * apaga por variable de entorno, no se filtra por nivel.
 */
type Registrar = typeof server.registerTool
const registrarOriginal = server.registerTool.bind(server) as Registrar
server.registerTool = ((nombre: string, config: unknown, handler: (...a: unknown[]) => unknown) =>
  registrarOriginal(
    nombre as never,
    config as never,
    (async (...args: unknown[]) => {
      const t0 = performance.now()
      const anotar = (ok: boolean, error?: string) => {
        const red = redResumen()
        process.stderr.write(
          `${JSON.stringify({ ts: new Date().toISOString(), herramienta: nombre, ms: Math.round(performance.now() - t0), ok, peticiones: red.peticiones, bytes: red.bytes, ...(error ? { error } : {}) })}\n`,
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
      'Ruta rápida y exacta para citas como "Ley 909 de 2004", "Decreto 1083", "C-337/11", "T-099/24" o ' +
      '"artículo 6 de la Ley 1221 de 2008". Úsala SIEMPRE que la pregunta mencione una norma concreta: ' +
      'evita el buscador por palabras, que es impreciso. Los CÓDIGOS se citan por su nombre ("art. 191 del ' +
      'Código de Comercio", "art. 83 del Código Penal", "art. 164 del CPACA"): la respuesta dice contra qué ' +
      'norma se resolvió. Acepta también un LOTE de citas con el parámetro ' +
      'citas (["Ley 909 de 2004", "C-337/11"]), que resuelve cada una con su enlace en una sola llamada.',
    inputSchema: {
      cita: z
        .string()
        .optional()
        .describe('Ej.: "Ley 909 de 2004", "C-337/11", "art. 6 de la Ley 1221 de 2008", "art. 191 del Código de Comercio"'),
      citas: z
        .array(z.string())
        .optional()
        .describe('Varias citas a la vez, ej. ["Ley 909 de 2004", "C-337/11"]: cada una se resuelve y se devuelve con su enlace'),
      validar: z
        .boolean()
        .optional()
        .describe(
          'En vez de la resolución, comprueba que la cita (y el enlace, si se da con url) coincide con lo que ' +
            'devuelve el Gestor: número/año, dominio y artículo. Clasifica en "cita validada", "parcialmente ' +
            'validada" o "no fue posible validar". NUNCA afirma vigencia.',
        ),
      url: z.string().optional().describe('Enlace a comprobar (solo con validar=true)'),
    },
  },
  async ({ cita, citas, validar, url }) => {
    if (validar) {
      return txt(
        await validarCita.escribir({
          ...(cita !== undefined ? { cita } : {}),
          ...(citas !== undefined ? { citas } : {}),
          ...(url !== undefined ? { url } : {}),
        }),
      )
    }
    // Lote sin validación: cada cita se resuelve por la misma vía que una
    // cita individual, con su bloque propio. Un fallo de red de una cita se
    // anota en su bloque y no tumba a las demás.
    if (citas?.length) {
      const bloques: string[] = []
      for (const una of citas) {
        try {
          bloques.push(await resolverUnaCita(una))
        } catch (e) {
          bloques.push(
            `### ${una}\nLa fuente no respondió en esta consulta (${(e as Error).message}). ` +
              `Vuelve a intentarlo antes de afirmar nada.\nEnlace: (sin enlace)`,
          )
        }
      }
      return txt(bloques.join('\n\n'))
    }
    if (!cita) {
      return vacio(
        'una cita normativa',
        'Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11" (y varias a la vez con citas), o usa buscar_normas.',
      )
    }
    return txt(await resolverUnaCita(cita))
  },
)

server.registerTool(
  'buscar_normas',
  {
    title: 'Buscar normas en el Gestor Normativo',
    description:
      'Busca leyes, decretos, resoluciones, conceptos y sentencias del sector público colombiano. ' +
      'IMPORTANTE: el buscador del portal indexa solo los resúmenes temáticos, NO el articulado completo, ' +
      'y une los términos con OR. Usa pocas palabras y muy distintivas. Para buscar dentro del texto de una ' +
      'norma concreta, usa obtener_documento con fuente="gestor" y buscar_en_texto. Para una cita exacta, usa resolver_cita.',
    inputSchema: {
      palabras: z.string().optional().describe('Términos distintivos; evita frases largas'),
      tipo_documento: z.string().optional().describe('Nombre o id: "Ley", "Decreto", "Sentencia", "Concepto"'),
      numero: z.coerce.string().regex(/^\d+$/).optional().describe('Número de la norma, como texto. Ej.: "909"'),
      anio: z.coerce.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos, como texto. Ej.: "2004"'),
      entidad: z.string().optional().describe('Nombre o id: "Corte Constitucional", "Congreso de la República"'),
      tema: z.string().optional().describe('Nombre del tema, o su id de listar_catalogos con prefijo: "tema-24457"'),
      subtema: z.coerce
        .string()
        .optional()
        .describe('id de listar_catalogos con catalogo="subtemas" y prefijo ("sub-38968"), o su nombre si además indicas tema. El "ts-" de buscar_por_tema no vale aquí.'),
      limite: z.coerce.number().int().min(1).max(100).default(20),
    },
  },
  async ({ palabras, tipo_documento, numero, anio, entidad, tema: temaCrudo, subtema: subtemaCrudo, limite }) => {
    // Nombre o id: el id llega con prefijo, y uno pelado o de otro catálogo se
    // rechaza en vez de resolverse contra el tema equivocado.
    const tema = idOnombre('tema', temaCrudo)
    const subtema = idOnombre('sub', subtemaCrudo)
    // Idea 6 — normalización de entidades: un alias se resuelve al nombre que
    // el catálogo del Gestor entiende ("Mintrabajo" → "Ministerio del Trabajo").
    // Los que el Gestor NO cataloga ("dian") no se resuelven ni se inyectan: el
    // propio Gestor avisa "No reconocí entidad"; aquí solo se orienta hacia la
    // herramienta que sí cubre esa entidad.
    const ent = entidad ? normalizarEntidad(entidad) : null
    const claveEntidad = entidad ? sinTildes(entidad.trim().toLowerCase()) : ''
    const fueraDelGestor = NO_EN_GESTOR.has(claveEntidad)
    const r = await gestor.buscar({ palabras, tipo: tipo_documento, numero, anio, entidad: ent && !fueraDelGestor ? ent.oficial : entidad, tema, subtema })
    const notas = r.nota ? [r.nota] : []
    if (ent?.aliasUsado && !fueraDelGestor) {
      notas.push(`Entidad normalizada: «${ent.aliasUsado}» → «${ent.oficial}».`)
    } else if (fueraDelGestor) {
      notas.push(`Para normativa de «${entidad}» usa buscar_normativa_tributaria (no es un filtro del Gestor).`)
    }

    // El índice de palabras del portal es pobrísimo: "teletrabajo" solo casa con
    // 3 documentos en todo el corpus, y con ninguno de los 43 conceptos que sí
    // están clasificados bajo ese subtema. Cuando la búsqueda por palabras rinde
    // poco, se reintenta por la vía temática, que es la que de verdad encuentra.
    // El aviso sale SIEMPRE que se use la vía temática, aunque no añada
    // documentos nuevos: la lista final mezcla dos catálogos del portal.
    if (palabras && r.items.length < 5 && !subtema) {
      const par = temaDelIndice(palabras)
      if (par) {
        try {
          const sub = await gestor.subtemaPorNombre(par.t, par.s)
          if (sub) {
            const via = await gestor.buscar({ tipo: tipo_documento, numero, anio, entidad, subtema: sub })
            const vistos = new Set(r.items.map((i) => i.id))
            const extra = via.items.filter((i) => !vistos.has(i.id))
            if (via.items.length) {
              r.items.push(...extra)
              notas.push(
                `La búsqueda por palabras solo halló ${r.total}. Se reconsultó con el subtema "${normalizarRotulo(par.s)}" ` +
                  `(id ${conPrefijo('sub', sub)}) del catálogo de búsqueda${extra.length ? ` y se añadieron ${extra.length} documentos` : ', que ya estaban entre los de palabras'}. Ese catálogo y el de ` +
                  `buscar_por_tema son taxonomías distintas del portal, así que allí estos documentos pueden aparecer ` +
                  `bajo otro tema.`,
              )
            }
          }
        } catch {
          /* la vía temática es un refuerzo: si falla, quedan los de palabras */
        }
      }
    }

    if (!r.items.length) {
      // El filtro de entidad se resuelve bien y aun así devuelve cero, porque el
      // Gestor no cataloga por emisor: "Ley"+1993+"Congreso de la República"
      // (id 48) da 0, y el mismo par con "Nivel Nacional" (id 7) da 39, con la
      // Ley 100 de 1993 entre ellas. Un "no existe esa combinación" a secas
      // manda a dudar de la norma cuando el equivocado era el filtro.
      const porEntidad =
        entidad && !/nivel\s+nacional/i.test(entidad)
          ? ` AVISO SOBRE LA ENTIDAD: el Gestor clasifica la mayoría de la normativa nacional bajo la entidad` +
            ` "Nivel Nacional", no bajo quien la expidió; las leyes del Congreso aparecen así. Repite con` +
            ` entidad="Nivel Nacional" o sin entidad antes de concluir que la norma no existe.`
          : ''
      return vacio(
        'normas con esos filtros',
        `Filtros aplicados: ${r.aplicados.join(', ') || '(ninguno)'}.` +
          (r.nota ? ` ${r.nota}` : '') +
          porEntidad +
          ' Si los filtros se resolvieron bien, es que no existe esa combinación en el Gestor: prueba quitando el año' +
          ' o la entidad. Si buscaste por palabras, recuerda que el portal solo indexa los resúmenes temáticos:' +
          ' usa buscar_por_tema.',
      )
    }
    const mostrados = r.items.slice(0, limite)
    // El portal une los términos con OR: un resultado puede venir por un solo
    // término y leerse como igual de pertinente que otro que los trae todos.
    // Se marca por fila qué términos aparecen de verdad en su extracto.
    const pertinencia = palabras ? gestor.pertinenciaDe(mostrados, palabras) : undefined
    const lista = mostrados
      .map((i) => {
        const p = pertinencia?.get(i.id)
        const marca =
          p && p.omite.length && p.menciona.length
            ? `\n  Pertinencia: menciona ${p.menciona.map((t) => `"${t}"`).join(', ')}; NO menciona ${p.omite.map((t) => `"${t}"`).join(', ')} en su extracto (el portal une con OR).`
            : ''
        return `- ${i.titulo} (id ${i.id})\n  Extracto temático: ${i.resumen || '(ninguno)'}${marca}\n  ${i.url}`
      })
      .join('\n')
    const mas = r.items.length > limite ? `\n\nSe muestran ${limite} de ${r.items.length} reunidos.` : ''
    return txt(
      `${r.items.length} documento(s) reunido(s).${notas.length ? `\n${notas.join(' ')}` : ''}\n\n${lista}${mas}`,
    )
  },
)

server.registerTool(
  'buscar_por_tema',
  {
    title: 'Buscar por tema y subtema',
    description:
      'Consulta temática oficial: devuelve tema, subtema y las normas, sentencias y conceptos asociados. ' +
      'Resuelve contra un índice empaquetado (instantáneo, funciona aunque el portal esté caído). ' +
      'Cada resultado trae temsubid ("ts-38872") y normid para pedir después explicar_relacion_tema. ' +
      'El prefijo "ts-" es parte del id: pégalo tal cual. Marca de qué catálogo salió, porque el portal ' +
      'mantiene tres taxonomías que reutilizan los mismos números —"sub-" es de listar_catalogos y "tema-" de ' +
      'listar_catalogos—, y antes de los prefijos un id cruzado no fallaba: respondía por el tema equivocado.',
    inputSchema: {
      texto: z.string().describe('Tema a buscar, ej. "teletrabajo", "encargo", "prima de servicios"'),
      limite: z.coerce.number().int().min(1).max(50).default(15),
    },
  },
  async ({ texto, limite }) => {
    const idx = cargarIndice()
    const q = sinTildes(texto).toLowerCase().trim()

    if (idx) {
      const filas = idx.filas.filter(
        (f) => sinTildes(f.t).toLowerCase().includes(q) || sinTildes(f.s).toLowerCase().includes(q),
      )
      if (filas.length) {
        const salida = filas
          .slice(0, limite)
          .map(
            (f) =>
              `- ${normalizarRotulo(f.t)} / ${normalizarRotulo(f.s)} (temsubid ${conPrefijo('ts', f.ts)})\n` +
              f.n.slice(0, 8).map(([id, tit]) => `    · ${tit} (normid ${id})`).join('\n') +
              (f.n.length > 8 ? `\n    … y ${f.n.length - 8} más` : ''),
          )
          .join('\n')
        return txt(
          `${filas.length} tema(s)/subtema(s) coinciden con "${texto}".\n\n${salida}` +
            (filas.length > limite ? `\n\nSe muestran ${limite} de ${filas.length}.` : '') +
            frescura(idx.generado) +
            `\n\nÍndice generado el ${idx.generado}. ${DESCARGO}`,
        )
      }
    }

    const filas = await gestor.tematica(texto)
    if (!filas.length) return vacio(`temas relacionados con "${texto}"`, 'Prueba un término más general o usa buscar_normas.')
    const salida = filas
      .slice(0, limite)
      .map(
        (f) =>
          `- ${normalizarRotulo(f.tema)} / ${normalizarRotulo(f.subtema)} (temsubid ${conPrefijo('ts', f.temsubid)})\n` +
          f.documentos.slice(0, 8).map((d) => `    · ${d.titulo} (normid ${d.normid})`).join('\n'),
      )
      .join('\n')
    return txt(`${filas.length} resultado(s) para "${texto}".\n\n${salida}`)
  },
)

server.registerTool(
  'listar_catalogos',
  {
    title: 'Listar catálogos de búsqueda',
    description:
      'Valores válidos para los filtros de buscar_normas: tipos de documento (29), años, entidades (89) y temas (2.509). ' +
      'En temas el filtro es obligatorio por volumen, y sus ids salen con prefijo ("tema-24457") porque el portal ' +
      'tiene tres taxonomías temáticas que reutilizan los mismos números. ' +
      'También lista los subtemas de un tema (catalogo="subtemas" con tema_id), los conceptos de Función Pública ' +
      '(catalogo="conceptos_fp" con numero/anio) y el listado curado de normas de competencia del DAFP ' +
      '(catalogo="normas_fp"). ' +
      'OJO CON EL ALCANCE: estos catálogos son SOLO del Gestor Normativo de Función Pública y solo sirven en ' +
      'buscar_normas. No cubren la DIAN (que tiene su propio normograma, con buscar_normativa_tributaria), ni ' +
      'SUIN-Juriscol, ni las tres altas cortes. Que "DIAN" no aparezca en el catálogo de entidades no significa ' +
      'que no haya normativa de la DIAN: significa que el Gestor no la cataloga como entidad emisora.',
    inputSchema: {
      catalogo: z.enum(['tipos', 'anios', 'entidades', 'temas', 'subtemas', 'conceptos_fp', 'normas_fp']),
      filtro: z.string().optional().describe('Texto para filtrar; obligatorio en "temas"'),
      tema_id: z.string().optional().describe('Id del tema (solo catalogo="subtemas"), con prefijo "tema-…"'),
      numero: z.string().optional().describe('Número del concepto (solo catalogo="conceptos_fp")'),
      anio: z.string().optional().describe('Año del concepto (solo catalogo="conceptos_fp")'),
      desde: z.coerce.number().int().min(0).default(0),
      limite: z.coerce.number().int().min(1).max(200).default(50),
    },
  },
  async ({ catalogo, filtro, tema_id, numero, anio, desde, limite }) => {
    if (catalogo === 'temas' && !filtro) {
      return txt('El catálogo de temas tiene 2.509 entradas: indica un filtro de texto para acotarlo.')
    }
    // Catálogos propios del Gestor (tipos, años, entidades, temas).
    if (catalogo === 'tipos' || catalogo === 'anios' || catalogo === 'entidades' || catalogo === 'temas') {
      const c = await gestor.catalogos()
      const q = filtro ? sinTildes(filtro).toLowerCase() : ''
      const lista = c[catalogo].filter((o) => !q || sinTildes(o.nombre).toLowerCase().includes(q))
      if (!lista.length) return vacio(`entradas de "${catalogo}" que coincidan con "${filtro}"`, 'Prueba un filtro más corto.')
      return txt(
        `${lista.length} entrada(s) en ${catalogo}:\n` +
          lista
            .slice(0, limite)
            .map((o) => `- ${o.nombre} (id ${catalogo === 'temas' ? conPrefijo('tema', o.id) : o.id})`)
            .join('\n') +
          (lista.length > limite ? `\n… y ${lista.length - limite} más.` : ''),
      )
    }
    // Subtemas de un tema del catálogo de búsqueda.
    if (catalogo === 'subtemas') {
      if (!tema_id) return txt('Para catalogo="subtemas" hace falta tema_id (con prefijo "tema-…").')
      const tema = sinPrefijo('tema', tema_id)
      const s = await gestor.subtemas(tema)
      if (!s.length) return vacio(`subtemas para el tema ${tema_id}`, 'Verifica el id con catalogo="temas".')
      return txt(s.map((o) => `- ${o.nombre} (id ${conPrefijo('sub', o.id)})`).join('\n'))
    }
    // Conceptos de Función Pública (solo número/año; sin materia).
    if (catalogo === 'conceptos_fp') {
      if (!numero && !anio) {
        throw new Error(
          'Para catalogo="conceptos_fp" indica al menos numero o anio: el listado solo trae número y año de cada ' +
            'concepto, sin el asunto. Para conceptos SOBRE UN TEMA usa buscar_normas con tipo_documento "Concepto".',
        )
      }
      const r = await gestor.conceptosFp(numero, anio, limite, desde)
      if (!r.total) return vacio('conceptos con ese número o año', 'Recuerda que este listado solo filtra por número y año.')
      if (!r.items.length) {
        return vacio(`conceptos a partir de la posición ${desde}`, `El filtro reúne ${r.total} concepto(s); pide un "desde" menor.`)
      }
      const fin = desde + r.items.length
      return txt(
        `${r.total} concepto(s) coinciden; se muestran ${desde + 1}–${fin}.\n\n` +
          r.items.map((c) => `- ${c.titulo} (id ${c.id})\n  ${c.url}`).join('\n') +
          (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : ''),
      )
    }
    // Listado curado de normas de competencia del DAFP.
    const todas = await gestor.normasFp()
    const q = filtro ? sinTildes(filtro).toLowerCase() : ''
    const items = todas.filter((i) => !q || sinTildes(`${i.titulo} ${i.resumen}`).toLowerCase().includes(q))
    if (!items.length) return vacio(`normativa de competencia del DAFP que coincida con "${filtro}"`, 'Prueba sin filtro para ver el listado completo.')
    const tramo = items.slice(desde, desde + limite)
    if (!tramo.length) {
      return vacio(`normativa a partir de la posición ${desde}`, `El listado reúne ${items.length} norma(s); pide un "desde" menor.`)
    }
    const fin = desde + tramo.length
    return txt(
      `${items.length} de ${todas.length} norma(s) del listado; se muestran ${desde + 1}–${fin}.\n\n` +
        tramo
          .map((i) => `- ${i.titulo} (id ${i.id})\n  Extracto temático: ${i.resumen || '(ninguno)'}\n  ${i.url}`)
          .join('\n') +
        (fin < items.length ? `\n\nQuedan ${items.length - fin}: repite con desde=${fin}.` : ''),
    )
  },
)

server.registerTool(
  'buscar_jurisprudencia',
  {
    title: 'Buscar jurisprudencia de la Corte Constitucional',
    description:
      'Busca sentencias y autos en la relatoría de la Corte Constitucional (44.839 providencias según su ' +
      'propio índice, con fallos de 2026 publicados el mismo año). Es la herramienta indicada para jurisprudencia constitucional reciente: el ' +
      'Gestor Normativo tiene muy poca. Devuelve sentencia, tipo, fecha, síntesis y la ruta para ' +
      'obtener_documento con fuente="corte". La relatoría no indexa frases largas: con varias palabras se reintenta con la ' +
      'más distintiva y la respuesta lo anuncia ("se buscó con el núcleo «X»"). Es de la CORTE ' +
      'CONSTITUCIONAL, no de la Suprema ni del Consejo de Estado: para esos tribunales usa ' +
      'buscar_jurisprudencia_suprema o buscar_jurisprudencia_consejo_estado.',
    inputSchema: {
      termino: z.string().describe('Obligatorio. Términos a buscar en la relatoría, ej. "teletrabajo"'),
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha inicial AAAA-MM-DD (por defecto 1992-01-01)'),
      hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha final AAAA-MM-DD'),
      tipos: z
        .array(z.enum(['C', 'T', 'SU', 'A']))
        .optional()
        .describe(
          'Tipos a incluir. Por defecto C, T y SU (doctrina). Los autos (A) son mayoría por volumen y suelen ' +
            'ser trámite, así que hay que pedirlos explícitamente: ["A"] o ["C","T","SU","A"].',
        ),
      limite: z.coerce.number().int().min(1).max(100).default(10).describe('Cuántas providencias mostrar (hasta 100)'),
    },
  },
  async ({ termino, desde, hasta, tipos, limite }) => {
    const porDefecto: ('C' | 'T' | 'SU')[] = ['C', 'T', 'SU']
    // Idea 5 — si el término rinde poco, se prueba sin tildes y con sinónimo,
    // y la variante usada se anuncia en la respuesta.
    const { items, variantesUsadas, resultado } = await conAlternativas(
      (t) => corte.buscar({ termino: t, desde, hasta, tipos: tipos ?? porDefecto, limite }),
      termino,
      1,
      (r) => r.items,
    )
    // La relatoría no indexa frases largas: si la consulta extensa no rindió,
    // el núcleo devuelve resultados reales. Se anuncia como el resto de variantes.
    const nucleo = resultado?.nucleo
    const r = { items, total: items.length, nota: undefined }
    const avisoAlternativa = variantesUsadas.length
      ? `La búsqueda exacta de "${termino}" no rindió resultados; se usó «${variantesUsadas[0]}». ` +
        `Verifica que sea lo que buscabas.\n\n`
      : nucleo && nucleo !== termino
        ? `La relatoría no indexa la frase completa; se buscó con el núcleo «${nucleo}». Verifica que sea lo que buscabas.\n\n`
        : ''
    if (!r.items.length) return vacio(`providencias sobre "${termino}"`, 'Prueba un término más general o revisa el rango de fechas.')
    // La pertinencia se mide contra lo que REALMENTE se buscó: si la relatoría
    // no indexó la frase y se usó el núcleo, es el núcleo el que debe aparecer
    // en tema/síntesis, no la frase completa (que nadie buscó como tal).
    const aguja = sinTildes(nucleo ?? termino).toLowerCase()
    const menciona = (p: (typeof r.items)[number]) =>
      sinTildes(`${p.tema} ${p.sintesis} ${p.sentencia}`).toLowerCase().includes(aguja)
    const flojas = r.items.filter((p) => !menciona(p)).map((p) => p.sentencia)
    const lista = r.items
      .map(
        (p) =>
          `- ${p.sentencia} (${p.tipo}, ${p.fecha})${menciona(p) ? '' : '  ⚠ no menciona el término'}\n  ${p.tema || '(sin tema)'}\n` +
          (p.sintesis ? `  Síntesis: ${p.sintesis.slice(0, 300)}${p.sintesis.length > 300 ? '…' : ''}\n` : '') +
          `  ruta: ${p.ruta}\n  ${p.url}`,
      )
      .join('\n')
    // La causa que se sugiere tiene que corresponder a lo que realmente se pidió:
    // culpar al filtro de fechas cuando no se envió ninguno manda a quien
    // consulta a quitar algo que no puso.
    const porFechas = Boolean(desde || hasta)
    const aviso = flojas.length
      ? `\n\nAtención: ${flojas.join(', ')} no mencionan "${nucleo ?? termino}" en su tema ni en su síntesis. ` +
        (porFechas
          ? `El buscador de la relatoría pierde precisión al acotar por fechas: prueba sin desde/hasta.`
          : `El buscador de la relatoría indexa el texto completo, así que devuelve providencias donde el término ` +
            `aparece de pasada. Prueba un término más específico${tipos?.length === 1 && tipos[0] === 'A' ? ', o sin restringir a autos, que suelen ser de trámite' : ''}.`)
      : ''
    return txt(
      `${avisoAlternativa}${r.total} providencia(s) coinciden; se muestran ${r.items.length}.\n\n${lista}${aviso}\n\n` +
        `Para el texto completo usa obtener_documento con fuente="corte" y la ruta.`,
    )
  },
)

server.registerTool(
  'buscar_normativa_tributaria',
  {
    title: 'Buscar normativa tributaria, aduanera y cambiaria (DIAN)',
    description:
      'Busca en el normograma de la DIAN: decretos, resoluciones, conceptos y circulares en materia tributaria, ' +
      'aduanera y cambiaria. Es lo que ninguna otra herramienta de este MCP cubre. Devuelve el extracto donde ' +
      'aparece el término y el enlace al texto completo. Para leer el documento usa obtener_documento con fuente="dian". ' +
      'AVISO: la primera búsqueda de cada término tarda ~20 s porque el portal devuelve el resultado completo y no ' +
      'admite tope; las páginas siguientes del MISMO término son instantáneas, así que pagina con desde en vez de ' +
      'lanzar búsquedas nuevas.',
    inputSchema: {
      texto: z.string().describe('Términos a buscar, ej. "retención en la fuente", "declaración de importación"'),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar'),
      limite: z.coerce.number().int().min(1).max(50).default(15),
    },
  },
  async ({ texto, desde, limite }) => {
    const r = await dian.buscar(texto, limite, desde)
    if (!r.total) {
      return vacio(`normativa de la DIAN sobre "${texto}"`, 'Prueba con menos palabras o con el término técnico exacto.')
    }
    const items = r.items
    if (!items.length) return vacio(`resultados a partir de la posición ${desde}`, `La búsqueda reúne ${r.total}; pide un "desde" menor.`)
    const fin = desde + items.length
    const cacheNota = r.obsoleta
      ? '\n(red caída: se sirvió la caché vencida de esta búsqueda, rotulada como obsoleta)'
      : r.caducada
        ? '\n(la caché de este término había vencido y se refrescó)'
        : r.deCache
          ? '\n(de caché, dentro de los últimos 30 minutos)'
          : ''
    return txt(
      `${r.total} documento(s) en el normograma de la DIAN; se muestran ${desde + 1}–${fin}.${cacheNota}\n\n` +
        items
          .map(
            (d) =>
              `- ${d.nombre}${d.tipo ? ` (${d.tipo}${d.anio ? `, ${d.anio}` : ''})` : ''}\n` +
              `  ${d.epigrafe || '(sin epígrafe)'}\n` +
              (d.entidad ? `  Entidad: ${d.entidad}\n` : '') +
              (d.extracto ? `  «…${d.extracto.slice(0, 240)}…»\n` : '') +
              `  link para obtener_documento con fuente="dian": ${d.link}`,
          )
          .join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : ''),
    )
  },
)

server.registerTool(
  'buscar_jurisprudencia_suprema',
  {
    title: 'Buscar jurisprudencia de la Corte Suprema de Justicia',
    description:
      'Busca providencias de la Corte Suprema por sala: Tutelas, Civil, Laboral o Penal, desde 1991. Complementa a ' +
      'buscar_jurisprudencia, que es de la Corte CONSTITUCIONAL: son tribunales distintos. Cada resultado trae las ' +
      'NORMAS QUE CITA, que puedes resolver después con resolver_cita, y una RUTA con la que obtener_documento con fuente="suprema" ' +
      'devuelve el texto completo. ' +
      'CÓMO BUSCA: sobre el texto completo de la providencia y sin descartar palabras comunes, así que "de" solo ' +
      'devuelve 69.454 resultados. Por eso busca la FRASE EXACTA por defecto; usa términos distintivos.',
    inputSchema: {
      texto: z.string().describe('Términos a buscar, ej. "despido sin justa causa"'),
      sala: z.enum(suprema.SALAS).default('Tutelas').describe('Sala de la Corte. Obligatoria: sin ella el buscador no responde.'),
      anio: z.string().regex(/^\d{4}$/).optional().describe('Año de cuatro dígitos'),
      magistrado: z.string().optional().describe('Nombre del magistrado ponente'),
      exacto: z
        .boolean()
        .default(true)
        .describe(
          'Buscar la frase exacta; viene activado. Con exacto=false el buscador une las palabras con OR y ' +
            '"despido sin justa causa" devuelve 176.012 providencias contra 20.233 con la frase: en la sala Penal ' +
            'ese modo llega a 33.607 resultados y es inservible. Ponlo en false solo para ampliar a propósito una ' +
            'búsqueda que quedó corta.',
        ),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántas saltarse antes de empezar'),
      limite: z.coerce
        .number()
        .int()
        .min(1)
        .max(10)
        .default(10)
        .describe('Cuántas mostrar. El buscador entrega páginas de 10 como máximo; para ver más, usa desde.'),
    },
  },
  async ({ texto, sala, anio, magistrado, exacto, desde, limite }) => {
    let r = await suprema.buscar({ texto, sala, anio, magistrado, exacto, desde, limite })

    // Escalera de precisión: la frase exacta primero y, solo si no devuelve
    // nada, se amplía a OR — y se dice que se amplió. Sin esto, poner exacto
    // por defecto convierte "no existe esa frase" en "no hay nada sobre esto",
    // que son cosas distintas y la segunda es falsa.
    let ampliada = false
    if (!r.items.length && exacto && texto.trim().split(/\s+/).length > 1) {
      r = await suprema.buscar({ texto, sala, anio, magistrado, exacto: false, desde, limite })
      ampliada = r.items.length > 0
    }

    if (!r.items.length) {
      return vacio(
        `providencias de la sala ${sala} sobre "${texto}"`,
        (exacto ? 'Se buscó la frase exacta y también, al no haber nada, uniendo las palabras con OR. ' : '') +
          'Prueba otra sala (Tutelas, Civil, Laboral, Penal), un término más general o quita el año.',
      )
    }
    const fin = desde + r.items.length
    // El backend cuenta con OR entre las palabras sueltas, así que su total se
    // acerca al tamaño del corpus de la sala, no a los resultados pertinentes.
    // Darlo como "coinciden" hace creer que hay una precisión que no existe.
    const recuento = r.exacto
      ? `${r.total} providencia(s) contienen la frase exacta`
      : `~${r.total} providencia(s) con alguna de las palabras (el buscador las une con OR, así que este número ` +
        `NO mide pertinencia; repite con exacto=true para contar la frase)`
    // El índice repite el mismo fallo por cada archivo (.docx, .pdf, grafías
    // distintas del ponente). Callarlo haría creer que "quedan N" son N
    // documentos nuevos, cuando buena parte son copias.
    const repetidas =
      r.brutos > r.items.length
        ? `\n\nEsta página del buscador traía ${r.brutos} entradas y solo ${r.items.length} providencia(s) distintas: ` +
          `su índice guarda una entrada por ARCHIVO (.docx y .pdf, y a veces el ponente escrito de dos formas). ` +
          `Por eso avanzar con desde rinde menos documentos nuevos de lo que sugiere el total.`
        : ''
    // Una búsqueda ampliada no puede presentarse como si fuera la que se pidió.
    const aviso = ampliada
      ? `AVISO: la frase exacta "${texto}" no aparece en ninguna providencia de esta sala. Lo que sigue es una ` +
        `búsqueda AMPLIADA, con las palabras unidas por OR, así que puede incluir providencias que solo comparten ` +
        `alguna palabra suelta. Verifica la pertinencia de cada una antes de citarla.\n\n`
      : ''
    return txt(
      `${aviso}${recuento}, sala ${sala}; se muestran ${desde + 1}–${fin}.${repetidas}\n\n` +
        r.items
          .map(
            (p) =>
              `- ${p.titulo} (${p.clase || 'providencia'}, ${p.fecha})\n` +
              (p.magistrado ? `  Ponente: ${p.magistrado}\n` : '') +
              (p.normasCitadas.length
                ? `  Normas citadas (resolubles con resolver_cita): ${p.normasCitadas.slice(0, 8).join(' · ')}` +
                  (p.normasCitadas.length > 8 ? ` … y ${p.normasCitadas.length - 8} más` : '') +
                  '\n'
                : '  (no declara normas citadas)\n') +
              `  Texto completo: obtener_documento con fuente="suprema" y sala="${sala}" y ruta="${p.ruta}"`,
          )
          .join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : ''),
    )
  },
)

server.registerTool(
  'buscar_jurisprudencia_consejo_estado',
  {
    title: 'Buscar jurisprudencia del Consejo de Estado',
    description:
      'Busca providencias tituladas del Consejo de Estado, el tribunal supremo de lo contencioso administrativo: ' +
      'nulidad y restablecimiento, contratación estatal, nulidad electoral, reparación directa y conceptos de la ' +
      'Sala de Consulta. Es un tribunal DISTINTO de la Corte Constitucional y de la Corte Suprema. Cada resultado ' +
      'trae el problema jurídico que la Sala se planteó y su respuesta, que es lo que de verdad sirve para ' +
      'orientarse. No devuelve el texto completo, pero sí el enlace a la ficha del proceso en SAMAI. ' +
      'CÓMO BUSCA: une los términos con OR por defecto, así que el número de páginas mide el tamaño del corpus, no la ' +
      'pertinencia. Con exacto=true (viene activado) busca la FRASE EXACTA: el número de páginas sí mide la frase, ' +
      'y si no aparece se amplía solo a OR avisándolo. Usa términos distintivos y avanza con pagina.',
    inputSchema: {
      texto: z.string().describe('Términos a buscar, ej. "nulidad electoral", "liquidación del contrato"'),
      exacto: z
        .boolean()
        .default(true)
        .describe(
          'Buscar la frase exacta (entre comillas en el buscador SAMAI). Viene activado; si la frase no aparece en ' +
            'la página, se amplía solo a OR con un aviso. Ponlo en false para ampliar a propósito.',
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

server.registerTool(
  'buscar_en_suin',
  {
    title: 'Buscar en SUIN-Juriscol',
    description:
      'Busca en los 56.832 documentos de SUIN-Juriscol (MinJusticia) por título, epígrafe, materia o entidad ' +
      'emisora. Cubre leyes, decretos y resoluciones desde 1844, incluidos documentos que el Gestor Normativo no ' +
      'tiene. NO busca dentro del articulado y NO sirve para citas exactas ("LEY 909 DE 2004" no devuelve nada): ' +
      'para una cita usa resolver_cita. El campo de vigencia que devuelve es el del buscador y NO es fiable: ' +
      'contradice la ficha del propio documento; para el estado real usa resolver_cita. ' +
      'SU ÍNDICE TIENE HUECOS: "Teletrabajo" devuelve cero pese a estar en el título de la Ley 1221 de 2008, y una ' +
      'frase larga empareja por sus palabras comunes y devuelve resultados sin relación. Si buscas por materia y ' +
      'no aparece lo esperado, NO concluyas que no existe: prueba buscar_por_tema o resolver_cita.',
    inputSchema: {
      texto: z.string().describe('Palabras del título, epígrafe o materia. Ej.: "servicio militar", "Buenaventura"'),
      vigencia: z
        .enum(['Vigente', 'Vigencia en Estudio', 'Compilado', 'Derogado', 'No vigente', 'Declarado Inexequible', 'Sustituido'])
        .optional()
        .describe('Filtra por el estado que declara el BUSCADOR, que no siempre coincide con la ficha'),
      sector: z.string().optional().describe('Sector administrativo, ej. "Hacienda y Crédito Público"'),
      desde: z.coerce.number().int().min(0).default(0).describe('Cuántos saltarse antes de empezar'),
      limite: z.coerce.number().int().min(1).max(50).default(15),
    },
  },
  async ({ texto, vigencia, sector, desde, limite }) => {
    // Idea 5 — si la búsqueda rinde cero, se prueba el sinónimo del tesauro y
    // se anuncia: el índice de SUIN tiene huecos conocidos ("Teletrabajo" da 0
    // pese a existir la Ley 1221 de 2008), así que el vacío no es palabra final.
    const { items, variantesUsadas } = await conAlternativas(
      (t) => suin.buscar({ texto: t, vigencia, sector, desde, limite }).then((r) => r.items),
      texto,
      1,
    )
    const r = { items, total: items.length }
    const avisoAlternativa = variantesUsadas.length
      ? `La búsqueda de "${texto}" no rindió resultados; se usó «${variantesUsadas[0]}». Si no es lo que buscabas, ` +
        `no concluyas que el documento no existe: el índice de SUIN tiene huecos.\n\n`
      : ''
    if (!r.total) {
      return vacio(
        `documentos en SUIN para "${texto}"`,
        'El buscador de SUIN solo indexa título, epígrafe, materia y entidad: no busca dentro del articulado, y las ' +
          'citas exactas no funcionan ahí. Para una norma concreta usa resolver_cita.',
      )
    }
    if (!r.items.length) {
      return vacio(`documentos a partir de la posición ${desde}`, `La búsqueda reúne ${r.total}; pide un "desde" menor.`)
    }
    const fin = desde + r.items.length
    return txt(
      `${avisoAlternativa}${r.total} documento(s) en SUIN-Juriscol; se muestran ${desde + 1}–${fin}.\n\n` +
        r.items
          .map(
            (d) =>
              `- ${d.titulo} (${d.subtipo})\n  ${d.epigrafe || '(sin epígrafe)'}\n` +
              `  Vigencia SEGÚN EL BUSCADOR: ${d.vigencia || '(sin dato)'}\n  ${d.url}`,
          )
          .join('\n') +
        (fin < r.total ? `\n\nQuedan ${r.total - fin}: repite con desde=${fin}.` : '') +
        `\n\nATENCIÓN: la vigencia de esta lista es la del índice de búsqueda y contradice la ficha del documento ` +
        `(la Ley 74 de 1923 figura aquí como "Vigencia en Estudio" y su ficha dice DEROGADO). Para el estado real ` +
        `de una norma, pídela por su cita con resolver_cita. Ese camino tiene un tope, y este ejemplo lo enseña: ` +
        `resolver_cita solo alcanza lo que estén el Gestor Normativo o el índice de leyes de SUIN, y la Ley 74 de ` +
        `1923 no está en ninguno, así que responderá que no la encuentra. Cuando pase eso, el único estado fiable ` +
        `es el de la ficha del documento, en el enlace de arriba.`,
    )
  },
)

server.registerTool(
  'explicar_relacion_tema',
  {
    title: 'Explicar por qué una norma aplica a un subtema',
    description:
      'Devuelve el "restrictor": el extracto que explica por qué esa norma es pertinente para ESE subtema en ' +
      'concreto. Ambos identificadores deben salir de la MISMA fila de buscar_por_tema, y el temsubid va con su ' +
      'prefijo ("ts-38872"): un id de listar_catalogos (catalogo="subtemas") o de otros catálogos se rechaza aquí. Para ver todos los ' +
      'restrictores de una norma de una vez, usa obtener_documento con fuente="gestor" y mira su bloque "Temas asociados".',
    inputSchema: {
      temsubid: z.coerce.string().describe('temsubid de buscar_por_tema, con su prefijo: "ts-38872"'),
      normid: z.coerce.string().regex(/^\d+$/).describe('normid de la misma fila de buscar_por_tema'),
    },
  },
  async ({ temsubid: temsubidCrudo, normid }) => {
    const temsubid = sinPrefijo('ts', temsubidCrudo)
    // Se recupera el par del índice para poder decir a qué tema corresponde:
    // sin eso el usuario no puede verificar que la respuesta sea la que pidió.
    const fila = cargarIndice()?.filas.find((f) => f.ts === temsubid)
    const rotulo = fila ? `${normalizarRotulo(fila.t)} / ${normalizarRotulo(fila.s)}` : '(subtema no encontrado en el índice)'
    const enElIndice = fila?.n.some(([id]) => id === normid) ?? false

    const r = await gestor.restrictor(temsubid, normid)
    if (!r) {
      return vacio(
        `un restrictor para la norma ${normid} bajo "${rotulo}"`,
        enElIndice
          ? 'El índice sí relaciona esa norma con ese subtema, pero el portal no publica el extracto. Usa obtener_documento con fuente="gestor" para ver los restrictores que sí tiene.'
          : 'Esa norma no está clasificada bajo ese subtema. Verifica que temsubid y normid vengan de la misma ' +
            'fila de buscar_por_tema; si el rótulo de arriba no es el subtema que buscabas, el id es de otra fila.',
      )
    }
    return txt(
      `Tema / subtema: ${rotulo} (temsubid ${conPrefijo('ts', temsubid)})\nNorma: ${normid}\n\n` +
        `Por qué aplica:\n${r}\n\n` +
        `Norma completa: https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=${normid}\n` +
        `Este es el restrictor de ESTE subtema; la norma puede tener otros distintos bajo otros temas (obtener_documento con fuente="gestor" los lista todos).`,
    )
  },
)

// --- reguladores sectoriales --------------------------------------------

server.registerTool(
  'buscar_normativa_anh',
  {
    title: 'Buscar normativa de la ANH (hidrocarburos)',
    description:
      'Busca las resoluciones, acuerdos y circulares de la Agencia Nacional de Hidrocarburos: contratos de ' +
      'exploración y producción, regalías, derechos económicos, fiscalización y reservas (785 documentos). ' +
      'ÚSALA para la regulación de hidrocarburos y regalías; NO devuelve el texto (la ANH publica en PDF): ' +
      'se entrega el epígrafe completo y el enlace al PDF y a la ficha. NO sirve para leyes o decretos ' +
      'nacionales de cualquier sector: para esos usa resolver_cita o buscar_normas. ' +
      'Por defecto OCULTA los actos de personal (nombramientos y encargos), que son dos de cada tres; ' +
      'pídelos con incluir_administrativos=true si de verdad los buscas.',
    inputSchema: {
      texto: z.string().optional().describe('Palabra clave, ej. "regalías", "fiscalización"'),
      tipo: z.enum(Object.keys(anh.TIPOS) as [anh.TipoAnh, ...anh.TipoAnh[]]).optional(),
      numero: z.coerce.string().regex(/^\d+$/).optional().describe('Número del acto, como texto'),
      desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha inicial AAAA-MM-DD'),
      hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Fecha final AAAA-MM-DD'),
      pagina: z.coerce.number().int().min(1).max(40).default(1).describe('Página de 20; hay 40 en total sin filtros'),
      incluir_administrativos: z
        .boolean()
        .default(false)
        .describe('Incluir nombramientos, encargos y demás actos de personal. Por defecto se ocultan.'),
    },
  },
  async ({ texto, tipo, numero, desde, hasta, pagina, incluir_administrativos }) => {
    const r = await anh.buscar({ texto, tipo, numero, desde, hasta, pagina })
    const ocultos = incluir_administrativos ? [] : r.items.filter((d) => anh.ES_ADMINISTRATIVO(d.categoria))
    const items = incluir_administrativos ? r.items : r.items.filter((d) => !anh.ES_ADMINISTRATIVO(d.categoria))

    if (!items.length) {
      return vacio(
        `normativa de la ANH en la página ${r.pagina}`,
        ocultos.length
          ? `Las ${ocultos.length} de esta página son actos de personal y se ocultaron; pide incluir_administrativos=true para verlos, o avanza de página.`
          : 'Prueba otra página, otro tipo o quita los filtros.',
      )
    }
    return txt(
      `${items.length} documento(s) de la ANH en la página ${r.pagina}` +
        (ocultos.length ? ` (se ocultaron ${ocultos.length} actos de personal)` : '') +
        `.\n\n` +
        items
          .map(
            (d) =>
              `- ${d.tipo} ${d.numero} (${d.fecha})${d.categoria ? ` — ${d.categoria}` : ''}\n` +
              `  ${d.epigrafe || '(sin epígrafe)'}\n` +
              (d.urlPdf ? `  PDF: ${d.urlPdf}\n` : '') +
              `  Ficha: ${d.urlFicha}`,
          )
          .join('\n') +
        `\n\nEl texto completo no se puede leer aquí: la ANH publica en PDF y esta extensión no extrae su texto. ` +
        `El epígrafe de arriba es el del propio portal, citable tal cual.`,
    )
  },
)

server.registerTool(
  'buscar_normativa_upme',
  {
    title: 'Buscar circulares y resoluciones de la UPME',
    description:
      'Circulares y resoluciones de la Unidad de Planeación Minero Energética: convocatorias de transmisión y de ' +
      'gas, planes de expansión y actos administrativos. NO devuelve el texto: son PDF. ' +
      'OJO CON LAS FECHAS: la fecha que publica su portal es la de PUBLICACIÓN EN LA WEB, no la de la norma — la ' +
      '"Resolución 1163 de 2024" figura publicada en 2025. El número y el año reales están en el título.',
    inputSchema: {
      texto: z.string().optional().describe('Términos a buscar, ej. "transmisión", "plan de expansión"'),
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(50).default(10),
      incluir_administrativos: z
        .boolean()
        .default(false)
        .describe('Incluir nombramientos y demás actos de personal. Por defecto se ocultan.'),
    },
  },
  async ({ texto, pagina, limite, incluir_administrativos }) => {
    const r = await upme.buscar({ texto, pagina, limite })
    const ocultos = incluir_administrativos ? [] : r.items.filter((d) => upme.esActoDePersonal(d.epigrafe))
    const items = incluir_administrativos ? r.items : r.items.filter((d) => !upme.esActoDePersonal(d.epigrafe))

    if (!items.length) {
      return vacio(
        `circulares o resoluciones de la UPME${texto ? ` sobre "${texto}"` : ''}`,
        ocultos.length
          ? `Las ${ocultos.length} de esta página son actos de personal y se ocultaron; usa incluir_administrativos=true.`
          : r.procedencia === 'portal'
            ? `El buscador del portal no devolvió resultados para "${texto}" en el HTML de ?q= (ni el REST). Prueba un término más general.`
            : `El buscador de la UPME es el de WordPress y solo indexa el título y el resumen. Prueba un término más general.`,
      )
    }
    return txt(
      `${r.total} documento(s) en la UPME (${r.paginas} página(s)); se muestran ${items.length} de la página ${pagina}` +
        (ocultos.length ? `, ocultando ${ocultos.length} acto(s) de personal` : '') +
        (r.procedencia === 'portal'
          ? '\nResultados del buscador del portal (indexa el contenido de los PDF), no del REST.'
          : '') +
        `.\n\n` +
        items
          .map(
            (d) =>
              `- ${d.titulo}${d.anio ? '' : ' (el título no trae año)'}\n` +
              `  ${d.epigrafe || '(sin resumen)'}\n` +
              `  Publicado en el portal: ${d.publicado} — NO es la fecha de la norma\n` +
              `  PDF: ${d.url}`,
          )
          .join('\n') +
        (pagina < r.paginas ? `\n\nHay más: repite con pagina=${pagina + 1}.` : ''),
    )
  },
)

server.registerTool(
  'buscar_resoluciones_creg',
  {
    title: 'Buscar resoluciones de la CREG (energía y gas)',
    description:
      'Busca las resoluciones de la Comisión de Regulación de Energía y Gas, donde vive la regulación operativa ' +
      'del sector: tarifas, conexión, comercialización, plantas solares y gas natural. ' +
      'ÚSALA para la regulación energética y de gas. Es la ÚNICA fuente sectorial cuyo texto se puede leer aquí ' +
      '(usa obtener_documento con fuente="creg" con la ruta) y la única que publica una señal de vigencia: la CREG mantiene ' +
      'compilaciones separadas de resoluciones no derogadas y derogadas. Esa señal se traslada literal; no la ' +
      'conviertas en un sí o un no. NO sirve para leyes o decretos nacionales de otros sectores: para esos usa ' +
      'resolver_cita o buscar_normas.',
    inputSchema: {
      texto: z.string().optional().describe('Filtra por número, año o epígrafe. Ej.: "solar", "gas natural", "101-104"'),
      compilacion: z
        .enum(['vigentes', 'derogadas', 'todas'])
        .default('vigentes')
        .describe('"vigentes" = las que la CREG lista como no derogadas expresamente ni anuladas'),
      anio: z
        .string()
        .regex(/^\d{4}$/)
        .optional()
        .describe('Año de cuatro dígitos, desde 1994. SIN ÉL solo se mira el año en curso, que trae muy pocas.'),
      limite: z.coerce.number().int().min(1).max(50).default(15).describe('Cuántas resoluciones mostrar (hasta 50)'),
    },
  },
  async ({ texto, compilacion, anio, limite }) => {
    const r = await creg.buscar(compilacion, texto, limite, anio)
    if (!r.items.length) {
      return vacio(
        `resoluciones de la CREG${texto ? ` que coincidan con "${texto}"` : ''} en la compilación "${compilacion}"` +
          ` del año ${anio ?? new Date().getFullYear()}`,
        'La CREG publica una compilación POR AÑO y sin el parámetro anio solo se mira el año en curso, que apenas ' +
          'trae unas decenas. Repite indicando el año (desde 1994). La búsqueda es sobre número, año y epígrafe: ' +
          'la CREG no ofrece búsqueda dentro del texto.',
      )
    }
    return txt(
      `${r.total} resolución(es) en la compilación "${compilacion}" de la CREG (${r.pagina}); ` +
        `se muestran ${r.items.length}.\n\n` +
        r.items
          .map(
            (x) =>
              `- Resolución CREG ${x.numero} de ${x.anio}\n` +
              `  ${x.epigrafe || '(sin epígrafe)'}\n` +
              `  Estado: ${x.estadoSegunCompilacion}\n` +
              `  Texto completo: obtener_documento con fuente="creg" y ruta="${x.ruta}"`,
          )
          .join('\n') +
        `\n\nEse "Estado" es la clasificación de la propia compilación de la CREG, no un campo de vigencia por norma: ` +
        `dilo como lo que es y verifica en el texto si el aparte que te interesa sigue rigiendo.` +
        (anio ? '' : `\nSe consultó solo el año en curso: indica anio para buscar en años anteriores.`),
    )
  },
)

server.registerTool(
  'listar_normativa_ambiental_anla',
  {
    title: 'Normativa ambiental clasificada por la ANLA',
    description:
      'La ANLA mantiene en su sistema "Eureka" una CURADURÍA de la normativa nacional que aplica al licenciamiento ' +
      'ambiental, agrupada por tema. Lo que aporta es la CLASIFICACIÓN, no documentos nuevos: casi todo lo que ' +
      'lista son leyes y decretos que resolver_cita ya resuelve mejor, con texto completo y con vigencia. ' +
      'Úsala para descubrir QUÉ normas aplican a un tema ambiental, y resuelve cada una con resolver_cita.',
    inputSchema: {
      seccion: z.enum(Object.keys(anla.SECCIONES) as [anla.SeccionAnla, ...anla.SeccionAnla[]]).default('leyes'),
      texto: z.string().optional().describe('Filtra las entradas de esa sección por título o resumen'),
      desde: z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .describe('Eureka pagina sola y con distinto tamaño según la sección: no lo calcules, usa el que dice la respuesta'),
    },
  },
  async ({ seccion, texto, desde }) => {
    const r = await anla.listar(seccion, desde)
    const items = texto ? anla.filtrar(r.items, texto) : r.items
    if (!items.length) {
      return vacio(
        `entradas en la sección "${seccion}" de Eureka${texto ? ` que mencionen "${texto}"` : ''}`,
        r.items.length
          ? `La página trae ${r.items.length} entradas pero ninguna coincide: Eureka no tiene buscador propio y el filtro se aplica aquí, solo sobre esta página.`
          : 'Prueba con desde=0 o con otra sección.',
      )
    }
    return txt(
      `${items.length} entrada(s) en "${seccion}" (Eureka, ANLA), desde la posición ${r.desde}.\n\n` +
        items
          .map(
            (x) =>
              `- ${x.titulo}\n` +
              // El número del título es el que escribió Eureka, y a veces no es el
              // de la norma. Cuando el propio resumen lo desmiente, decirlo aquí
              // vale más que la cita: es la diferencia entre citar mal una ley de
              // deforestación y saber que hay que comprobar cuál de las dos es.
              (x.desmentida
                ? `  OJO, EL NÚMERO NO CUADRA: el título dice "${x.cita}" y el resumen de la propia ANLA cita ` +
                  `"${x.desmentida}". Comprueba las dos con resolver_cita antes de citar ninguna.\n`
                : x.cita
                  ? `  Cita leída del título, sin comprobar: pásala por resolver_cita — ${x.cita}\n`
                  : '') +
              (x.resumen ? `  ${x.resumen.slice(0, 220)}\n` : '') +
              `  ${x.url}`,
          )
          .join('\n') +
        (r.siguiente !== null ? `\n\nHay más: repite con desde=${r.siguiente}.` : '') +
        `\n\nEsto es la clasificación temática de la ANLA, no su normativa propia. Para el texto y la vigencia de ` +
        `cada norma, pásala por resolver_cita.`,
    )
  },
)

server.registerTool(
  'buscar_normativa_sectorial',
  {
    title: 'Buscar normativa de un regulador sectorial',
    description:
      'Actos administrativos —resoluciones, circulares, acuerdos— de los reguladores y ministerios sectoriales que ' +
      'el Gestor Normativo NO cataloga. Elige la entidad con el parámetro `entidad`; cada una declara su sector y ' +
      'sus límites en la respuesta.\n' +
      'CUÁNDO NO USARLA: para leyes y decretos nacionales de cualquier sector usa resolver_cita o buscar_por_tema, ' +
      'que dan texto completo y vigencia. En particular, el Decreto Único Reglamentario de CADA sector (1071 ' +
      'agropecuario, 1074 comercio e industria, 1076 ambiente, 1079 transporte, 1072 trabajo…) ya está en el Gestor.\n' +
      'Casi todas entregan PDF sin texto extraíble. La mayoría no publica estado de vigencia; donde sí aparece ' +
      '(ANM y Supersociedades) es lo que declara el portal en su propia fila, NO una verificación de esta ' +
      'extensión: para el estado real de una ley o un decreto, resolver_cita.\n' +
      'LOS FILTROS NO SE COMPORTAN IGUAL EN TODAS, porque los portales tampoco: el Invima exige texto o año y ' +
      'rechaza la consulta sin ellos; la Superfinanciera y la Supertransporte se quedan en el año en curso si no ' +
      'indicas otro; la ANM no aplica el año a las circulares; las demás listan lo más reciente. Cada respuesta ' +
      'dice cuál de estas cosas hizo, pero no lo adivines: si esperabas un año concreto, indícalo.',
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
          'Solo INVIMA/Supersalud: limita a los actos de los tipos que la propia entidad expide (Resolución, ' +
            'Circular...), excluyendo la compilación sectorial del normograma (leyes, decretos del Ministerio, sentencias).',
        ),
      pagina: z.coerce.number().int().min(1).default(1),
      limite: z.coerce.number().int().min(1).max(100).default(15),
    },
  },
  async ({ entidad, texto, anio, pagina, limite, categoria, solo_entidad }) => {
    const a = sectorial.adaptador(entidad)
    if (!a) return vacio(`un regulador llamado "${entidad}"`, `Disponibles: ${sectorial.ids().join(', ')}.`)

    const r = await a.buscar({ texto, anio, pagina, limite, categoria, ...(solo_entidad !== undefined ? { solo_entidad } : {}) })
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
        `${r.nota ? `${r.nota} ` : ''}Consultado: ${r.url}.${completo}`,
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
      `${r.items.length} acto(s) de ${a.nombre} (${a.sector})` +
        (r.total ? ` de ${r.total} que reúne el filtro` : '') +
        `.${r.nota ? `\n${r.nota}` : ''}` +
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
        .string()
        .optional()
        .describe('Clave de una sola fuente ("creg", "suin", "sic"…). Sin ella se devuelven todas.'),
    },
  },
  ({ fuente }) => {
    const idx = cargarIndice()
    const suinIdx = suin.coberturaIndice()
    const normasIndexadas = idx?.filas.reduce((n, f) => n + f.n.length, 0) ?? 0

    const fuentes: [string, string][] = [
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
    ]

    // Pedir el alcance de la CREG no debería costar el texto de las otras veinte.
    if (fuente) {
      const q = sinTildes(fuente).toLowerCase().trim()
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
        ? `- Índice de SUIN: ${suinIdx.leyes.toLocaleString('es')} leyes. Generado el ${suinIdx.generado}.${advertenciaSnapshot(suinIdx.generado)}`
        : `- Índice de SUIN: NO viaja con esta instalación, así que la vigencia no se puede consultar. No es que las ` +
          `normas no estén vigentes: es que esta capacidad está ausente.`,
    ]

    return txt(
      `normativa-colombia ${VERSION} — alcance declarado.\n\n` +
        `FUENTES (pide una sola con fuente="creg", "suin", "sic"…)\n${fuentes.map(([, t]) => t).join('\n')}\n\n` +
        `ÍNDICES EMPAQUETADOS (responden sin red)\n${empaquetado.join('\n')}\n\n` +
        `LO QUE NO ESTÁ CUBIERTO — decirlo importa más que la lista de arriba:\n` +
        `- El ESTADO PROCESAL de un caso: si un proceso sigue abierto, en qué etapa va o cuándo se falla. Aquí solo ` +
        `hay normas y providencias YA PUBLICADAS.\n` +
        `- La vigencia de los DECRETOS: el índice de SUIN son casi solo leyes, porque los sitemaps de decretos del ` +
        `portal devuelven 404. Que un decreto no traiga estado NO significa que esté derogado ni vigente: no consta.\n` +
        `- ${codigosAusentes().map((c) => `${c.nombre.toUpperCase()} (${refCodigo(c)})`).join(' y ')}: NO está en ` +
        `ninguna de estas fuentes: ni el Gestor lo publica ni el índice de SUIN lo trae, y las tres vías de consulta ` +
        `(por nombre, por su norma y por número+año) salen vacías. Con él quedan fuera la acción reivindicatoria, la ` +
        `responsabilidad civil contractual y extracontractual, la filiación, el divorcio y la prescripción ordinaria. ` +
        `El resto de códigos SÍ están y se citan por su nombre: Comercio, Sustantivo del Trabajo, Procesal del ` +
        `Trabajo, Penal, Procedimiento Penal, General del Proceso, CPACA, Infancia y Adolescencia y Estatuto Tributario.\n` +
        `- Las leyes que MODIFICAN un código se leen a través de la ley modificatoria: el artículo devuelve su ` +
        `encabezado y el texto que sustituye, pero el cuerpo normativo modificado hay que leerlo aparte (y si es el ` +
        `Código Civil, no está aquí).\n` +
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

const registrarHerramienta = (nombre: string, m: HerramientaV2) =>
  server.registerTool(
    nombre,
    { title: m.TITULO, description: m.DESCRIPCION, inputSchema: m.schema },
    (async (p: never) => txt(await m.escribir(p))) as never,
  )

registrarHerramienta('consultar_por_jerarquia', consultarJerarquia as never)
registrarHerramienta('analizar_conflicto', analizarConflicto as never)
registrarHerramienta('cambios_desde', cambiosDesde as never)
registrarHerramienta('comparar_articulos', compararArticulos as never)
registrarHerramienta('consultar_perfil', consultarPerfil as never)
registrarHerramienta('consultar_vigencia', consultarVigencia as never)
registrarHerramienta('historial_norma', historialNorma as never)
registrarHerramienta('buscar_unificado', buscarUnificado as never)
registrarHerramienta('obtener_documento', obtenerDocumento as never)
registrarHerramienta('expediente', expedientes as never)

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
