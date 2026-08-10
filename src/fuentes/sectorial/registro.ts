/**
 * Alta de los reguladores sectoriales de forma común.
 *
 * El orden de este fichero es el que ve quien consulta, así que va por sector y
 * no por orden alfabético: primero el sector primario, luego el secundario, el
 * terciario y el transversal.
 *
 * Añadir una entidad es añadir un fichero al lado y una línea aquí. Cada fuente
 * declara además cinco campos de metadatos (dominioPermitido, tiposDocumento,
 * soportaTexto, soportaVigencia y pruebasMinimas) que `registrar()` valida antes
 * de dar de alta. Lo que NO se puede añadir en silencio es una fuente sin
 * `advertencia`: el contrato la exige porque es lo que impide que un vacío se
 * lea como «esa norma no existe».
 */
import { registrar } from '../sectorial.ts'

import minagricultura from './minagricultura.ts'
import ica from './ica.ts'
import anm from './anm.ts'
import ant from './ant.ts'
import supersociedades from './supersociedades.ts'
import sic from './sic.ts'
import supersalud from './supersalud.ts'
import invima from './invima.ts'
import superfinanciera from './superfinanciera.ts'
import mintrabajo from './mintrabajo.ts'
import supertransporte from './supertransporte.ts'
import parques from './parques.ts'
import unidadvictimas from './unidadvictimas.ts'

registrar(
  // Primario: agropecuario y extractivo
  minagricultura,
  ica,
  anm,
  ant,
  // Secundario y terciario: industria, comercio, consumo y servicios
  supersociedades,
  sic,
  invima,
  superfinanciera,
  supersalud,
  // Transversales: trabajo, transporte, víctimas y ambiente
  mintrabajo,
  supertransporte,
  unidadvictimas,
  parques,
)
