/**
 * Relatoría de la Corte Constitucional.
 *
 * API JSON no documentada, descubierta leyendo los bundles de Angular del
 * propio sitio (el objeto de entorno y la construcción de la consulta estaban
 * en texto plano). Devuelve la respuesta cruda de Elasticsearch, así que aquí
 * no hay HTML que parsear ni canario frágil: solo el troceado del texto.
 *
 * TLS: www.corteconstitucional.gov.co presenta su hoja sin enviar el
 * intermedio "Go Daddy Secure Certificate Authority - G2", y Node responde
 * "unable to verify the first certificate" aunque la relatoría está en línea
 * y los navegadores conectan sin problema. Se resolvió como ya hacía este MCP
 * para funcionpublica.gov.co, suin-juriscol.gov.co y sic.gov.co: se añadió el
 * intermedio (`GODADDY_G2` en ca.ts, bajado de la extensión AIA del propio
 * certificado) a la lista de CA que usa `pedir()`. La verificación sigue
 * activa; solo se completó una cadena que el servidor manda incompleta.
 *
 * Cubre lo que al Gestor Normativo le falta: en el Gestor hay 3 sentencias de
 * 2024; aquí el índice Elasticsearch declara 44.839 providencias (medido el
 * 2026-09-03 contra el propio buscador) e incluye fallos de 2026 publicados
 * en septiembre del mismo año, así que la actualización es continua.
 */
export { normalizarTipo, type Providencia, type TipoProvidencia } from './providencia.ts'
export { buscar, ultimas } from './busqueda.ts'
export { NoExisteProvidencia, obtenerTexto } from './texto.ts'
export { porSentencia, verificar, type VerificacionSentencia } from './verificacion.ts'
