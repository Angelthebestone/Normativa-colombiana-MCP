/**
 * `obtener_documento`: un solo punto de lectura para las fuentes con texto.
 * Antes eran seis herramientas con el mismo esquema y el mismo cuerpo
 * (fragmentos + trocear + advertenciasVigencia + avisoSinTexto) repetido;
 * aquí el discriminador es `fuente` y los extras que cada una exige.
 *
 * El esquema común (buscar_en_texto/desde/max_pasajes/limite_caracteres) se
 * define una vez; cada fuente añade lo suyo (id/articulo/historial en gestor,
 * ruta/seccion en corte, sala en suprema, token en consejo, link en dian,
 * ruta en creg, entidad/url en sectorial). El texto se trocea igual en todas,
 * informando total/mostrado/omitido, y las advertencias de vigencia viajan
 * siempre. Con `entero=true` se escribe el documento a disco y se devuelve la
 * ruta con un trozo de lectura; con `ruta_destino` se descarga tal cual.
 */
import { adaptador, exigirOrigen } from '../fuentes/sectorial.ts'
import { alcance } from '../nucleo/alcance.ts'
import { schema, union, problemaDeFuente, topeDe, type DepsLectura, type Parametros, type Resueltas } from './obtener_documento/esquema.ts'
import { pedidoDe } from './obtener_documento/formato.ts'
import { gestorDocumento } from './obtener_documento/gestor.ts'
import { corteDocumento, supremaDocumento, consejoDocumento } from './obtener_documento/providencias.ts'
import { dianDocumento, cregDocumento } from './obtener_documento/normogramas.ts'
import { sectorialDocumento } from './obtener_documento/sectorial.ts'
import { enteroDocumento } from './obtener_documento/guardado.ts'

export { TITULO, DESCRIPCION, ANOTACIONES, schema, type DepsLectura } from './obtener_documento/esquema.ts'
export { mencionesDe } from './obtener_documento/formato.ts'

const POR_FUENTE: Record<Resueltas['fuente'], (p: Resueltas, tope: number, deps: DepsLectura) => Promise<string>> = {
  gestor: gestorDocumento,
  corte: corteDocumento,
  suprema: supremaDocumento,
  consejo: consejoDocumento,
  dian: dianDocumento,
  creg: cregDocumento,
  sectorial: sectorialDocumento,
}

export async function escribir(p: Parametros, deps: DepsLectura = {}): Promise<string> {
  // El esquema publicado valida los tipos; la unión valida la COMBINACIÓN, que
  // es lo que el esquema plano no puede decir. Se hace aquí, antes de tocar la
  // red: una llamada imposible no gasta viaje ni devuelve un vacío que se lea
  // como "no hay resultados".
  const r = schema.parse(p) as Resueltas
  if (!union.safeParse(r).success) throw new Error(problemaDeFuente(r))
  // El enlace sectorial lo trae quien llama: se valida contra su regulador
  // antes de cualquier rama (PDF, Word, HTML o descarga a disco).
  const regulador = r.fuente === 'sectorial' ? adaptador(r.entidad ?? '') : undefined
  if (regulador) exigirOrigen(regulador, r.url ?? '')
  const tope = topeDe(r.limite_caracteres)
  // Con ruta_destino la orden es descargar, no leer: se obedece antes que el troceo.
  const cuerpo =
    r.ruta_destino || r.entero ? await enteroDocumento(r, tope, deps) : await POR_FUENTE[r.fuente](r, tope, deps)
  // Cada llamada consulta UNA sola fuente, la de `fuente`. La excepción es un
  // id sectorial inexistente: devuelve la lista de ids válidos sin salir a la
  // red, y declarar ahí que se consultó el regulador sería falso.
  const cabecera =
    r.fuente === 'sectorial' && !adaptador(r.entidad ?? '')
      ? 'Alcance: sin consultar ninguna fuente (la llamada no llegó a salir).'
      : alcance([{ clave: r.fuente, detalle: pedidoDe(r) }])
  return `${cabecera}\n\n${cuerpo}`
}
