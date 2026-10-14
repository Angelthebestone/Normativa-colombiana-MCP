/**
 * Cita canónica de providencias y normas, precalculada a partir de los campos
 * que cada fuente ya trae. La cita viaja ya compuesta en la respuesta, para que
 * el modelo no la arme y no pueda equivocar el ponente, la fecha ni el radicado.
 *
 * Regla que gobierna todo el módulo: NADA SE INVENTA NI SE DEDUCE. Cada
 * componente sale de un campo de la fuente; el que no conste se OMITE de la
 * cita y se declara en `faltan`. Se devuelve `null` solo cuando no hay ni
 * identificador.
 *
 * Antes de rotular un campo se midió qué es de verdad (2026-09-28, contra las
 * fuentes reales; el detalle numérico va en el informe del encargo):
 *
 * - Corte Constitucional: `prov_magistrados` es el PONENTE, no la Sala. De 240
 *   aciertos de búsqueda, 238 traían un solo nombre y 2 dos (ponencias
 *   conjuntas), y el texto de la providencia declara «Magistrado ponente:» con
 *   ese mismo nombre (C-117/26, T-287/26, C-337/11…). OJO: el endpoint de
 *   `ultimas` NO trae `prov_magistrados` (0 de 50), solo el buscador.
 * - Consejo de Estado: `fecha` (LblFECHAPROC) es la fecha del PROCESO, no la de
 *   la providencia —cinco casos con las dos legibles arrojaron fechas
 *   distintas (p. ej. 2022-10-06 frente a 2026-02-23)—, así que no se usa.
 *   `sala` sí trae la Sección ("Sección Tercera (Subsección C)").
 * - Corte Suprema: `magistrado` es el ponente, pero `fecha` (fechaCreacion) es
 *   la de CARGA del índice, no la del fallo (STL2503-2025: campo 2025-02-27,
 *   providencia 2025-02-12); el año fiable es `anio`. `sala` es la pestaña
 *   consultada, no la sala de casación (que va en `ruta`).
 * - Gestor: la ficha trae "Fecha de Expedición" y "Medio de Publicación"
 *   (Diario Oficial), que sí se usan. La entidad expedidora solo consta en la
 *   prosa del encabezado y su forma cambia demasiado, así que se omite.
 */
export type { Cita } from './componentes.ts'
export { fechaLarga } from './fecha.ts'
export { citaCorteConstitucional, type DatosCorteConstitucional } from './corte_constitucional.ts'
export { citaConsejoEstado, type DatosConsejoEstado } from './consejo_estado.ts'
export { citaCorteSuprema, type DatosCorteSuprema } from './corte_suprema.ts'
export { citaNorma, type DatosNorma } from './norma.ts'
