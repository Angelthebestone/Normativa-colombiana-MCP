/**
 * `resolver_radicado`: la rama de `resolver_cita` para un Radicado Judicial
 * Único de 23 dígitos. Vive fuera de `index.ts` por lo mismo que `validar_cita`
 * y `codigo_senado`: es una responsabilidad con sus propias reglas de
 * honestidad.
 *
 * Un radicado se identifica por SUS dígitos, no por el portal donde apareció:
 * solo `03xx` (Consejo de Estado) y `0203` (Corte Suprema, Sala Civil) los
 * tienen de una alta corte; los de juzgado o tribunal de instancia NO (ver la
 * tabla de `citas.ts`). Por eso, además del Consejo, también se consulta SAMAI
 * por un radicado de corporación desconocida: el Consejo conoce en segunda
 * instancia procesos que nacieron en tribunales, y un radicado de origen puede
 * tener providencias tituladas allí. Lo que se dice del hallazgo es dónde se
 * encontró, sin convertirlo en asunto del Consejo de Estado. La Corte Suprema
 * sigue sin buscar: no expone el radicado en su buscador.
 *
 * Un vacío en SAMAI tiene tres lecturas que hay que decir juntas, porque por
 * separado cada una se lee como «no existe».
 */
import * as consejo from '../fuentes/jurisprudencia/consejoestado.ts'
import { activa, alcance, avisoApagada } from '../nucleo/alcance.ts'
import type { Radicado } from '../nucleo/citas.ts'

/** Sin resultado en SAMAI para un radicado del Consejo: las tres verdades. */
const SIN_RESULTADO =
  'SAMAI no tiene ninguna providencia TITULADA de este radicado. Tres cosas, juntas:\n' +
  '1. SAMAI solo indexa «providencias tituladas»: las que traen problema jurídico, respuesta y nota de relatoría. ' +
  'Titula una PARTE de sus providencias, no todas.\n' +
  '2. Por eso, que este radicado no aparezca NO significa que el proceso no exista.\n' +
  '3. El estado del proceso no está en este MCP: consúltalo en el buscador del Consejo de Estado ' +
  '(https://samai.consejodeestado.gov.co) o en la Consulta de Procesos de la Rama Judicial.'

/** Sin resultado para un radicado cuya corporación los dígitos no fijan. */
const SIN_RESULTADO_DESCONOCIDA =
  'No encontrado ahí: SAMAI solo titula una parte de sus providencias y eso no dice nada sobre el proceso. ' +
  'Búscalo por materia en las tres cortes: buscar_jurisprudencia (Corte Constitucional), ' +
  'buscar_jurisprudencia_consejo_estado (Consejo de Estado) y buscar_jurisprudencia_suprema (Corte Suprema). ' +
  'Este MCP no tiene el estado procesal: no se afirma nada sobre él.'

const CORTE_SUPREMA =
  'La Corte Suprema NO permite buscar por radicado: su buscador no expone ese campo (el radicado solo aparece ' +
  'dentro del texto de la providencia). Para encontrarla, usa buscar_jurisprudencia_suprema por MATERIA y, ya ' +
  'con el texto, localiza el radicado dentro de él con obtener_documento con fuente="suprema" y ' +
  'buscar_en_texto. Este MCP no tiene el estado procesal: no se afirma nada sobre él.'

/**
 * Especialidades (dígitos 6-7) que son de un juzgado o tribunal de instancia,
 * medidas: 31 = juzgado de circuito, 23 = tribunal administrativo; 40 y 60
 * también son de instancia. Un código que no esté aquí NO se interpreta.
 */
const INSTANCIA = new Set(['23', '31', '40', '60'])

/** Los siete grupos del radicado, en una línea, con lo único que los dígitos dicen. */
function componentes(r: Radicado): string {
  return (
    `Dígitos: DANE ${r.dane} (${r.departamento || 'departamento no identificado'}) · ` +
    `especialidad ${r.especialidad} · sala ${r.sala} · despacho ${r.despacho} · año ${r.anio} · ` +
    `consecutivo ${r.consecutivo} · instancia/recurso ${r.recurso}`
  )
}

/**
 * Lo que la corporación es según los dígitos, sin sumarle nada. El rótulo
 * «según los dígitos (medido)» solo sale cuando los dígitos SÍ identifican una
 * alta corte; para lo demás se dice lo que se sabe —o que no se sabe—.
 */
function corporacionMedida(r: Radicado): string {
  if (r.corporacion !== 'desconocida') {
    const nombre = r.corporacion === 'consejo-de-estado' ? 'Consejo de Estado' : 'Corte Suprema de Justicia'
    return `Corporación según los dígitos (medido): ${nombre}${r.etiqueta ? ` — ${r.etiqueta}` : ' (esta pareja de dígitos no fija la sala)'}.`
  }
  if (INSTANCIA.has(r.especialidad)) {
    return (
      `Los dígitos 6-9 (${r.especialidad}-${r.sala}) no corresponden a una alta corte: son de un juzgado o ` +
      `tribunal de instancia.`
    )
  }
  return 'Los dígitos no bastan para saber ante qué despacho va el proceso.'
}

/** Una providencia con lo que SAMAI publica de ella y el asa para leerla. */
function ficha(p: consejo.Providencia): string {
  const lineas = [
    `- ${p.radicado}${p.clase ? ` (${p.clase})` : ''}`,
    p.fecha ? `  Fecha del proceso: ${p.fecha}` : '',
    p.sala ? `  Sala: ${p.sala}` : '',
    p.ponente ? `  Ponente: ${p.ponente}` : '',
    p.actor || p.demandado ? `  ${p.actor || '(sin demandante)'} contra ${p.demandado || '(sin demandado)'}` : '',
    `  Ficha del proceso: ${p.url}`,
    p.token ? `  Para leer: obtener_documento con fuente="consejo", token="${p.token}"` : '',
    ...p.titulaciones.map(
      (t) =>
        `  · Problema jurídico: ${t.problema}` +
        (t.respuesta ? `\n    Respuesta: ${t.respuesta}` : '') +
        (t.nota ? `\n    Nota de relatoría: ${t.nota}` : ''),
    ),
  ].filter(Boolean)
  return lineas.join('\n')
}

export async function resolverRadicado(
  cita: string,
  r: Radicado,
  deps: { porRadicado?: typeof consejo.porRadicado } = {},
): Promise<string> {
  const porRadicado = deps.porRadicado ?? consejo.porRadicado
  const cab = `### ${cita}`
  const cuerpo = `${componentes(r)}\n${corporacionMedida(r)}`

  // Solo la Corte Suprema no busca: no expone el radicado en su buscador.
  if (r.corporacion === 'corte-suprema') return `${cab}\n${alcance([])}\n${cuerpo}\n\n${CORTE_SUPREMA}`

  // El Consejo —y también un radicado de corporación desconocida, porque el
  // Consejo conoce procesos que nacieron en tribunales— se consulta en SAMAI.
  // La fuente apagada no cae a otra: ninguna otra tiene este proceso, y salir
  // por un «no encontré» se leería como «no existe».
  if (!activa('consejo')) {
    return (
      `${cab}\n${alcance([])}\n${cuerpo}\n\n${avisoApagada('consejo')} Sin ella no se pudo comprobar si SAMAI ` +
      `tiene titulada alguna providencia de este radicado: no se puede afirmar ni negar nada sobre el proceso.`
    )
  }

  let items: consejo.Providencia[]
  try {
    ;({ items } = await porRadicado(r.formateado))
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    return (
      `${cab}\n${alcance([{ clave: 'consejo', detalle: 'no respondió' }])}\n${cuerpo}\n\n` +
      `La consulta a SAMAI FALLÓ: ${motivo}\nNo se puede concluir nada —ni que el proceso tenga providencias ` +
      `tituladas ni que no las tenga—. Vuelve a intentarlo.`
    )
  }

  const linea = alcance([{ clave: 'consejo', detalle: items.length ? `${items.length} providencia(s)` : '0 tituladas' }])
  if (!items.length) {
    const sin = r.corporacion === 'consejo-de-estado' ? SIN_RESULTADO : SIN_RESULTADO_DESCONOCIDA
    return `${cab}\n${linea}\n${cuerpo}\n\n${sin}`
  }

  // Para un radicado cuya corporación los dígitos no fijan, se dice DÓNDE se
  // encontró (en el buscador del Consejo), no que el proceso sea suyo.
  const intro =
    r.corporacion === 'consejo-de-estado'
      ? ''
      : 'Encontrado en el buscador de providencias tituladas de SAMAI (Consejo de Estado):\n\n'
  return (
    `${cab}\n${linea}\n${cuerpo}\n\n${intro}` +
    items.map(ficha).join('\n\n') +
    `\n\nLOS TOKENS CADUCAN EN UNA HORA: sirven para leer, no para citar. Para citar usa el radicado.`
  )
}
