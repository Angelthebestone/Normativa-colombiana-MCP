/**
 * Resolución de un código cuyo texto sale de la Secretaría del Senado: hoy, el
 * Código Civil (Ley 84 de 1873), que el Gestor Normativo no publica y cuya ficha
 * en SUIN no sirve el texto.
 *
 * Es la rama de `resolver_cita` para los códigos con `senado` en la tabla de
 * `nucleo/codigos.ts`. Vive fuera de `index.ts` por lo mismo que `validar_cita`:
 * es una responsabilidad con sus propias reglas de honestidad.
 *
 * Tres advertencias viajan SIEMPRE con el texto, porque cada una evita un error
 * que no se ve al leer la respuesta:
 * - el portal solo habla HTTP plano (su puerto 443 no abre, medido el 2026-09-28):
 *   el texto llega sin cifrar ni autenticar, y para un texto legal eso se dice;
 * - los apartes tachados (`~~…~~`) son los que el portal marca como inexequibles o
 *   derogados: leerlos como vigentes es el error grave;
 * - las notas de vigencia y la jurisprudencia de cada artículo son del editor del
 *   portal y NO se reproducen (su pie de página reserva esos derechos): se remite
 *   al enlace, donde están.
 */
import { articulo as articuloDelSenado, BASE_SENADO } from '../fuentes/senado.ts'
import * as suin from '../fuentes/suin.ts'
import { activa, avisoApagada } from '../nucleo/alcance.ts'
import { equivalencia, referencia, type Codigo } from '../nucleo/codigos.ts'
import type { Cita } from '../nucleo/citas.ts'
import type { Resuelta } from './resolver_cita.ts'

const SIN_CIFRAR =
  'La Secretaría del Senado solo sirve HTTP sin cifrar (su puerto 443 no abre): este texto viajó sin autenticar. ' +
  'Contrástalo en el enlace antes de citarlo en un escrito.'

const NOTAS_EN_EL_ENLACE =
  'El portal anota, artículo por artículo, la vigencia, las modificaciones y la jurisprudencia de constitucionalidad ' +
  '(notas de su editor, que no se reproducen aquí): consúltalas en el enlace antes de citar.'

export async function resolverCodigo(o: {
  cita: string
  c: Cita
  codigo: Codigo
  /** Artículos pedidos, ya resueltos entre la cita y el parámetro `articulos`. */
  pedidos: string[]
  articuloIgnorado: string
}): Promise<Resuelta> {
  const { cita, c, codigo, pedidos, articuloIgnorado } = o
  const archivo = codigo.senado!
  // Aquí la tabla sí da el tipo oficial (Ley 84 de 1873): no hay título del Gestor con que contrastarlo.
  const avisos = [c.codigo ? equivalencia(codigo, referencia(codigo)) : '', articuloIgnorado]
  const indice = `${BASE_SENADO}/${archivo}.html`

  // El estado de vigencia es el de la norma entera, de SUIN; el del artículo, en el enlace.
  const f = activa('suin') ? await suin.ficha(c.tipo, c.numero, c.anio ?? codigo.anio) : null
  const vig = !f
    ? `\nEstado de vigencia: ${avisoApagada('suin')}`
    : f.ok
      ? `\nEstado de vigencia de la norma según SUIN-Juriscol (ficha consultada hoy): ${f.ficha.estado || 'SUIN no publica el estado de esta norma'}\n  ${f.ficha.url}`
      : `\nEstado de vigencia: no consta; SUIN-Juriscol no respondió con la ficha (${f.detalle}).`
  const epigrafe = f?.ok && f.ficha.epigrafe ? `${f.ficha.epigrafe}\n` : ''
  const suinUso = f ? [{ clave: 'suin', detalle: f.ok ? 'estado consultado' : 'sin ficha' }] : []
  const titulo = `${referencia(codigo)} — ${codigo.nombre}`
  const base = { cita, clave: `senado:${archivo}`, titulo, avisos }

  if (!activa('senado')) {
    return {
      ...base,
      usos: suinUso,
      ficha:
        `${titulo}\n${epigrafe}` +
        `${avisoApagada('senado')} Sin ella no hay dónde leer el texto del ${codigo.nombre}: el Gestor Normativo no lo ` +
        `publica y SUIN-Juriscol no sirve el texto de sus documentos. No es que el artículo no exista: consúltalo en la ` +
        `edición oficial.${vig}`,
      articulos: [],
    }
  }

  if (!pedidos.length) {
    return {
      ...base,
      usos: suinUso,
      ficha:
        `${titulo}\n${epigrafe}` +
        `El texto del ${codigo.nombre} se lee artículo por artículo desde la Secretaría del Senado: pídelo en la ` +
        `cita ("art. 946 del ${codigo.nombre}") o con el parámetro articulos.\n` +
        `URL: ${indice}${vig}`,
      articulos: [],
    }
  }

  const articulos: string[] = []
  let actualizacion = ''
  let leidos = 0
  let tachados = false
  for (const numero of pedidos) {
    const r = await articuloDelSenado(archivo, numero)
    if (r.ok) {
      leidos += 1
      actualizacion ||= r.actualizacion
      tachados ||= r.tachados
      // Esta URL no repite la de la norma: es la página del artículo, donde el
      // portal anota su vigencia y su jurisprudencia.
      articulos.push(`--- Artículo ${numero} ---\nURL: ${r.url}\n${r.texto}`)
    } else if (r.razon === 'no-existe') {
      articulos.push(
        `No encontré un "artículo ${numero}" en el ${codigo.nombre} de la Secretaría del Senado (${r.detalle}). ` +
          `Comprueba el número; el texto está en ${indice}.`,
      )
    } else {
      articulos.push(
        `No pude leer el artículo ${numero} del ${codigo.nombre}: ${r.detalle}. ` +
          `Esto NO significa que no exista: vuelve a intentarlo o léelo en ${indice}.`,
      )
    }
  }

  return {
    ...base,
    usos: [{ clave: 'senado', detalle: `${leidos} de ${pedidos.length} artículo(s)` }, ...suinUso],
    ficha:
      `${titulo}\n${epigrafe}` +
      (actualizacion ? `Texto de la Secretaría del Senado. ${actualizacion}\n` : '') +
      vig.trimStart(),
    articulos,
    pie: [
      tachados
        ? 'Los apartes entre ~~ ~~ están TACHADOS en el portal: los declaró inexequibles o los derogó; no los cites como vigentes.'
        : '',
      leidos ? NOTAS_EN_EL_ENLACE : '',
      leidos ? SIN_CIFRAR : '',
    ].filter(Boolean),
  }
}
