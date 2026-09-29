import './arranque.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { apagadas, DESCARGO, herramientaActiva, NOMBRE_FUENTE } from './nucleo/alcance.ts'
import * as consultarJerarquia from './herramientas/consultar_jerarquia.ts'
import * as analizarConflicto from './herramientas/analizar_conflicto.ts'
import * as cambiosDesde from './herramientas/cambios_desde.ts'
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
import * as resolverCita from './herramientas/resolver_cita.ts'
import * as buscarJurisprudenciaConsejoEstado from './herramientas/buscar_jurisprudencia_consejo_estado.ts'
import * as buscarNormativaSectorial from './herramientas/buscar_normativa_sectorial.ts'
import * as describirFuentes from './herramientas/describir_fuentes.ts'
import * as obtenerDocumento from './herramientas/obtener_documento.ts'
import { redResumen, VERSION } from './nucleo/http.ts'
import { avisoVersion } from './nucleo/actualizacion.ts'
import './fuentes/sectorial/registro.ts'


const hoy = () => new Date().toISOString().slice(0, 10)

/** Toda respuesta sale fechada y con el descargo: es la fuente lo que la hace útil. */
const txt = (s: string) => ({
  content: [{ type: 'text' as const, text: `${s}\n\nConsulta del ${hoy()}. ${DESCARGO}${avisoVersion()}` }],
})

// --- índice temático empaquetado -----------------------------------------

// --- servidor ------------------------------------------------------------


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

Otras herramientas (el resto, con su cuándo usarla, está en su propia descripción):
- Comprobar que una cita y su enlace son de verdad → resolver_cita con validar=true. Clasifica en "validada", "parcialmente validada" o "no fue posible validar", y nunca afirma vigencia.
- Encadenar resultados sin releer texto → formato="json" en buscar_unificado, analizar_conflicto, historial_norma y resolver_cita (con validar=true): devuelve el objeto de datos, sin pie. Los resultados de buscar_unificado traen "Para leer", la llamada ya armada a obtener_documento.
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

registrarHerramienta('resolver_cita', resolverCita)

registrarHerramienta('buscar_normas', buscarNormas)

registrarHerramienta('buscar_por_tema', buscarPorTema)

registrarHerramienta('listar_catalogos', listarCatalogos)

registrarHerramienta('buscar_jurisprudencia', buscarJurisprudencia)

registrarHerramienta('buscar_normativa_tributaria', buscarNormativaTributaria)

registrarHerramienta('buscar_jurisprudencia_suprema', buscarJurisprudenciaSuprema)

registrarHerramienta('buscar_jurisprudencia_consejo_estado', buscarJurisprudenciaConsejoEstado)

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

registrarHerramienta('buscar_normativa_sectorial', buscarNormativaSectorial)


registrarHerramienta('describir_fuentes', describirFuentes)

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
