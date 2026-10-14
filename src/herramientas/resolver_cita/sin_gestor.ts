import { activa, avisoApagada } from '../../nucleo/alcance.ts'
import type { Cita } from '../../nucleo/citas/index.ts'
import { equivalencia, referencia as refCodigo, type Codigo } from '../../nucleo/codigos.ts'
import * as suin from '../../fuentes/suin/index.ts'
import { bloqueArticulo } from './norma_gestor.ts'
import { sinNorma, type Resuelta } from './resuelta.ts'

/** Menos caracteres que esto no es un articulado: es una página vacía. */
const TEXTO_MINIMO = 200

export type EntradaSinGestor = {
  cita: string
  c: Cita
  porCodigo: Codigo | undefined
  articuloIgnorado: string
  pedidos: string[]
  otroTipo: string
  fichaSuin: typeof suin.ficha
  documentoSuin: typeof suin.documento
}

/** Los artículos pedidos leídos del texto de SUIN, o el motivo por el que no se pudo leer. */
async function leerArticulos(
  documentoSuin: typeof suin.documento,
  id: string,
  pedidos: string[],
): Promise<{ articulos: string[]; problema: string }> {
  if (!pedidos.length) return { articulos: [], problema: '' }
  try {
    const d = await documentoSuin(id)
    if (d && d.texto.length >= TEXTO_MINIMO) return { articulos: pedidos.map((num) => bloqueArticulo(d.texto, num, 'suin')), problema: '' }
    return { articulos: [], problema: `SUIN-Juriscol no devolvió el texto del documento ${id}: el artículo no se pudo leer.` }
  } catch (e) {
    return { articulos: [], problema: `No se pudo leer el texto en SUIN-Juriscol (${(e as Error).message}): vuelve a intentarlo.` }
  }
}

/**
 * El Gestor no tiene la norma. Que no la tenga no significa que no exista: su
 * corpus no cubre todo el país, así que antes de decir «no encontré» se
 * pregunta a SUIN, que sí la puede registrar.
 */
export async function resolverSinGestor(e: EntradaSinGestor): Promise<Resuelta> {
  const { cita, c, porCodigo, articuloIgnorado, pedidos, otroTipo, fichaSuin, documentoSuin } = e
  // Sin norma resuelta no hay título oficial: la equivalencia sale de la tabla.
  const avisos = [porCodigo ? equivalencia(porCodigo, refCodigo(porCodigo)) : '', articuloIgnorado]
  // Que el Gestor no la tenga no significa que no exista: su corpus no
  // cubre todo el país. Antes de decir "no encontré" —que se lee como "esa
  // norma no existe"— se pregunta a SUIN, que sí la puede registrar.
  const f = c.anio && activa('suin') ? await fichaSuin(c.tipo, c.numero, c.anio) : null
  if (f?.ok) {
    const v = f.ficha
    // SUIN vuelve a servir el texto (desde octubre de 2026): el artículo pedido sale de ahí.
    const lectura = await leerArticulos(documentoSuin, v.id, pedidos)
    return {
      cita,
      clave: `suin:${v.id}`,
      titulo: `${v.tipo} ${v.numero} de ${v.anio}`,
      usos: [
        { clave: 'gestor', detalle: '0 documentos' },
        { clave: 'suin', detalle: lectura.articulos.length ? 'ficha y texto' : 'ficha encontrada' },
      ],
      avisos,
      ficha:
        `${cita} no está en el Gestor Normativo de Función Pública, pero SUIN-Juriscol sí la registra.\n` +
        (v.epigrafe ? `${v.epigrafe}\n` : '') +
        `Estado de vigencia según SUIN-Juriscol (ficha consultada hoy): ${v.estado || 'SUIN no publica el estado de esta norma'}\n` +
        `URL: ${v.url}\n` +
        (lectura.problema ? `\n${lectura.problema}\n` : '') +
        `\nSiguiente paso: ${pedidos.length ? 'la norma completa, con su resumen de modificaciones y de jurisprudencia' : 'el articulado'}, ` +
        `con obtener_documento con fuente="suin", id="${v.id}".`,
      articulos: lectura.articulos,
    }
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
