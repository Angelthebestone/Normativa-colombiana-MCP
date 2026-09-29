/**
 * `linea_jurisprudencial`: el formateo y los caminos de error se prueban sin red
 * con `deps` inyectables; la consulta real a la relatoría va al final, saltable
 * con SIN_RED=1.
 *
 *   node --test test/linea_jurisprudencial.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  citantesDe,
  escribir,
  formatearLinea,
  ordenarCitantes,
  type Citaciones,
} from '../src/herramientas/linea_jurisprudencial.ts'
import type { Providencia, VerificacionSentencia } from '../src/fuentes/jurisprudencia/corte.ts'

const BASE: Providencia = {
  id: '2204',
  sentencia: 'C-337/11',
  tipo: 'Constitucionalidad',
  fecha: '2011-05-04',
  publicacion: '2011-06-02',
  tema: 'TELETRABAJO. PROTECCIÓN INTEGRAL EN MATERIA DE SEGURIDAD SOCIAL DEL TELETRABAJADOR',
  sintesis: 'La protección del teletrabajador debe incluir el sistema del subsidio familiar.',
  magistrados: ['Jorge Ignacio Pretelt Chaljub'],
  expediente: 'D-8305',
  ruta: '2011/C-337-11.htm',
  url: 'https://www.corteconstitucional.gov.co/relatoria/2011/C-337-11.htm',
}

const cita = (sentencia: string, tipo: string, fecha: string, ruta: string) => ({
  sentencia,
  tipo,
  fecha,
  tema: `Tema de ${sentencia}`,
  ruta,
  url: `https://www.corteconstitucional.gov.co/relatoria/${ruta}`,
})

const CITANTES: Citaciones = {
  total: 4,
  items: [
    cita('T-139/13', 'Tutela', '2013-03-14', '2013/T-139-13.htm'),
    cita('A. 950/26', 'Auto', '2026-07-15', '2026/A-950-26.htm'),
    cita('C-063/26', 'Constitucionalidad', '2026-03-25', '2026/C-063-26.htm'),
    cita('SU.425/25', 'Sentencia de unificación', '2025-06-12', '2025/SU425-25.htm'),
  ],
}

test('el orden pone las SU y las C en cabeza, y dentro de cada grupo la más reciente primero', () => {
  const s = ordenarCitantes(CITANTES.items).map((c) => c.sentencia)
  assert.deepEqual(s, ['SU.425/25', 'C-063/26', 'A. 950/26', 'T-139/13'])
})

test('la respuesta identifica la sentencia base y lista los citantes con ruta y enlace', () => {
  const s = formatearLinea(BASE, CITANTES, 20)
  assert.match(s, /C-337\/11 — Constitucionalidad, 2011-05-04/)
  assert.match(s, /Ponente\(s\): Jorge Ignacio Pretelt Chaljub/)
  assert.match(s, /ruta: 2011\/C-337-11\.htm/)
  assert.match(s, /La relatoría registra 4 providencia\(s\) que la citan; se muestran 4/)
  assert.match(s, /- SU\.425\/25 \(Sentencia de unificación, 2025-06-12\)/)
  assert.match(s, /ruta: 2025\/SU425-25\.htm/)
  assert.match(s, /https:\/\/www\.corteconstitucional\.gov\.co\/relatoria\/2025\/SU425-25\.htm/)
  const iSU = s.indexOf('SU.425/25')
  const iC = s.indexOf('C-063/26')
  const iA = s.indexOf('A. 950/26')
  assert.ok(iSU < iC && iC < iA, 'SU y C deben ir en cabeza')
})

test('las advertencias viajan siempre: cita no es reiteración, puede faltar lista y la SU no se deduce', () => {
  for (const s of [formatearLinea(BASE, CITANTES, 20), formatearLinea(BASE, { total: 0, items: [] }, 20)]) {
    assert.match(s, /NO es que la reitere ni que la respete/)
    assert.match(s, /puede estar incompleta/)
    assert.match(s, /NO se puede deducir de esta lista/)
  }
})

test('el tope se pagina con limite y lo que queda se declara', () => {
  const muchos: Citaciones = {
    total: 25,
    items: Array.from({ length: 25 }, (_, i) => cita(`T-${100 + i}/20`, 'Tutela', `2020-01-${String((i % 28) + 1).padStart(2, '0')}`, `2020/T-${100 + i}-20.htm`)),
  }
  const s = formatearLinea(BASE, muchos, 20)
  assert.match(s, /se muestran 20/)
  assert.match(s, /Quedan 5: repite con limite=25/)
  const s2 = formatearLinea(BASE, muchos, 100)
  assert.match(s2, /se muestran 25/)
  assert.doesNotMatch(s2, /Quedan/)
})

test('con 100 en el conteo se avisa del tope del portal', () => {
  const cien: Citaciones = {
    total: 100,
    items: Array.from({ length: 100 }, (_, i) => cita(`A. ${i}/26`, 'Auto', '2026-01-01', `2026/A-${i}-26.htm`)),
  }
  const s = formatearLinea(BASE, cien, 20)
  assert.match(s, /El portal topa su relación en 100/)
  assert.match(s, /repite con limite=100/)
})

test('sin citantes registrados se dice sin afirmar que nadie la mencionó', () => {
  const s = formatearLinea(BASE, { total: 0, items: [] }, 20)
  assert.match(s, /no registra providencias que la citen/)
  assert.match(s, /no prueba que nadie la haya mencionado/)
})

test('escribir: una sentencia que no está en la relatoría se declara con sus sondeos y sin consultar la ficha', async () => {
  let fichas = 0
  const deps = {
    identificar: async (s: string): Promise<VerificacionSentencia> => ({ estado: 'no-existe', sondeos: [s, s.replace(/-/g, '')] }),
    citantes: async (): Promise<Citaciones> => {
      fichas += 1
      return CITANTES
    },
  }
  const s = await escribir({ sentencia: 'C-999/99', limite: 20 }, deps)
  assert.match(s, /No encontré «C-999\/99» en la relatoría \(probé: C-999\/99, C999\/99\)/)
  assert.match(s, /búscala con buscar_jurisprudencia/)
  assert.equal(fichas, 0)
})

test('escribir: un fallo de la fuente es FALLO, no negativa', async () => {
  const deps = {
    identificar: async (): Promise<VerificacionSentencia> => ({ estado: 'no-medido', sondeos: [], motivo: 'tiempo de espera agotado tras 60000 ms' }),
    citantes: async (): Promise<Citaciones> => CITANTES,
  }
  const s = await escribir({ sentencia: 'C-337/11', limite: 20 }, deps)
  assert.match(s, /Es un FALLO de la fuente, no una negativa/)
  assert.match(s, /tiempo de espera agotado/)
  assert.match(s, /\(falló\)/)
})

test('escribir: el camino feliz usa el id de la sentencia y declara el conteo', async () => {
  const ids: string[] = []
  const deps = {
    identificar: async (): Promise<VerificacionSentencia> => ({ estado: 'existe', providencia: BASE, sondeos: ['C-337/11'] }),
    citantes: async (provId: string): Promise<Citaciones> => {
      ids.push(provId)
      return CITANTES
    },
  }
  const s = await escribir({ sentencia: 'C-337/11', limite: 2 }, deps)
  assert.deepEqual(ids, ['2204'])
  assert.match(s, /Alcance: consulté Corte Constitucional \(4 citante\(s\)\)/)
  assert.match(s, /se muestran 2/)
  assert.match(s, /Quedan 2: repite con limite=4/)
})

// --- red (se salta con SIN_RED=1) -----------------------------------------

const RED = { timeout: 240_000, skip: process.env['SIN_RED'] ? 'requiere red (SIN_RED=1)' : false }

test('RED: C-337/11 y SU-371/21 traen los citantes que la ficha de la relatoría registra', RED, async () => {
  const s = await escribir({ sentencia: 'C-337/11', limite: 100 })
  assert.match(s, /La relatoría registra \d+ providencia\(s\) que la citan; se muestran /)
  // Los citantes traen ruta utilizable por obtener_documento y un tipo real.
  assert.match(s, /\n- (SU|C|T|A)[-.\s]*\d{1,4}[./-]\d{2} \((Constitucionalidad|Tutela|Sentencia de unificación|Auto)/)
  assert.match(s, /ruta: \d{4}\/[A-Z]/)

  // SU-371/21 es el caso que el buscador de texto completo no podía resolver
  // (9 de sus 10 primeros aciertos eran autos de seguimiento sin mención).
  const su = await escribir({ sentencia: 'SU-371/21', limite: 100 })
  assert.match(su, /SU[.\s]?371\/21 — Sentencia de unificación, 2021-10-27/)
  assert.match(su, /La relatoría registra [1-9]\d* providencia\(s\) que la citan/)

  // C-331/23 no resuelve con los sondeos de corte.verificar; el respaldo de la
  // forma hablada («C-331 de 2023») la encuentra y la herramienta lo declara.
  const c331 = await escribir({ sentencia: 'C-331/23', limite: 100 })
  assert.match(c331, /C-331\/23 — Constitucionalidad, 2023-08-29/)
  assert.doesNotMatch(c331, /No encontré/)

  // Un prov_id inexistente devuelve alerta HTML: se declara, no se lee como "nadie la cita".
  await assert.rejects(() => citantesDe('999999999'), /no devolvió la relación de citaciones/)
})
