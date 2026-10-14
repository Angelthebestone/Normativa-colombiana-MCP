import { BASE_GESTOR, type Resultado } from '../../nucleo/parse/gestor.ts'
import { CanarioError } from '../../nucleo/parse/errores.ts'
import { traer } from './portal.ts'

// ponytail: `conceptosfp.php` son 10,7 MB sin búsqueda en servidor, así que se
// baja una vez y se filtra localmente. Alternativa más barata que ya cubre casi
// todo: buscar_normas con tipo_documento "Concepto".
let cacheConceptos: { cuando: number; items: Resultado[] } | null = null
const TTL_CONCEPTOS = 7 * 24 * 3600 * 1000

/**
 * El listado solo trae número y año ("Concepto 036201 de 2024"): no hay materia
 * en el título, así que aquí NO se puede buscar por tema. Filtrar por asunto
 * devolvería siempre cero y eso se leería como "no existen conceptos sobre
 * esto", que es justo la confusión que hay que evitar. Para buscar por materia,
 * `buscar` con tipo Concepto (7), que sí consulta los restrictores.
 */
export async function conceptosFp(numero?: string | number, anio?: string | number, limite = 20, desde = 0) {
  if (!cacheConceptos || Date.now() - cacheConceptos.cuando > TTL_CONCEPTOS) {
    const html = await traer(`${BASE_GESTOR}/conceptosfp.php`)
    const items = [...html.matchAll(/norma\.php\?i=(\d+)"[^>]*>([^<]+)</g)].map((m) => ({
      id: m[1]!,
      titulo: m[2]!.trim(),
      resumen: '',
      url: `${BASE_GESTOR}/norma.php?i=${m[1]}`,
    }))
    if (items.length < 100) throw new CanarioError(`la lista de conceptos trae ${items.length} entradas`)
    cacheConceptos = { cuando: Date.now(), items }
  }
  const num = numero ? String(numero).replace(/\D/g, '') : ''
  const a = anio ? String(anio) : ''
  const filtrados = cacheConceptos.items.filter(
    (c) => (!num || c.titulo.includes(num)) && (!a || c.titulo.includes(a)),
  )
  return { total: filtrados.length, desde, items: filtrados.slice(desde, desde + limite) }
}
