/**
 * `consultar_vigencia`: el estado de vigencia de una norma con un nivel de
 * confianza. Reutiliza la resolución de `resolver_cita` (Gestor + ficha SUIN
 * directa cacheada) y lo que ya hace `suin.vigencia`/`fichaDirectaDecreto`,
 * sin duplicar el parseo de citas ni la lógica de ambigüedad.
 *
 * Confianza:
 * - `alta`  — la ficha SUIN directa respondió (índice + ficha del documento).
 * - `media` — solo hay señal del índice de búsqueda de SUIN (contradice a
 *             veces la ficha, así que se avisa).
 * - `baja`  — no consta en ninguna fuente (índice ausente, decreto no cubierto
 *             o cita inexistente).
 */
import { z } from 'zod'

import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as suin from '../fuentes/suin.ts'

export const TITULO = 'Consultar la vigencia de una norma'

export const DESCRIPCION =
  'Devuelve el estado de vigencia de una norma ("Vigente", "Derogado", "Vigencia en Estudio"... cuando SUIN lo ' +
  'publica) con un nivel de confianza: alta (ficha SUIN directa), media (índice del buscador, que a veces ' +
  'contradice la ficha) o baja (no consta). Nunca inventa el estado: si no consta, lo dice y orienta.'

const esquema = z.object({
  cita: z.string().describe('Cita de la norma, ej. "Ley 909 de 2004" o "Decreto 1072 de 2015"'),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export type VeredictoVigencia = {
  cita: string
  estado: string
  confianza: 'alta' | 'media' | 'baja'
  url?: string
  explicacion: string
}

/** Formatea el veredicto. Exportada para testear sin red. */
export function formatear(v: VeredictoVigencia): string {
  return (
    `Vigencia de ${v.cita}:\n` +
    `Estado: ${v.estado}\n` +
    `Confianza: ${v.confianza}\n` +
    `${v.url ? `URL: ${v.url}\n` : ''}` +
    `Por qué: ${v.explicacion}\n\n` +
    'Esto no es asesoría jurídica; verifica en el enlace antes de actuar.'
  )
}

export async function escribir({ cita }: Params): Promise<string> {
  const c = parsearCita(cita)
  if (!c) {
    return `No reconocí «${cita}» como una cita. Escríbela como "Ley 909 de 2004" o "C-337/11".`
  }

  const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return (
        `La cita «${cita}» es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años ` +
        `distintos. Repite con el año, por ejemplo «${ambiguos[0]!.titulo}».`
      )
    }
  }

  const cobertura = suin.coberturaIndice()
  if (!cobertura) {
    return formatear({
      cita,
      estado: 'no consta (capacidad ausente)',
      confianza: 'baja',
      explicacion:
        'El índice de SUIN no viaja con esta instalación, así que el estado de vigencia no se puede consultar. ' +
        'No es que la norma no esté vigente: es que esta capacidad está ausente. Revisa el enlace del Gestor o ' +
        'el Diario Oficial.',
    })
  }

  const anio = c.anio ?? r.items[0]?.titulo.match(/\bde\s+(\d{4})\b/i)?.[1]
  if (anio) {
    // Ficha SUIN directa (la más fiable): para decretos no cubiertos por el
    // índice se usa la ruta directa ya cacheada. Un timeout/fallo de red de la
    // ficha no es "no consta": se degrada con confianza baja y se orienta.
    let fichaDirecta: Awaited<ReturnType<typeof suin.fichaDirectaDecreto>>
    try {
      fichaDirecta = await suin.fichaDirectaDecreto(c.tipo, c.numero, anio)
    } catch (e) {
      return formatear({
        cita,
        estado: 'no consta (ficha caída)',
        confianza: 'baja',
        explicacion: `La ficha de SUIN-Juriscol no respondió en esta consulta (${(e as Error).message}). Vuelve a intentarlo antes de afirmar nada.`,
      })
    }
    if (fichaDirecta.ok) {
      return formatear({
        cita,
        estado: fichaDirecta.vigencia.estado || 'SUIN no publica el estado de esta norma',
        confianza: 'alta',
        url: fichaDirecta.vigencia.url,
        explicacion:
          `Ficha SUIN-Juriscol (índice del ${fichaDirecta.vigencia.generado}). El estado es el que publica la ficha.`,
      })
    }
    if (fichaDirecta.razon === 'ficha-caida') {
      return formatear({
        cita,
        estado: 'no consta (ficha caída)',
        confianza: 'baja',
        explicacion:
          `La ficha de SUIN-Juriscol no respondió en esta consulta` +
          `${fichaDirecta.detalle ? ` (${fichaDirecta.detalle})` : ''}. Vuelve a intentarlo antes de afirmar nada.`,
      })
    }
    // Índice de leyes empaquetado. Un fallo de red aquí también se degrada:
    // no puede parecerse a "la norma no tiene estado".
    let v: Awaited<ReturnType<typeof suin.vigencia>>
    try {
      v = await suin.vigencia(c.tipo, c.numero, anio)
    } catch (e) {
      return formatear({
        cita,
        estado: 'no consta (ficha caída)',
        confianza: 'baja',
        explicacion: `La ficha de SUIN-Juriscol no respondió en esta consulta (${(e as Error).message}). Vuelve a intentarlo antes de afirmar nada.`,
      })
    }
    if (v) {
      return formatear({
        cita,
        estado: v.estado || 'SUIN no publica el estado de esta norma',
        confianza: 'media',
        url: v.url,
        explicacion:
          `Señal del índice de búsqueda de SUIN (generado el ${v.generado}). OJO: este índice a veces contradice ` +
          `la ficha del documento (la Ley 74 de 1923 figura "Vigencia en Estudio" y su ficha dice DEROGADO): ` +
          `verifica en el enlace antes de concluir.`,
      })
    }
  }

  return formatear({
    cita,
    estado: 'no consta',
    confianza: 'baja',
    explicacion:
      'Ni el Gestor ni el índice de SUIN tienen esta norma, o el índice solo cubre leyes (los sitemaps de ' +
      'decretos del portal devuelven 404). No significa que esté derogada ni vigente: revísalo en el Diario ' +
      'Oficial o en la ficha de SUIN-Juriscol.',
  })
}
