/**
 * `npm run salud` — healthcheck INTERNO de los portales que consulta este MCP.
 *
 * No es una herramienta MCP: es un diagnóstico para quien mantiene el proyecto.
 * Cuando una consulta falla, esto responde de un vistazo si el problema es la
 * conexión, el MCP o el portal concreto, con el motivo literal.
 *
 * Sondea en paralelo una URL LIGERA por portal con un límite de 2 s; lo que no
 * conteste en ese plazo se reintenta UNA vez con 6 s (no se da por caído lo que
 * solo es lento). Todo pasa por `pedir` (`src/nucleo/http.ts`), que trae la
 * cadena de certificados: un `fetch` directo daría falsos «TLS roto» en la
 * Corte, la SIC, SUIN y Función Pública.
 *
 * Uso:
 *   node scripts/salud.ts                 # sondea los portales del código
 *   node scripts/salud.ts <url> [<url>…]  # sondea además esas URLs ad-hoc
 *   node scripts/salud.ts --detalle       # añade la nota de cada portal
 *
 * Sale con código 0 si todo está OK o LENTO, y 1 si algo está CAÍDO o sirve una
 * página de error (útil en CI).
 *
 * Medir sin distorsión: `pedir` trae un *breaker* por dominio y un reintento
 * por 429/503. El breaker se neutraliza con `restablecer(host)` antes y después
 * de cada sondeo (una sonda suelta nunca llega a los 3 fallos que lo disparan;
 * restablecer elimina cualquier estado previo del proceso). El reintento por
 * 429/503 NO se puede desactivar con `OpcionesPedir`: un portal que responda
 * 429/503 tardará ~2 s de más en reconocerlo. Es la única costura que queda y
 * vive en `http.ts`, que este encargo prohíbe tocar.
 *
 * El «límite de 2 s» (y el segundo intento de 6 s) se le pasa a `pedir` como su
 * `timeout`, que es de INACTIVIDAD del socket —el de Node—, no un tope de reloj:
 * un portal que no responde corta a los 2 s, y a los 6 s en el reintento, pero
 * uno que TRANSMITE despacio puede tardar mucho más y devolver 200, y entonces
 * sale LENTO con su latencia real, que es lo que se busca (no dar por caído lo
 * que solo es lento). Medido el 2026-09-28 con la red congestionada: «Parques
 * Nacionales» (2 MB) devolvió 200 en ~37 s sin que el tope de 2 s saltara,
 * porque el socket nunca estuvo 2 s seguidos inactivo. Un tope de reloj de
 * verdad exigiría un `tiempoMaximoMs` o un AbortSignal en `pedir` (propuesto en
 * el informe; `http.ts` no se toca aquí).
 */
import { fileURLToPath } from 'node:url'

import { BASE_GESTOR } from '../src/nucleo/parse.ts'
import { pedir, restablecer } from '../src/nucleo/http.ts'
import { diagnosticarRespuesta } from '../src/nucleo/portal-roto.ts'
import { enlaceBusqueda } from '../src/fuentes/jurisprudencia/consejoestado.ts'
import { BASE_SENADO } from '../src/fuentes/senado.ts'
import { BASE as BASE_DIARIO } from '../src/fuentes/diario_oficial.ts'

/** Límite del primer intento: por encima de esto el portal se considera lento. */
const LIMITE_MS = 2000
/** Segundo intento, solo para los que superaron el primero. */
const LIMITE_LENTO_MS = 6000
/**
 * Frontera del veredicto LENTO: respondió bien, pero por encima de 5 s. Con 2 s salían LENTOS 26 de 26 portales
 * (medido el 2026-09-28: veinte de ellos responden entre 2 y 5 s de forma normal), y un veredicto que lo marca
 * todo no distingue nada. El primer intento sigue cortando a los 2 s: eso es el ping, no el veredicto.
 */
const FRONTERA_LENTA_MS = 5000

export type Veredicto = 'OK' | 'LENTO' | 'MANTENIMIENTO/PÁGINA DE ERROR' | 'CAÍDO'

/** Un intento de sondeo: o una respuesta (status + cuerpo) o un error crudo. */
export type Sonda = {
  ms: number
  status?: number
  cuerpo?: string
  cabeceras?: Record<string, string>
  error?: string
}

/**
 * Criterio de «forma esperada» del cuerpo. Devuelve `null` cuando el cuerpo
 * tiene la pinta de datos de ese portal, o el motivo (en palabras) cuando no:
 * es lo que separa «200 con datos» de «200 con un armazón vacío».
 */
export type Forma = (cuerpo: string, status: number) => string | null

/**
 * Clasifica un intento ya resuelto. Función pura (sin red): la prueba de
 * `test/salud.ts` la ejerce con sondas sintéticas. `diagnosticarRespuesta`
 * reconoce lo que ya sabe (`portal-roto.ts`): 5xx, mantenimiento y el bucle de
 * redirección a sí mismo de SUIN; el resto de «cuerpo que no es lo que debería»
 * lo aporta la `forma` de cada portal.
 */
export function clasificar(s: Sonda, forma: Forma, url: string): { veredicto: Veredicto; motivo?: string } {
  if (s.error !== undefined) return { veredicto: 'CAÍDO', motivo: s.error }

  const status = s.status ?? 0
  const cuerpo = s.cuerpo ?? ''
  const diag = diagnosticarRespuesta(url, status, s.cabeceras ?? {}, cuerpo)

  if (status >= 500) return { veredicto: 'CAÍDO', motivo: `HTTP ${status}` }
  if (status >= 400) return { veredicto: 'MANTENIMIENTO/PÁGINA DE ERROR', motivo: `HTTP ${status}` }
  if (status >= 300) {
    return {
      veredicto: 'MANTENIMIENTO/PÁGINA DE ERROR',
      motivo: (diag.roto ? diag.motivo : undefined) ?? `HTTP ${status} (redirección no seguida)`,
    }
  }
  if (diag.roto) return { veredicto: 'MANTENIMIENTO/PÁGINA DE ERROR', motivo: diag.motivo ?? 'el portal no está sirviendo' }
  if (status !== 200) return { veredicto: 'CAÍDO', motivo: `HTTP ${status}` }

  const fallo = forma(cuerpo, status)
  if (fallo) return { veredicto: 'MANTENIMIENTO/PÁGINA DE ERROR', motivo: fallo }
  return { veredicto: s.ms > FRONTERA_LENTA_MS ? 'LENTO' : 'OK' }
}

// --- portales ------------------------------------------------------------

type Portal = {
  nombre: string
  url: string
  /** Accept del sondeo. */
  accept?: string
  /** Cabeceras extra (la `api-key` pública que exige el buscador de SUIN). */
  extra?: Record<string, string>
  /** Cuerpo JSON si el endpoint es POST (GraphQL de la Suprema, Elasticsearch de SUIN). */
  cuerpo?: string
  /**
   * El portal encadena redirecciones que `pedir` no sigue (no las sigue ninguna
   * fuente; la Superfinanciera es la excepción y las resuelve a mano). Aquí se
   * activan para no confundir un 301 con una caída.
   */
  redirige?: boolean
  /**
   * Plazo del segundo intento cuando 6 s no bastan. Solo lo declaran portales
   * MEDIDOS por encima de ese umbral (con la cifra y la fecha en su `nota`): sin
   * esto, un portal que responde 200 en 12 s se leería como caído, que es justo
   * lo que el segundo intento existe para evitar.
   */
  lentoMs?: number
  forma: Forma
  /** Por qué ESTA URL demuestra que el portal sirve datos. */
  nota: string
}

/** Un JSON parseable; el detalle de forma lo añade cada portal. */
const esJson = (cuerpo: string): string | null => {
  try {
    JSON.parse(cuerpo)
    return null
  } catch {
    return 'la respuesta no es JSON'
  }
}

/**
 * Los portales que este servidor consulta, uno por fuente. Los que tienen
 * adaptador con URL base exportada se importan (`BASE_GESTOR` de `parse.ts`,
 * `BASE_SENADO` del Senado, `BASE` del Diario Oficial); el resto repite aquí la
 * constante de su fuente con el fichero del que sale, para que no envejezca en
 * silencio.
 */
export const PORTALES: Portal[] = [
  {
    nombre: 'Gestor Normativo (Función Pública)',
    // Petición mínima al buscador avanzado (no la portada): devuelve el contador
    // «encontrados: N» y los enlaces `norma.php?i=`. Es la misma ruta que usa
    // src/fuentes/gestor.ts (`funajax.php`) y no es cacheable por `cache.ts`.
    url: `${BASE_GESTOR}/gestion/funphp/funajax.php?t=ejecuta_busqueda_avanzada2&palabras=ley`,
    forma: (c) => (/encontrados:\s*\d+/i.test(c) && /norma\.php\?i=\d+/.test(c) ? null : 'sin el contador «encontrados» ni enlaces de norma'),
    nota: 'buscador avanzado: 200 con «encontrados: N» y enlaces a norma.php',
  },
  {
    nombre: 'Corte Constitucional (relatoría)',
    // Misma API no documentada que src/fuentes/jurisprudencia/corte.ts
    // (buscador_new, tipo=json): responde la salida cruda de Elasticsearch.
    url: 'https://www.corteconstitucional.gov.co/relatoria/buscador_new/?searchOption=texto&fini=1992-01-01&ffin=2100-12-31&buscar_por=querella&maxprov=1&slop=1&accion=search&tipo=json',
    accept: 'application/json,text/html,*/*',
    forma: (c) => (esJson(c) ?? (/"?hits"?/.test(c) ? null : 'sin el bloque de resultados «hits»')),
    nota: 'buscador JSON de la relatoría (Elasticsearch); exige la cadena TLS de pedir',
  },
  {
    nombre: 'Corte Suprema (consultaprovidenciasbk)',
    // GraphQL con introspección abierta (src/fuentes/jurisprudencia/cortesuprema.ts).
    // Consulta mínima: sin `typeOfQuery` (la sala) el backend responde null.
    url: 'https://consultaprovidenciasbk.cortesuprema.gov.co/api',
    accept: 'application/json',
    cuerpo: JSON.stringify({
      query: 'query($q:SearchQuery!){getSearchResult(searchQuery:$q){numOfResults}}',
      variables: {
        q: { query: 'tutela', typeOfQuery: 'Tutelas', roomTutelas: 'Tutelas', start: 0, isExact: false, magistrate: '', year: '', autoSentencia: '', order: '', addedQueries: [] },
      },
    }),
    forma: (c) => {
      if (esJson(c)) return esJson(c)
      return /"getSearchResult"\s*:\s*\{/.test(c) ? null : 'getSearchResult nulo (faltó la sala o cambió el esquema)'
    },
    nota: 'POST GraphQL; el front obsoleto tras una ruta inventada responde 200 con mantenimiento',
  },
  {
    nombre: 'Consejo de Estado (SAMAI)',
    // El «enlace permanente de búsqueda» que genera el propio portal; el mismo
    // que arma `enlaceBusqueda` de consejoestado.ts. Un 200 no prueba nada aquí
    // (su página de error también es 200): la forma mira el rótulo del repetidor.
    url: enlaceBusqueda('tutela', 0, true),
    forma: (c) => (/PaginaActualLabel|HypRadicado_/.test(c) ? null : 'sin el repetidor de providencias (PaginaActualLabel/HypRadicado)'),
    nota: 'enlace permanente de búsqueda de SAMAI (GET, sin postback de WebForms)',
  },
  {
    nombre: 'Senado (Leyes desde 1992)',
    // Índice del Código Civil (src/fuentes/senado.ts). HTTP PLANO a propósito:
    // el puerto 443 de este host no abre (medido el 2026-09-28), así que `pedir`
    // lo baja por http:. El `<select>` de artículos es el canario de estructura.
    url: `${BASE_SENADO}/codigo_civil.html`,
    forma: (c) => (/<select[\s\S]*?<\/select>/i.test(c) && /<option/i.test(c) ? null : 'sin el <select> de artículos del índice'),
    nota: 'única fuente del articulado del Código Civil; solo habla HTTP plano (sin cifrar)',
  },
  {
    nombre: 'Diario Oficial (Imprenta Nacional)',
    // Consulta pública del Diario Oficial (src/fuentes/diario_oficial.ts, `BASE`).
    // El GET sirve el formulario y la tabla; la búsqueda en sí es un POST con
    // ViewState y cookie, que el sondeo NO hace (sería caro y con estado).
    url: BASE_DIARIO,
    forma: (c) => (/frmConDiario/.test(c) && /dtbDiariosOficiales/.test(c) ? null : 'sin el formulario frmConDiario / tabla dtbDiariosOficiales'),
    nota: 'JSF/PrimeFaces: el GET prueba que sirve la consulta; la búsqueda es un POST con ViewState',
  },
  {
    nombre: 'DIAN (normograma · buscador)',
    // Endpoint JSON que documenta src/fuentes/normograma.ts. Se sondea con un
    // término sin resultados para no bajar los 3 MB / ~20 s que devuelve para un
    // término común: la prueba es que el endpoint conteste, con datos o con su
    // aviso literal de «sin resultados».
    url: 'https://normograma.info/prueba-dian/buscador/Buscar.ashx?texto=zzqxnoexisteint',
    accept: 'application/json,*/*',
    forma: (c) => (/No se encontraron resultados\./i.test(c.trim()) || Array.isArray(safeJson(c)) ? null : 'ni JSON ni el aviso «No se encontraron resultados.»'),
    nota: 'buscador JSON de normograma.info (instancia prueba-dian); el texto de los docs vive en normograma.dian.gov.co',
  },
  {
    nombre: 'SUIN-Juriscol (fichas · Elasticsearch)',
    // Índice público del buscador nuevo (src/fuentes/suin.ts, `FICHAS`). POST
    // mínimo: una ficha cualquiera. Es de donde sale el estado de vigencia.
    url: 'https://lexis.minjusticia.gov.co/elasticsearch/documents_stg/_search',
    accept: 'application/json',
    cuerpo: JSON.stringify({ size: 1, query: { match_all: {} } }),
    forma: (c) => (safeJson(c)?.hits?.hits ? null : 'sin hits.hits'),
    nota: 'POST _search al índice de fichas; es la fuente del estado de vigencia',
  },
  {
    nombre: 'SUIN-Juriscol (buscador · Azure)',
    // Azure Cognitive Search (src/fuentes/suin.ts, `BUSCADOR`). La api-key es la
    // pública que el portal sirve a cualquier visitante.
    url: "https://searchmjd.search.windows.net/indexes/suinjuriscol-index/docs?api-version=2019-05-06&search=tutela&$top=1&$select=ID&$count=true",
    accept: 'application/json;odata.metadata=none',
    extra: { 'api-key': '404481BD9298D9A33EE7215E16757100' },
    forma: (c) => (Array.isArray(safeJson(c)?.value) ? null : 'sin la lista «value»; la api-key pública pudo rotar'),
    nota: 'buscador por materia de SUIN (Azure); 0,14 % figura derogado, el resto «en estudio»',
  },
  {
    nombre: 'ANH',
    // Listado de normatividad (src/fuentes/anh.ts). El formulario debe seguir en
    // el HTML aunque no haya filas: es lo que distingue vacío de estructura rota.
    url: 'https://www.anh.gov.co/es/normatividad2/normatividad/?page=1',
    forma: (c) => (/name="keyword"/.test(c) ? null : 'falta el formulario de búsqueda (name="keyword")'),
    nota: 'listado GET con tabla renderizada y formulario propio',
  },
  {
    nombre: 'CREG (Alejandría 2.0)',
    // Compilación cronológica de no derogadas (src/fuentes/creg.ts). Sitio de
    // páginas estáticas; los resolutivos viven en docs/resolucion_creg_*.htm.
    url: 'https://gestornormativo.creg.gov.co/gestor/entorno/resoluciones_por_orden_cronologico_no_derogadas.html',
    forma: (c) => (/docs\/resolucion_creg_/.test(c) ? null : 'sin enlaces a docs/resolucion_creg_*.htm'),
    nota: 'compilación cronológica; publica vigencia como estructura (no derogadas)',
  },
  {
    nombre: 'UPME (wp-json)',
    // REST de WordPress (src/fuentes/upme.ts, `API`). Una entrada basta.
    url: 'https://www.upme.gov.co/wp-json/wp/v2/circular_resolucion?per_page=1',
    accept: 'application/json',
    forma: (c) => (Array.isArray(safeJson(c)) ? null : 'wp-json no devolvió una lista'),
    nota: 'tipo de contenido circular_resolucion paginado con búsqueda',
  },
  {
    nombre: 'ANLA (Eureka)',
    // Sección «leyes» de Eureka (src/fuentes/anla.ts). Joomla con dos plantillas:
    // la de blog usa div.article; la de etiqueta, ul.com-tags-tag__category.
    url: 'https://www.anla.gov.co/wanla/eureka/normativa/leyes',
    forma: (c) => (/article-header|com-tags-tag__category|div\.article/.test(c) ? null : 'sin entradas de ninguna de las dos plantillas'),
    nota: 'curaduría temática; cada sección cae por su cuenta, no todo ANLA',
  },
  {
    nombre: 'MinAgricultura',
    // Listado completo de leyes en una sola petición (src/fuentes/sectorial/minagricultura.ts).
    url: 'https://www.minagricultura.gov.co/normatividad/leyes',
    forma: (c) => (/item_norm/.test(c) ? null : 'sin las tarjetas article.item_norm'),
    nota: 'TYPO3: una petición trae la categoría entera, sin paginación de servidor',
  },
  {
    nombre: 'ICA',
    // Resoluciones MSF y RT (src/fuentes/sectorial/ica.ts, RUTA_DEFECTO).
    url: 'https://www.ica.gov.co/normatividad/normas-ica/resoluciones-oficinas-nacionales',
    forma: (c) => (/tiponorma/.test(c) ? null : 'sin el listado de normas (.tiponorma)'),
    nota: 'Kentico: listado con paginación por querystring (?page=N)',
  },
  {
    nombre: 'ANM',
    // Vista Drupal de resoluciones (src/fuentes/sectorial/anm.ts). El div de la
    // vista es el canario de estructura.
    url: 'https://www.anm.gov.co/resoluciones?page=0',
    forma: (c) => (/view-id-tabla_pagina_resoluciones/.test(c) ? null : 'falta la vista view-id-tabla_pagina_resoluciones'),
    nota: 'Drupal: una vista por tipo de acto (resoluciones y circulares)',
  },
  {
    nombre: 'ANT',
    // Listado de normativa (src/fuentes/sectorial/ant.ts, article.pxc-norma).
    url: 'https://www.ant.gov.co/normativa',
    forma: (c) => (/pxc-norma/.test(c) ? null : 'sin article.pxc-norma'),
    nota: 'Drupal 10: filtros por tipo/título y paginación ?page=N (base 0)',
  },
  {
    nombre: 'Supersociedades',
    // Buscador por categoría (src/fuentes/sectorial/supersociedades.ts): sin
    // `id` cae a «Actas de Conciliación», así que se pasa el de Resoluciones.
    url: 'https://www.supersociedades.gov.co/web/nuestra-entidad/normativa?id=1256464&start=0&end=20',
    // Medido el 2026-09-28 con curl: 5,3–9,9 s para 272 KB (varía por nodo). Con
    // el 6 s de serie salía CAÍDO estando vivo; se le da margen.
    lentoMs: 15_000,
    forma: (c) => (/id="searchKeyword"/.test(c) ? null : 'falta el buscador interno (id="searchKeyword")'),
    nota: 'Liferay: buscador por categoría con start/end de 20 en 20 (272 KB; 5,3–9,9 s el 2026-09-28)',
  },
  {
    nombre: 'SIC (sede electrónica)',
    // Vista del repositorio de normatividad (src/fuentes/sectorial/sic.ts).
    // Exige el intermedio GlobalSign que ya aporta `pedir`.
    url: 'https://sedeelectronica.sic.gov.co/transparencia/normativa/busqueda-de-normas/entidad?field_clasificacion2_target_id=177&page=0',
    forma: (c) => (/normas--row|view-empty/.test(c) ? null : 'sin tarjetas de resultados ni aviso de vacío'),
    nota: 'Drupal View en la sede electrónica (el dominio viejo da 301 a la sede)',
  },
  {
    nombre: 'INVIMA (normograma)',
    // Buscador JSON de Avance Jurídico (src/fuentes/sectorial/invima.ts). Término
    // sin resultados para no bajar el resultado completo del motor.
    url: 'https://normograma.info/prueba-invima/buscador/Buscar.ashx?&texto=zzqxnoexisteint',
    accept: 'application/json,*/*',
    forma: (c) => (/No se encontraron resultados\./i.test(c.trim()) || Array.isArray(safeJson(c)) ? null : 'ni JSON ni el aviso «No se encontraron resultados.»'),
    nota: 'misma app Angular que la Supersalud: mismo host normograma.info',
  },
  {
    nombre: 'Superfinanciera',
    // Índice de circulares/cartas/resoluciones (src/fuentes/sectorial/superfinanciera.ts).
    // Encadena hasta tres redirecciones (301 y 302): se siguen solo por mismo host.
    url: 'https://www.superfinanciera.gov.co/publicaciones/20149/',
    redirige: true,
    forma: (c) => (/publicaciones\/\d+/.test(c) && /<table/i.test(c) ? null : 'sin la tabla de años con enlaces a publicaciones'),
    nota: 'el sitio encadena 301/302 que `pedir` no sigue; la tabla índice es la puerta de entrada',
  },
  {
    nombre: 'Supersalud (normograma)',
    // Buscador JSON de Avance Jurídico (src/fuentes/sectorial/supersalud.ts).
    url: 'https://normograma.info/prueba-sns/buscador/Buscar.ashx?&texto=zzqxnoexisteint',
    accept: 'application/json,*/*',
    forma: (c) => (/No se encontraron resultados\./i.test(c.trim()) || Array.isArray(safeJson(c)) ? null : 'ni JSON ni el aviso «No se encontraron resultados.»'),
    nota: 'normograma de Avance Jurídico; comparte host normograma.info con el INVIMA',
  },
  {
    nombre: 'Mintrabajo',
    // Página que publica el listado (src/fuentes/sectorial/mintrabajo.ts). La
    // ruta «normatividad» da 302 aquí; se apunta directo a «marco-legal».
    url: 'https://www.mintrabajo.gov.co/web/guest/marco-legal',
    forma: (c) => (/data-label|Ep[íi]grafe/i.test(c) ? null : 'sin la tabla de normas (celdas data-label / «Epígrafe»)'),
    nota: 'portlet de Liferay: 755 filas en una sola página de 1,36 MB',
  },
  {
    nombre: 'Supertransporte',
    // Resoluciones generales del año en curso (src/fuentes/sectorial/supertransporte.ts).
    url: `https://www.supertransporte.gov.co/index.php/resoluciones-generales/${new Date().getFullYear()}/`,
    forma: (c) => (/tab-resolutions|resolution/.test(c) ? null : 'sin el contenedor .tab-resolutions .resolution'),
    nota: 'WordPress (Avada): listado del año con paginación solo en cliente',
  },
  {
    nombre: 'Unidad para las Víctimas',
    // Biblioteca de documentos (src/fuentes/sectorial/unidadvictimas.ts). Las
    // trece pestañas vienen en la respuesta; los items son `.e-loop-item`.
    url: 'https://www.unidadvictimas.gov.co/documentos_bibliotec/',
    // Medido el 2026-09-28 con curl: 12,6–26,6 s para 2,6 MB (WordPress/Elementor
    // sirve las trece pestañas de golpe). Muy por encima del 6 s de serie.
    lentoMs: 30_000,
    forma: (c) => (/e-loop-item/.test(c) ? null : 'sin items del listado (.e-loop-item)'),
    nota: 'WordPress + Elementor: una petición trae todas las pestañas (2,6 MB; 12,6–26,6 s el 2026-09-28)',
  },
  {
    nombre: 'Parques Nacionales',
    // Página estática /normativas/ (src/fuentes/sectorial/parques.ts), ~2 MB.
    url: 'https://www.parquesnacionales.gov.co/normativas/',
    forma: (c) => (/id=["']leyes["']/.test(c) ? null : 'sin el panel de leyes (id="leyes")'),
    nota: 'página estática construida a mano; sin buscador ni paginación en el portal',
  },
]

// --- sondeo --------------------------------------------------------------

/** JSON.parse sin lanzar: el que no parsea devuelve null y la forma lo reporta. */
function safeJson(cuerpo: string): any {
  try {
    return JSON.parse(cuerpo)
  } catch {
    return null
  }
}

/** Corta un mensaje para que quepa en la columna «estado». */
const corto = (s: string): string => (s.length > 70 ? `${s.slice(0, 69)}…` : s)

/**
 * Un intento: una petición (siguiendo redirecciones de mismo host si el portal
 * lo pide) y devuelve la Sonda. El breaker se limpia antes y después para no
 * arrastrar el estado de sondeos previos del proceso.
 */
async function intento(p: Portal, timeout: number): Promise<Sonda> {
  const host = new URL(p.url).host
  restablecer(host)
  const t0 = performance.now()
  const ms = (): number => Math.round(performance.now() - t0)
  let actual = p.url
  try {
    for (let salto = 0; salto < 6; salto++) {
      const r = await pedir(actual, timeout, p.accept ?? 'text/html,*/*', p.extra ?? {}, p.cuerpo)
      const diag = diagnosticarRespuesta(actual, r.status, r.cabeceras, r.cuerpo)
      const destino = r.cabeceras['location']
      if (p.redirige && r.status >= 300 && r.status < 400 && destino && !diag.roto) {
        const resuelto = new URL(destino, actual)
        if (resuelto.host !== host) return { ms: ms(), status: r.status, cuerpo: r.cuerpo, cabeceras: r.cabeceras }
        actual = resuelto.toString()
        continue
      }
      return { ms: ms(), status: r.status, cuerpo: r.cuerpo, cabeceras: r.cabeceras }
    }
    return { ms: ms(), error: 'cadena de redirecciones de más de 6 saltos' }
  } catch (e) {
    return { ms: ms(), error: (e as Error).message }
  } finally {
    restablecer(host)
  }
}

const esTimeout = (s: Sonda): boolean => s.error !== undefined && /tiempo de espera agotado/i.test(s.error)

/** Etiqueta corta de un intento para la columna «estado». */
const etiqueta = (s: Sonda): string => {
  if (s.error === undefined) return String(s.status ?? '—')
  const m = /tiempo de espera agotado tras (\d+) ms/.exec(s.error)
  return m ? `timeout ${m[1]} ms` : corto(s.error)
}

type Fila = { nombre: string; url: string; estado: string; ms: number; veredicto: Veredicto; motivo?: string }

/** Sondea un portal: 2 s primero y, solo si se agotó el plazo, un segundo intento de 6 s (o el declarado). */
async function sondear(p: Portal): Promise<Fila> {
  const primero = await intento(p, LIMITE_MS)
  const reintentado = esTimeout(primero)
  const s = reintentado ? await intento(p, p.lentoMs ?? LIMITE_LENTO_MS) : primero
  const { veredicto, motivo } = clasificar(s, p.forma, p.url)
  // Con dos intentos se muestran los dos: así se ve, medido, que el primero
  // respetó los 2 s y que el segundo fue el que decidió (timeout, o 200 lento).
  const estado = reintentado ? `1.º ${etiqueta(primero)}; 2.º ${etiqueta(s)}` : etiqueta(s)
  return { nombre: p.nombre, url: p.url, estado, ms: s.ms, veredicto, ...(motivo ? { motivo } : {}) }
}

// --- salida --------------------------------------------------------------

/** Tabla de columnas alineadas: portal · URL · estado · latencia · veredicto. */
function tabla(filas: Fila[], conDetalle: boolean): string {
  const enc = ['PORTAL', 'URL SONDEADA', 'ESTADO', 'LATENCIA', 'VEREDICTO']
  const celdas = filas.map((f) => [f.nombre, f.url, f.estado, `${f.ms} ms`, f.veredicto])
  const ancho = enc.map((h, i) => Math.max(h.length, ...celdas.map((c) => (c[i] ?? '').length)))
  const linea = (c: string[]): string => c.map((v, i) => v.padEnd(ancho[i]!)).join('  ').replace(/\s+$/, '')
  const out = [linea(enc), ancho.map((w) => '─'.repeat(w)).join('  '), ...celdas.map(linea)]
  if (conDetalle) {
    for (const f of filas) if (f.motivo) out.push(`· ${f.nombre}: ${f.motivo}`)
  }
  return out.join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const conDetalle = args.includes('--detalle')
  const extra = args.filter((a) => a !== '--detalle')

  const adHoc: Portal[] = extra.map((url) => ({
    nombre: 'ad-hoc',
    url,
    forma: (c) => (c.trim() ? null : 'cuerpo vacío'),
    nota: 'URL ad-hoc',
  }))

  const portales = [...PORTALES, ...adHoc]
  console.log(
    `Sondeando ${portales.length} portal(es) con un límite de ${LIMITE_MS} ms ` +
      `(segundo intento de ${LIMITE_LENTO_MS} ms, ampliado donde un portal medido lo exige)…\n`,
  )
  const filas = await Promise.all(portales.map(sondear))
  console.log(tabla(filas, conDetalle))

  const cuenta = (v: Veredicto): number => filas.filter((f) => f.veredicto === v).length
  const caidos = cuenta('CAÍDO')
  const rotos = cuenta('MANTENIMIENTO/PÁGINA DE ERROR')
  console.log(
    `\nOK ${cuenta('OK')} · LENTO ${cuenta('LENTO')} · MANTENIMIENTO/PÁGINA DE ERROR ${rotos} · CAÍDO ${caidos}`,
  )
  process.exit(filas.every((f) => f.veredicto === 'OK' || f.veredicto === 'LENTO') ? 0 : 1)
}

// Al importarlo `test/salud.ts` solo se quieren `clasificar`/`PORTALES`: el
// sondeo no debe dispararse al importar. Se arranca solo si este fichero es el
// de entrada (comparación insensible a mayúsculas: Windows devuelve otra caja).
const esEntrada =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()
if (esEntrada) await main()
