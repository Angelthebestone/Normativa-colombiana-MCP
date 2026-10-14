import './arranque.ts'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
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
import { fechaBogota } from './nucleo/fecha.ts'
import { INSTRUCCIONES } from './servidor/instrucciones.ts'
import { registrarPrompts } from './servidor/prompts.ts'


/** Toda respuesta sale fechada y con el descargo: es la fuente lo que la hace útil. */
const txt = (s: string) => ({
  content: [{ type: 'text' as const, text: `${s}\n\nConsulta del ${fechaBogota()}. ${DESCARGO}${avisoVersion()}` }],
})

// --- índice temático empaquetado -----------------------------------------

// --- servidor ------------------------------------------------------------


// --- servidor ------------------------------------------------------------

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
// cada módulo solo exporta título, descripción, anotaciones, esquema y el texto puro.
// `ANOTACIONES` es obligatorio: que falte en un módulo es un error de tipos.
type HerramientaV2<S extends z.ZodTypeAny> = {
  TITULO: string
  DESCRIPCION: string
  ANOTACIONES: ToolAnnotations
  schema: S
  escribir: (p: z.infer<S>) => Promise<string>
}

function registrarHerramienta<S extends z.ZodTypeAny>(nombre: string, m: HerramientaV2<S>) {
  return server.registerTool(
    nombre,
    { title: m.TITULO, description: m.DESCRIPCION, annotations: m.ANOTACIONES, inputSchema: m.schema },
    // Con `formato: "json"` la respuesta es SOLO el JSON: el pie de fecha y descargo lo rompería, así
    // que ese modo lleva dentro `fecha_consulta`, `alcance` y `avisos` (lo escribe cada herramienta).
    //
    // ponytail: el `as never` del final es el mismo caso que en el gancho de arriba —`registerTool`
    // infiere el handler del `inputSchema`, y aquí el shape llega en una variable—. Es UNO, no uno
    // por herramienta: las 16 llamadas de abajo ya no llevan ninguno.
    (async (p: z.infer<S> & { formato?: string }) =>
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


registrarPrompts(server)

await server.connect(new StdioServerTransport())
