/**
 * `resolver_cita`: de una cita escrita como la escribe un abogado al documento
 * oficial. Es la puerta exacta del MCP; el buscador por palabras no lo es.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { vacio } from '../nucleo/vacio.ts'
import { parsearCita, parsearRadicado } from '../nucleo/citas/index.ts'
import { codigoDe } from '../nucleo/codigos.ts'
import { estricto, numeroDeArticulo } from '../nucleo/normalizar.ts'
import * as suin from '../fuentes/suin/index.ts'
import { resolverCodigo } from './codigo_senado.ts'
import { resolverRadicado } from './resolver_radicado.ts'
import * as validarCita from './validar_cita.ts'
import { buscarCorrigiendoTipo } from './validar_cita/datos.ts'
import { normaAmbigua } from './resolver_cita/ambigua.ts'
import { componer } from './resolver_cita/componer.ts'
import { resolverNormaGestor } from './resolver_cita/norma_gestor.ts'
import { sinNorma, type Deps, type OpcionesCita, type Resuelta } from './resolver_cita/resuelta.ts'
import { resolverSentencia } from './resolver_cita/sentencia.ts'
import { resolverSinGestor } from './resolver_cita/sin_gestor.ts'

/**
 * Resuelve UNA cita de `resolver_cita` en datos (la forma la pone `componer`).
 * La ruta individual llama con una sola cita; el lote itera sobre esta misma
 * función, así que ambas vías resuelven igual.
 */
async function resolverUnaCita(cita: string, opciones: OpcionesCita = {}, deps: Deps = {}): Promise<Resuelta> {
  // Un radicado judicial de 23 dígitos no es una cita normativa: se identifica y se enruta a la corte.
  const radicado = parsearRadicado(cita)
  if (radicado) return resolverRadicado(cita, radicado)
  const c = parsearCita(cita)
  if (!c) {
    return sinNorma(
      cita,
      [],
      `No encontré una cita normativa en "${cita}". Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11", o usa buscar_normas.`,
    )
  }

  /**
   * `articulos` manda sobre el artículo escrito en la cita, y se anuncia:
   * callarlo sería contestar a otra pregunta con el mismo aire de certeza.
   */
  const pedidos = opciones.articulos?.length ? opciones.articulos : c.articulo ? [c.articulo] : []
  const articuloIgnorado =
    opciones.articulos?.length && c.articulo
      ? `Se ignoró el "artículo ${c.articulo}" de la cita: manda el parámetro articulos (${opciones.articulos.join(', ')}).`
      : ''

  const cod = codigoDe(c.tipo, c.numero, c.anio)
  // El Código Civil no está en el Gestor: su texto sale de la Secretaría del Senado.
  if (cod?.senado) return resolverCodigo({ cita, c, codigo: cod, pedidos, articuloIgnorado })
  // La equivalencia solo procede si la cita llegó por el nombre del código.
  const porCodigo = c.codigo ? cod : undefined


  // Las sentencias de la Corte se resuelven contra su relatoría, no contra el Gestor.
  const sentencia = c.sentencia ? await resolverSentencia(cita, c.sentencia) : null
  if (sentencia) return sentencia

  // La corrección del tipo escrito vive en validar_cita.ts para que el lote con
  // validar=true la aplique también: allí no se hacía, y devolvía "no fue
  // posible validar" para citas que esta ruta resolvía sin problema.
  const { r, tipoOficial, otroTitulo } = await buscarCorrigiendoTipo(c, deps.buscar)
  // Solo se corrige el tipo que escribió el usuario. En «art. 817 del Estatuto
  // Tributario» el tipo «decreto» lo puso la tabla de códigos para buscar, y
  // decir «No existe un decreto 624 de 1989» le atribuía un error que no cometió.
  const tipoCorregido =
    tipoOficial && !c.codigo ? `No existe un «${c.tipo} ${c.numero} de ${c.anio}»; el tipo oficial es «${tipoOficial}».` : ''
  const otroTipo = otroTitulo
    ? ` Con ese número y año el Gestor sí tiene «${otroTitulo}», que es de otro tipo: si te referías` +
      ` a esa, pídela con su tipo exacto.`
    : ''
  const fichaSuin = deps.fichaSuin ?? suin.ficha

  if (!r.items.length) {
    return resolverSinGestor({ cita, c, porCodigo, articuloIgnorado, pedidos, otroTipo, fichaSuin })
  }
  const ambigua = normaAmbigua(cita, c, r.items)
  if (ambigua) return ambigua
  return resolverNormaGestor({
    cita,
    c,
    n: r.items[0]!,
    porCodigo,
    articuloIgnorado,
    tipoCorregido,
    pedidos,
    opciones,
    deps,
    fichaSuin,
  })
}

export const TITULO = 'Resolver una cita normativa'

export const DESCRIPCION =
  'Ruta rápida y exacta para citas de leyes, decretos, sentencias, artículos y códigos citados por su nombre ' +
  '("art. 191 del Código de Comercio"). Úsala SIEMPRE que la pregunta mencione una norma concreta: ' +
  'buscar_normas y buscar_por_tema son para cuando no la hay. Devuelve la identificación oficial con su ' +
  'enlace, la vigencia y el texto pedido, y dice contra qué norma resolvió. Solo consulta, no guarda nada. ' +
  `Tres modos: cita sola; citas, un lote de 1 a ${validarCita.MAX_LOTE} que se agrupa por norma (cita o citas, nunca las dos); o articulos con cita ` +
  'apuntando a UNA norma, que se descarga una vez (con citas, articulos se ignora). validar=true cambia la ' +
  'respuesta a un VEREDICTO sobre la cita (validada, parcialmente validada o no validable), sin texto ni ' +
  'vigencia; url y formato solo valen con validar. Para las reformas de una norma usa historial_norma; para ' +
  'quién cita una sentencia, linea_jurisprudencial.'

export const ANOTACIONES: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
}

const esquema = z.object({
  cita: z
    .string()
    .optional()
    .describe('Ej.: "Ley 909 de 2004", "C-337/11", "art. 6 de la Ley 1221 de 2008", "art. 191 del Código de Comercio"'),
  citas: validarCita.loteDeCitas
    .optional()
    .describe(
      `Varias citas a la vez (de 1 a ${validarCita.MAX_LOTE}), ej. ["Ley 909 de 2004", "C-337/11"]: cada una se resuelve y se devuelve con su enlace`,
    ),
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

export async function escribir(
  { cita, citas, articulos, contexto, validar, url, formato }: Params,
  deps: Deps = {},
): Promise<string> {
  validarCita.unaViaDeCita({ cita, citas })
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
  // Lote sin validación: cada cita se resuelve por la misma vía que una cita
  // individual, y `componer` agrupa las de la misma norma bajo una ficha. Un
  // fallo de red de una cita se anota en su bloque y no tumba a las demás.
  if (citas?.length) {
    const piezas: Resuelta[] = []
    for (const una of citas) {
      try {
        piezas.push(await resolverUnaCita(una, { contexto }, deps))
      } catch (e) {
        piezas.push(
          sinNorma(
            una,
            [],
            `La fuente no respondió en esta consulta (${(e as Error).message}). ` +
              `Vuelve a intentarlo antes de afirmar nada.\nEnlace: (sin enlace)`,
          ),
        )
      }
    }
    // `articulos` es de UNA norma: con un lote no se sabe a cuál aplicarlo, y
    // dejarlo caer en silencio contestaría a otra pregunta.
    const sobrante = articulos?.length
      ? `articulos (${articulos.join(', ')}) se ignoró: es para varios artículos de UNA norma, no para un lote. ` +
        `Pídelos con cita apuntando a la norma.\n\n`
      : ''
    return componer(piezas, sobrante)
  }
  if (!cita) {
    return vacio(
      'una cita normativa',
      'Escríbela como "Ley 909 de 2004", "art. 191 del Código de Comercio" o "C-337/11" (y varias a la vez con citas), o usa buscar_normas.'
    )
  }
  return componer([await resolverUnaCita(cita, { articulos, contexto }, deps)])
}
