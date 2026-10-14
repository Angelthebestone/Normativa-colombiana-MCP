import { activa, avisoApagada } from '../../nucleo/alcance.ts'
import { citaCorteConstitucional } from '../../nucleo/cita_oficial/index.ts'
import * as corte from '../../fuentes/jurisprudencia/corte/index.ts'
import { sinNorma, type Resuelta } from './resuelta.ts'

/** La línea de cita judicial ya compuesta, con lo que la relatoría no da declarado (nada se inventa). */
function citaOficial(p: Parameters<typeof citaCorteConstitucional>[0]): string {
  const c = citaCorteConstitucional(p)
  return c ? `Cita oficial: ${c.cita}${c.faltan.length ? ` (no consta: ${c.faltan.join(', ')})` : ''}` : ''
}

/**
 * Una sentencia de la Corte se resuelve contra su relatoría, que está al día.
 * Devuelve null cuando la relatoría la da por existente sin la providencia: la
 * cita sigue entonces su camino normal.
 */
export async function resolverSentencia(cita: string, sentencia: string): Promise<Resuelta | null> {
  // Las sentencias de la Corte se resuelven contra su relatoría, que está al día.
  // Con la Corte apagada no se cae al Gestor —que no publica sentencias— para
  // salir por un «no encontré» que se leería como «no existe».
  if (!activa('corte')) {
    return sinNorma(
      cita,
      [],
      `${avisoApagada('corte')} Por eso no se puede ni afirmar ni negar que exista la sentencia ${sentencia}.`,
    )
  }
  const v = await corte.verificar(sentencia)
  if (v.estado === 'existe' && v.providencia) {
    const p = v.providencia
    const titulo = `${p.sentencia} (${p.tipo}) — Corte Constitucional`
    return {
      cita,
      clave: `corte:${p.sentencia}`,
      titulo,
      usos: [{ clave: 'corte', detalle: 'providencia verificada por su número' }],
      avisos: [],
      ficha: [
        titulo,
        `Fecha: ${p.fecha} · Publicación: ${p.publicacion} · Expediente: ${p.expediente}`,
        // El campo de la relatoría es el PONENTE, no la Sala (medido: 238 de 240 aciertos traen un solo nombre).
        p.magistrados.length ? `Ponente${p.magistrados.length > 1 ? 's' : ''} (según la relatoría): ${p.magistrados.join(', ')}` : '',
        citaOficial(p),
        p.tema ? `Tema: ${p.tema}` : '',
        p.sintesis ? `Síntesis: ${p.sintesis}` : '',
        `Texto completo: usa obtener_documento con fuente="corte" y ruta="${p.ruta}"`,
        `URL: ${p.url}`,
      ]
        .filter(Boolean)
        .join('\n'),
      articulos: [],
    }
  }
  /**
   * Negativa firme. Antes, una sentencia que la relatoría no tiene caía a la
   * rama del Gestor —que no publica sentencias— y salía por el "No encontré la
   * cita", que obliga a quien pregunta a decidir entre "no existe" y "no supe
   * buscarla". Con el número sondeado en las dos formas que la relatoría indexa
   * (medido el 2026-09-16: las C y las T casan con guion, las SU solo sin él),
   * la ausencia ya es un dato.
   */
  if (v.estado === 'no-existe') {
    return sinNorma(
      cita,
      [{ clave: 'corte', detalle: `sondeada con ${v.sondeos.map((s) => `«${s}»`).join(' y ')}` }],
      `No existe ninguna providencia con el número ${sentencia} en la relatoría de la Corte Constitucional.\n\n` +
        `Se buscó por el NÚMERO, no por el contenido, así que esto no dice nada sobre si hay una sentencia ` +
        `parecida: para eso, buscar_jurisprudencia por materia.`,
    )
  }
  if (v.estado === 'no-medido') {
    return sinNorma(
      cita,
      [{ clave: 'corte', detalle: 'no respondió' }],
      `No pude comprobar la sentencia ${sentencia} contra la relatoría de la Corte Constitucional: ` +
        `${v.motivo ?? 'la fuente no respondió'}.\n\n` +
        `Esto NO significa que no exista —significa que no se pudo comprobar—. Vuelve a intentarlo, o búscala ` +
        `por materia con buscar_jurisprudencia.`,
    )
  }
  return null
}
