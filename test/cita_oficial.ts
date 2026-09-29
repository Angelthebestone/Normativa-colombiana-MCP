/**
 * Cita canónica de providencias y normas. Sin red: los literales son datos
 * REALES recortados de las respuestas de las fuentes el 2026-09-28 (los mismos
 * que sostienen la tabla del informe del encargo).
 *
 *   node --test test/cita_oficial.ts
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

import {
  citaConsejoEstado,
  citaCorteConstitucional,
  citaCorteSuprema,
  citaNorma,
  fechaLarga,
} from '../src/nucleo/cita_oficial.ts'

test('fechaLarga: ISO, fecha ya en palabras, y el estilo de las normas', () => {
  assert.equal(fechaLarga('2011-05-04'), '4 de mayo de 2011')
  assert.equal(fechaLarga('2026-09-18'), '18 de septiembre de 2026')
  // Como la publica el Gestor en "Fecha de Expedición".
  assert.equal(fechaLarga('23 de septiembre de 2004'), '23 de septiembre de 2004')
  // Como la publica SAMAI: con el día de la semana delante.
  assert.equal(fechaLarga('jueves, 3 de abril de 2009'), '3 de abril de 2009')
  // El estilo de las normas: mes y día, sin año.
  assert.equal(fechaLarga('23 de septiembre de 2004', 'norma'), 'septiembre 23')
  assert.equal(fechaLarga('2011-05-04', 'norma'), 'mayo 4')
  // Lo que no reconoce lo declara vacío en vez de imprimirlo crudo.
  assert.equal(fechaLarga(''), '')
  assert.equal(fechaLarga('no es una fecha'), '')
})

test('Corte Constitucional: el ejemplo del encargo, con la C-337/11 real', () => {
  // Datos reales de la relatoría (buscador, accion=search).
  const r = citaCorteConstitucional({
    sentencia: 'C-337/11',
    fecha: '2011-05-04',
    magistrados: ['Jorge Ignacio Pretelt Chaljub'],
  })
  assert.deepEqual(r, {
    cita: 'Corte Constitucional, Sentencia C-337 de 2011 (M.P. Jorge Ignacio Pretelt Chaljub; 4 de mayo de 2011)',
    faltan: [],
  })
})

test('Corte Constitucional: la ponencia conjunta (SU.508/20) se rotula M.PP.', () => {
  // Real: prov_magistrados trae DOS nombres y el texto dice "Magistrados
  // ponentes: ALBERTO ROJAS RÍOS JOSÉ FERNANDO REYES CUARTAS".
  const r = citaCorteConstitucional({
    sentencia: 'SU.508/20',
    fecha: '2020-12-07',
    magistrados: ['Alberto Rojas Ríos', 'José Fernando Reyes Cuartas'],
  })
  assert.deepEqual(r, {
    cita: 'Corte Constitucional, Sentencia SU-508 de 2020 (M.PP. Alberto Rojas Ríos y José Fernando Reyes Cuartas; 7 de diciembre de 2020)',
    faltan: [],
  })
})

test('Corte Constitucional: un auto real se rotula "Auto", no "Sentencia"', () => {
  const r = citaCorteConstitucional({ sentencia: 'A. 193/22', fecha: '2022-02-24', magistrados: ['Jorge Enrique Ibáñez Najar'] })
  assert.equal(r?.cita, 'Corte Constitucional, Auto 193 de 2022 (M.P. Jorge Enrique Ibáñez Najar; 24 de febrero de 2022)')
})

test('Corte Constitucional: sin ponente la cita sale sin M.P. y faltan lo dice', () => {
  // Real: ultimas(50) devuelve prov_magistrados VACÍO (medido: 0 de 50). Es el
  // caso del endpoint "últimas providencias", no del buscador.
  const r = citaCorteConstitucional({ sentencia: 'T-304/26', fecha: '2026-09-18', magistrados: [] })
  assert.deepEqual(r, { cita: 'Corte Constitucional, Sentencia T-304 de 2026 (18 de septiembre de 2026)', faltan: ['ponente'] })
})

test('Corte Constitucional: sin fecha se omite del paréntesis y se declara', () => {
  const r = citaCorteConstitucional({ sentencia: 'T-304/26', fecha: '', magistrados: [] })
  assert.deepEqual(r, { cita: 'Corte Constitucional, Sentencia T-304 de 2026', faltan: ['ponente', 'fecha'] })
})

test('Corte Constitucional: sin número no hay cita', () => {
  assert.equal(citaCorteConstitucional({ sentencia: '', fecha: '2011-05-04', magistrados: [] }), null)
})

test('Consejo de Estado: radicado con guiones, ponente en versal y sin fecha', () => {
  // Real: fila de SAMAI. El radicado se segmenta 5-2-2-3-4-5-2, como lo imprime
  // el propio documento ("11001-03-26-000-2023-00093-00").
  const r = citaConsejoEstado({
    radicado: '11001032600020230009300',
    ponente: 'MARIA ADRIANA MARIN',
    sala: 'Sección Tercera (Subsección A)',
  })
  assert.deepEqual(r, {
    cita: 'Consejo de Estado, Sala de lo Contencioso Administrativo, Sección Tercera (Subsección A), Rad. 11001-03-26-000-2023-00093-00 (C.P. Maria Adriana Marin)',
    faltan: ['fecha del fallo (SAMAI publica la del proceso, no la de la providencia)'],
  })
})

test('Consejo de Estado: la versal se pasa a capitalización de título, sin inventar tildes', () => {
  const r = citaConsejoEstado({
    radicado: '11001032400020090014300',
    ponente: 'PABLO ANDRÉS CÓRDOBA ACOSTA',
    sala: 'Sección Primera',
  })
  assert.equal(
    r?.cita,
    'Consejo de Estado, Sala de lo Contencioso Administrativo, Sección Primera, Rad. 11001-03-24-000-2009-00143-00 (C.P. Pablo Andrés Córdoba Acosta)',
  )
})

test('Consejo de Estado: sin ponente y sin sala se declaran ambos', () => {
  const r = citaConsejoEstado({ radicado: '25000233600020190068201', ponente: '', sala: '' })
  assert.deepEqual(r, {
    cita: 'Consejo de Estado, Sala de lo Contencioso Administrativo, Rad. 25000-23-36-000-2019-00682-01',
    faltan: ['sala', 'ponente', 'fecha del fallo (SAMAI publica la del proceso, no la de la providencia)'],
  })
})

test('Consejo de Estado: un radicado que no tiene 23 dígitos se deja como viene', () => {
  assert.equal(citaConsejoEstado({ radicado: '12345', ponente: 'X', sala: 'Sección Cuarta' })?.cita.includes('Rad. 12345'), true)
})

test('Consejo de Estado: sin radicado no hay cita', () => {
  assert.equal(citaConsejoEstado({ radicado: '', ponente: 'X', sala: 'Sección Tercera' }), null)
})

test('Corte Suprema: la tutela STL2503-2025, con la sala de casación leída de la ruta', () => {
  // Real: sala="Tutelas" es la pestaña; la sala que decide va en la ruta
  // ("…/Index/TUTELAS/LABORAL/…") → Sala de Casación Laboral.
  const r = citaCorteSuprema({
    titulo: 'STL2503-2025',
    sala: 'Tutelas',
    clase: 'SENTENCIA',
    magistrado: 'Marjorie Zúñiga Romero',
    anio: 2025,
    ruta: '/var/www/html/Index/TUTELAS/LABORAL/2025/Dra. Marjorie Zúñiga Romero/Sentencias/STL2503-2025.docx',
  })
  assert.deepEqual(r, {
    cita: 'Corte Suprema de Justicia, Sala de Casación Laboral, Sentencia STL2503-2025 (M.P. Marjorie Zúñiga Romero; 2025)',
    faltan: ['día y mes del fallo (la fuente solo publica el año)'],
  })
})

test('Corte Suprema: un auto real, con el título tal cual lo publica su índice', () => {
  const r = citaCorteSuprema({
    titulo: 'AC4729-2024 [2024-01302-00]',
    sala: 'Civil',
    clase: 'AUTO',
    magistrado: 'Martha Patricia Guzmán Álvarez',
    anio: 2024,
    ruta: '/var/www/html/Index/CIVIL/2024/Dra. Martha Patricia Guzmán Álvarez/8.- Agosto/Autos/AC4729-2024 [2024-01302-00].docx',
  })
  assert.equal(
    r?.cita,
    'Corte Suprema de Justicia, Sala de Casación Civil, Auto AC4729-2024 [2024-01302-00] (M.P. Martha Patricia Guzmán Álvarez; 2024)',
  )
})

test('Corte Suprema: sin clase, sin ponente y sin sala determinable se declaran', () => {
  const r = citaCorteSuprema({
    titulo: '29342(16-04-08)',
    sala: 'Penal',
    clase: '',
    magistrado: '',
    anio: 2008,
    ruta: '/var/www/html/Index/PENAL/2008/29342(16-04-08).pdf',
  })
  // La ruta sí da la sala aquí; lo que falta es tipo, ponente y día/mes.
  assert.deepEqual(r, {
    cita: 'Corte Suprema de Justicia, Sala de Casación Penal, 29342(16-04-08) (2008)',
    faltan: ['tipo (sentencia o auto)', 'ponente', 'día y mes del fallo (la fuente solo publica el año)'],
  })
})

test('Corte Suprema: sin sala determinable se omite y se declara', () => {
  const r = citaCorteSuprema({ titulo: 'AL1285-2022', sala: 'Tutelas', clase: 'AUTO', magistrado: 'X', anio: 2022, ruta: '' })
  assert.equal(r?.cita, 'Corte Suprema de Justicia, Auto AL1285-2022 (M.P. X; 2022)')
  assert.ok(r?.faltan.includes('sala'))
})

test('Corte Suprema: sin título no hay cita', () => {
  assert.equal(citaCorteSuprema({ titulo: '', sala: 'Civil', clase: 'AUTO', magistrado: 'X', anio: 2024, ruta: '' }), null)
})

test('Norma: la Ley 909 de 2004 con su fecha y su Diario Oficial reales', () => {
  // Real: obtenerNorma(14861). Título "Ley 909 de 2004"; ficha con "Fecha de
  // Expedición" y "Medio de Publicación: Diario Oficial 45.680…".
  const r = citaNorma({
    titulo: 'Ley 909 de 2004',
    fechas: {
      'Fecha de Expedición': '23 de septiembre de 2004',
      'Medio de Publicación': 'Diario Oficial 45.680 de septiembre 23 de 2004',
    },
  })
  assert.deepEqual(r, { cita: 'Ley 909 de 2004 (septiembre 23), Diario Oficial No. 45.680', faltan: ['entidad expedidora'] })
})

test('Norma: sin Diario Oficial en la ficha, la cita se queda en lo que consta', () => {
  // Real: obtenerNorma(62866), Decreto 1083 de 2015 (ficha sin Medio de Publicación).
  const r = citaNorma({
    titulo: 'Decreto 1083 de 2015 Sector de Función Pública',
    fechas: { 'Fecha de Expedición': '26 de mayo de 2015', 'Medio de Publicación': '' },
  })
  assert.deepEqual(r, {
    cita: 'Decreto 1083 de 2015 (mayo 26)',
    faltan: ['entidad expedidora', 'Diario Oficial'],
  })
})

test('Norma: un "Decreto Ley" y un número de Diario Oficial sin puntos', () => {
  const r = citaNorma({
    titulo: 'Decreto Ley 2739 de 2012',
    fechas: { 'Fecha de Expedición': '28 de diciembre de 2012', 'Medio de Publicación': 'Diario Oficial 48657 de diciembre 28 de 2012.' },
  })
  assert.equal(r?.cita, 'Decreto Ley 2739 de 2012 (diciembre 28), Diario Oficial No. 48657')
})

test('Norma: el doble espacio del Medio de Publicación no rompe la lectura', () => {
  // Real: obtenerNorma(41249), Ley 1437 de 2011: "Diario Oficial 47.956 de  enero 18 de 2011".
  const r = citaNorma({
    titulo: 'Ley 1437 de 2011',
    fechas: { 'Fecha de Expedición': '18 de enero de 2011', 'Medio de Publicación': 'Diario Oficial 47.956 de  enero 18 de 2011' },
  })
  assert.equal(r?.cita, 'Ley 1437 de 2011 (enero 18), Diario Oficial No. 47.956')
})

test('Norma: sin título no hay cita', () => {
  assert.equal(citaNorma({ titulo: '', fechas: {} }), null)
})
