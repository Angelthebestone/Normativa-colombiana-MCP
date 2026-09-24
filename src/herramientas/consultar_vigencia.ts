/**
 * `consultar_vigencia`: el estado de vigencia de una norma con un nivel de
 * confianza. Resuelve la cita contra el Gestor y lee el estado de la ficha de
 * SUIN-Juriscol (`suin.ficha`), sin duplicar el parseo de citas ni la lógica de
 * ambigüedad.
 *
 * Las SENTENCIAS no van por esa ruta: una providencia no tiene estado de
 * vigencia, así que se verifican contra la relatoría de la Corte Constitucional
 * (existe o no existe) y SUIN no se toca. Sin esta rama, un número inventado
 * salía como "ficha caída" —un fallo de fuente por un dato que no existe— y
 * quien preguntaba no podía distinguirlo de que la fuente estuviera caída.
 *
 * Toda respuesta encabeza con la línea de alcance: qué fuente se consultó y
 * cuál no. Sin ella, el vacío de una fuente se lee como el de las demás.
 *
 * Confianza:
 * - `alta` — la fuente respondió: ficha de SUIN o veredicto medido de la
 *            relatoría sobre una sentencia (existe / no existe).
 * - `baja` — no consta, o la fuente no respondió (ficha caída, relatoría sin
 *            respuesta).
 */
import { z } from 'zod'

import { activa, alcance, avisoApagada } from '../nucleo/alcance.ts'
import { idTipo, parsearCita, candidatosAmbiguos } from '../nucleo/citas.ts'
import * as corte from '../fuentes/jurisprudencia/corte.ts'
import * as gestor from '../fuentes/gestor.ts'
import * as suin from '../fuentes/suin.ts'

export const TITULO = 'Consultar la vigencia de una norma'

export const DESCRIPCION =
  'Devuelve el estado de vigencia de una norma ("Vigente", "Derogado", "Vigencia en Estudio", "Compilado"... tal ' +
  'como lo publica la ficha de SUIN, para leyes y decretos) con un nivel de confianza: alta (la ficha respondió) o ' +
  'baja (no consta, o la fuente no respondió). Una sentencia ("C-337/11") no se consulta en SUIN: se verifica en la ' +
  'relatoría de la Corte Constitucional y se dice si existe. Nunca inventa el estado: si no consta, lo dice y ' +
  'orienta. La respuesta encabeza con la línea de alcance (qué fuente se consultó y cuál no).'

const esquema = z.object({
  cita: z.string().describe('Cita de la norma, ej. "Ley 909 de 2004" o "Decreto 1072 de 2015"'),
})

export const schema = esquema.shape

type Params = z.infer<typeof esquema>

export type VeredictoVigencia = {
  cita: string
  estado: string
  confianza: 'alta' | 'baja'
  url?: string
  explicacion: string
  /** Línea de alcance, cuando la rama consultó fuentes. Va DELANTE de la respuesta. */
  alcance?: string
}

/** Formatea el veredicto. Exportada para testear sin red. */
export function formatear(v: VeredictoVigencia): string {
  return (
    // El alcance va delante: dice a qué se está entrando antes de leer el estado.
    `${v.alcance ? `${v.alcance}\n` : ''}` +
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

  // Una sentencia no se busca en SUIN: allí no hay estado que leer y, con el
  // portal caído, cualquier número salía como "ficha caída" —un fallo de fuente
  // para algo que simplemente no existe—. Va por la relatoría y se para aquí.
  if (c.sentencia && !activa('corte')) {
    return formatear({
      cita,
      estado: 'no consultable en esta instalación',
      confianza: 'baja',
      alcance: alcance([]),
      explicacion: `${avisoApagada('corte')} No se puede afirmar ni negar que la sentencia ${c.sentencia} exista.`,
    })
  }
  if (c.sentencia) return await veredictoSentencia(cita, c.sentencia)

  const r = await gestor.buscar({ tipo: idTipo(c.tipo) ?? c.tipo, numero: c.numero, anio: c.anio })
  const resultadosGestor = r.items.length === 1 ? '1 resultado' : `${r.items.length} resultados`
  if (!c.anio) {
    const ambiguos = candidatosAmbiguos(r.items)
    if (ambiguos.length) {
      return (
        `${alcance([{ clave: 'gestor', detalle: resultadosGestor }])}\n` +
        `La cita «${cita}» es ambigua: el Gestor tiene ${ambiguos.length} normas con ese tipo y número, de años ` +
        `distintos. Repite con el año, por ejemplo «${ambiguos[0]!.titulo}».`
      )
    }
  }

  // SUIN apagado por el operador no es lo mismo que el índice ausente: la
  // capacidad existe y se decidió no usarla, y eso es lo que hay que decir.
  if (!activa('suin')) {
    return formatear({
      cita,
      estado: 'no consultable en esta instalación',
      confianza: 'baja',
      alcance: alcance([{ clave: 'gestor', detalle: resultadosGestor }]),
      explicacion: `${avisoApagada('suin')} SUIN-Juriscol es la única fuente que publica el estado de vigencia, así que no concluyas ni que está vigente ni que está derogada.`,
    })
  }

  // Fuentes de las ramas que sí piden la ficha: el Gestor resolvió la cita y
  // SUIN publica el estado.
  const fuentesSuin = [
    { clave: 'gestor', detalle: resultadosGestor },
    { clave: 'suin', detalle: 'ficha de la norma' },
  ]

  const anio = c.anio ?? r.items[0]?.titulo.match(/\bde\s+(\d{4})\b/i)?.[1]
  let porQueNoConsta = ''
  if (anio) {
    // Una sola vía y una sola confianza: desde el portal nuevo el estado sale
    // del índice de fichas, que ES el campo de la ficha (la Ley 74 de 1923 da
    // "Derogado", como su ficha), y cubre leyes y decretos. La rama de "señal
    // del índice, confianza media" existía porque la vía de las leyes era otro
    // índice que contradecía a la ficha; ya no hay dos vías.
    const f = await suin.ficha(c.tipo, c.numero, anio)
    if (f.ok) {
      return formatear({
        cita,
        estado: f.ficha.estado || 'SUIN no publica el estado de esta norma',
        confianza: 'alta',
        url: f.ficha.url,
        alcance: alcance(fuentesSuin),
        explicacion: `Ficha de SUIN-Juriscol (${f.ficha.subtipo || f.ficha.tipo}), consultada hoy. El estado es el que publica la ficha.`,
      })
    }
    if (f.razon === 'ficha-caida') {
      return formatear({
        cita,
        estado: 'no consta (ficha caída)',
        confianza: 'baja',
        alcance: alcance(fuentesSuin),
        explicacion:
          `La ficha de SUIN-Juriscol no respondió en esta consulta` +
          `${f.detalle ? ` (${f.detalle})` : ''}. Vuelve a intentarlo antes de afirmar nada.`,
      })
    }
    porQueNoConsta = f.detalle ? ` Ojo: ${f.detalle}.` : ''
  }

  return formatear({
    cita,
    estado: 'no consta',
    confianza: 'baja',
    // Sin año no se llegó a pedir ficha: declarar SUIN como consultado sería falso.
    alcance: alcance(anio ? fuentesSuin : [{ clave: 'gestor', detalle: resultadosGestor }]),
    explicacion: anio
      ? 'SUIN-Juriscol no tiene una ficha con ese tipo, número y año. No significa que esté derogada ni vigente: ' +
        `revísalo en el Diario Oficial.${porQueNoConsta}`
      : 'Sin año no se puede pedir la ficha de SUIN-Juriscol: el número solo no identifica la norma. Repite la ' +
        'cita con el año.',
  })
}

/**
 * Veredicto de una cita de sentencia contra la relatoría de la Corte
 * Constitucional. La pregunta no es si está vigente —una providencia no lo está
 * ni deja de estarlo— sino si la relatoría la tiene: `no-existe` es negativa
 * dura y `no-medido` degrada declarando el fallo, para que nadie confunda "no
 * lo tiene" con "no respondió".
 */
async function veredictoSentencia(cita: string, sentencia: string): Promise<string> {
  const v = await corte.verificar(sentencia)
  const sondeos = v.sondeos.length === 1 ? '1 sondeo' : `${v.sondeos.length} sondeos`

  if (v.estado === 'existe') {
    const p = v.providencia
    const fecha = p?.fecha ? ` del ${p.fecha}` : ''
    const expediente = p?.expediente ? ` Expediente ${p.expediente}.` : ''
    return formatear({
      cita,
      estado: 'Existe y está en firme (cosa juzgada)',
      confianza: 'alta',
      ...(p?.url ? { url: p.url } : {}),
      alcance: alcance([{ clave: 'corte', detalle: sondeos }]),
      explicacion:
        `La relatoría de la Corte Constitucional tiene la providencia ${sentencia}${fecha}, y por eso hace ` +
        `tránsito a cosa juzgada. Las sentencias no tienen estado de vigencia, ese es de las normas: lo que se ` +
        `verifica aquí es que la providencia exista.${expediente}`,
    })
  }

  if (v.estado === 'no-existe') {
    const probados = v.sondeos.map((s) => `«${s}»`).join(' y ')
    return formatear({
      cita,
      estado: 'No existe en la relatoría de la Corte Constitucional',
      confianza: 'alta',
      alcance: alcance([{ clave: 'corte', detalle: sondeos }]),
      explicacion:
        `La relatoría de la Corte Constitucional no tiene ninguna providencia con el número ${sentencia}.` +
        `${probados ? ` Se sondeó con ${probados}.` : ''} Ninguna búsqueda dio una coincidencia exacta: ` +
        `comprueba el número o el año de la cita.`,
    })
  }

  // `no-medido`: la relatoría no respondió y nada se probó. Degrada, y no puede
  // parecerse a la negativa dura de arriba.
  return formatear({
    cita,
    estado: 'no se pudo verificar (la relatoría no respondió)',
    confianza: 'baja',
    alcance: alcance([{ clave: 'corte', detalle: 'sin respuesta' }]),
    explicacion:
      `La relatoría de la Corte Constitucional no respondió en esta consulta` +
      `${v.motivo ? ` (${v.motivo})` : ''}. No se puede concluir que la providencia no exista: vuelve a ` +
      `intentarlo antes de afirmar nada.`,
  })
}
