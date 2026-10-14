import { activa, avisoApagada } from '../../nucleo/alcance.ts'
import type { Cita } from '../../nucleo/citas.ts'
import { equivalencia, referencia as refCodigo, type Codigo } from '../../nucleo/codigos.ts'
import * as suin from '../../fuentes/suin/index.ts'
import { sinNorma, type Resuelta } from './resuelta.ts'

export type EntradaSinGestor = {
  cita: string
  c: Cita
  porCodigo: Codigo | undefined
  articuloIgnorado: string
  pedidos: string[]
  otroTipo: string
  fichaSuin: typeof suin.ficha
}

/**
 * El Gestor no tiene la norma. Que no la tenga no significa que no exista: su
 * corpus no cubre todo el país, así que antes de decir «no encontré» se
 * pregunta a SUIN, que sí la puede registrar.
 */
export async function resolverSinGestor(e: EntradaSinGestor): Promise<Resuelta> {
  const { cita, c, porCodigo, articuloIgnorado, pedidos, otroTipo, fichaSuin } = e
  // Sin norma resuelta no hay título oficial: la equivalencia sale de la tabla.
  const avisos = [porCodigo ? equivalencia(porCodigo, refCodigo(porCodigo)) : '', articuloIgnorado]
  // Que el Gestor no la tenga no significa que no exista: su corpus no
  // cubre todo el país. Antes de decir "no encontré" —que se lee como "esa
  // norma no existe"— se pregunta a SUIN, que sí la puede registrar.
  const f = c.anio && activa('suin') ? await fichaSuin(c.tipo, c.numero, c.anio) : null
  if (f?.ok) {
    const v = f.ficha
    return sinNorma(
      cita,
      [{ clave: 'gestor', detalle: '0 documentos' }, { clave: 'suin', detalle: 'ficha encontrada' }],
      `${cita} no está en el Gestor Normativo de Función Pública, pero SUIN-Juriscol sí la registra.\n` +
        (v.epigrafe ? `${v.epigrafe}\n` : '') +
        `Estado de vigencia según SUIN-Juriscol (ficha consultada hoy): ${v.estado || 'SUIN no publica el estado de esta norma'}\n` +
        `URL: ${v.url}\n\n` +
        suin.TEXTO_NO_PUBLICO +
        (pedidos.length ? ` Por eso no se puede devolver el artículo ${pedidos.join(', ')}: búscalo en el Diario Oficial.` : ''),
      avisos,
    )
  }
  const suinCayo = f?.ok === false && f.razon === 'ficha-caida'
  return sinNorma(
    cita,
    [
      { clave: 'gestor', detalle: '0 documentos' },
      ...(f ? [{ clave: 'suin', detalle: suinCayo ? 'no respondió' : 'sin ficha' }] : []),
    ],
    `No encontré la cita "${cita}" en las fuentes consultadas.\n\n` +
      ((c.anio ? `Prueba sin el año, o verifica el número.` : `Prueba indicando el año.`) + otroTipo) +
      (f?.ok === false && f.detalle
        ? suinCayo
          ? `\n\nSUIN-Juriscol no respondió (${f.detalle}): no se pudo comprobar si la registra. Vuelve a intentarlo antes de concluir que no existe.`
          : `\n\nSUIN-Juriscol: ${f.detalle}.`
        : '') +
      (c.anio && !activa('suin') ? `\n\n${avisoApagada('suin')} Una norma que el Gestor no tiene solo la podía registrar SUIN.` : ''),
    avisos,
  )
}
