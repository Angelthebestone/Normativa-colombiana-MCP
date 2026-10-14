import type { Copias } from '../cache/copias.ts'
import { crearPedirBytes } from './bytes.ts'
import { crearDisyuntor } from './disyuntor.ts'
import { crearMetricas } from './metricas.ts'
import { crearPedir } from './pedir.ts'
import { crearReintento } from './reintento.ts'
import { crearRitmo } from './ritmo.ts'

/**
 * Una instancia de red: todo el estado del transporte junto —ritmo y colas por
 * dominio, interruptores, contadores, peticiones en vuelo— y las copias de
 * documento que se le pasan. Dos instancias no se ven entre sí.
 */
export function crearRed({ copias }: { copias: Copias }) {
  const ritmo = crearRitmo()
  const disyuntor = crearDisyuntor()
  const metricas = crearMetricas()
  const reintento = crearReintento({ ritmo, disyuntor })
  const { pedir, pedirJson } = crearPedir({ copias, disyuntor, metricas, reintento })
  const pedirBytes = crearPedirBytes({ disyuntor, metricas, reintento })
  return { pedir, pedirJson, pedirBytes, ...ritmo, ...disyuntor, ...metricas }
}

export type Red = ReturnType<typeof crearRed>
