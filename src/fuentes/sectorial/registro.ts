/**
 * Alta de los reguladores sectoriales de forma común.
 *
 * El orden de este fichero es el que ve quien consulta, así que va por sector y
 * no por orden alfabético: primero el sector primario, luego el secundario, el
 * terciario y el transversal.
 *
 * Añadir una entidad es añadir una línea aquí y un fichero al lado. Lo que NO se
 * puede añadir en silencio es una fuente sin `advertencia`: el contrato la exige
 * porque es lo que impide que un vacío se lea como «esa norma no existe».
 */
import { registrar } from '../sectorial.ts'

import minagricultura from './minagricultura.ts'
import ica from './ica.ts'
import anm from './anm.ts'
import supersociedades from './supersociedades.ts'
import sic from './sic.ts'
import invima from './invima.ts'
import superfinanciera from './superfinanciera.ts'
import mintrabajo from './mintrabajo.ts'
import supertransporte from './supertransporte.ts'
import parques from './parques.ts'

registrar(
  // Primario: agropecuario y extractivo
  minagricultura,
  ica,
  anm,
  // Secundario y terciario: industria, comercio, consumo y servicios
  supersociedades,
  sic,
  invima,
  superfinanciera,
  // Transversales: trabajo, transporte y ambiente
  mintrabajo,
  supertransporte,
  parques,
)
