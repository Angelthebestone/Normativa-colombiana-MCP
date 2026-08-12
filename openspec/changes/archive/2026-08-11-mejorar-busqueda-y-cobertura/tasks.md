## 1. Fallback UPME al buscador del portal

> Subagente. Escribe en: `src/fuentes/upme.ts` (módulo existente) y `test/upme.ts` (nuevo). Ya disponibles: `pedir` de `src/nucleo/http.ts` (GET con ritmo/CA, timeout, devuelve `{status, cuerpo, cabeceras}`), `cheerio` (dependencia existente, `import * as cheerio from 'cheerio/slim'`), `CanarioError` y `sinTildes` de `src/nucleo/parse.ts`, y el parser REST actual en `upme.buscar`. No añadir dependencias.

- [x] 1.1 Añadir a `src/fuentes/upme.ts` un parser cheerio de las tarjetas `.bj-tarjeta` del HTML de `?q=` (título `.bj-tarjeta-titulo`, descripción, fecha `.bj-badge-fecha`, enlace `.bj-btn-consultar`) con fixture del HTML real medido en `test/fixtures/upme-portal.html`
- [x] 1.2 En `upme.buscar`, cuando hay `texto` y el REST devuelve 0 items, consultar `https://www.upme.gov.co/nosotros/biblioteca-juridica/biblioteca-juridica/?q=<texto>` vía `pedir` y parsear
- [x] 1.3 Rotular la procedencia en la respuesta (`resultados del buscador del portal, que indexa el contenido del PDF`) y degradar con nota si el HTML no es parseable (sin romper el camino REST)
- [x] 1.4 Añadir casos en `test/upme.ts` (node:test + `strict as assert`): REST vacío + portal con resultados, REST con resultados (sin fallback), portal no parseable (degradación con nota), fixture sin red

## 2. Frase exacta en Consejo de Estado

> Subagente. Escribe en: `src/fuentes/jurisprudencia/consejoestado.ts` (módulo existente), `src/index.ts` (registro de tool) y `test/red-tribunales.ts` o `test/consejoestado.ts`. Ya disponibles: `enlaceBusqueda` construye la URL con `searchMode: 'any'` (línea 92); `buscar(texto, limite, pagina)` ya existe y aplica filtro local AND (`contienenTodas`). El patrón de `exacto` con fallback OR está en la Suprema (`src/index.ts:846`). Reutilizar `pedir` y `cheerio` existentes.

- [x] 2.1 Añadir parámetro `exacto` (default `true`) al schema de `buscar_jurisprudencia_consejo_estado` en `src/index.ts`
- [x] 2.2 En `consejoestado.ts`, cuando `exacto=true`, envolver la frase en comillas en `enlaceBusqueda` (SAMAI `searchMode`); con `exacto=false` dejar `any` como hoy
- [x] 2.3 Implementar fallback OR declarado cuando `exacto=true` devuelve 0 y el texto tiene más de una palabra, replicando el patrón de la Suprema (nota "se amplió uniendo las palabras")
- [x] 2.4 Añadir casos: frase exacta con resultados, frase exacta sin resultados (ampliación OR con nota), `exacto=false` con nota de recuento sin pertinencia

## 3. Deduplicación de resultados

> Subagente. Escribe en: `src/nucleo/deduplicar.ts` (nuevo helper), `src/fuentes/sectorial/minagricultura.ts`, `src/fuentes/sectorial/mintrabajo.ts` y `src/fuentes/jurisprudencia/cortesuprema.ts`. Ya disponibles: `sinTildes` de `src/nucleo/parse.ts`; los adaptadores sectoriales devuelven `ActoSectorial[]` con `tipo|numero|anio`; la Suprema devuelve `Providencia[]` con `radicado`/`url` y archivos `.doc`/`.pdf`. No añadir dependencias.

- [x] 3.1 Crear `src/nucleo/deduplicar.ts` con `deduplicar(items, claveFn)` que conserve la primera entrada, cuente fusionadas y devuelva `{ items, duplicados }`
- [x] 3.2 Aplicar en Minagricultura y Mintrabajo con clave `tipo|numero|anio` normalizada (sin tildes, mayúsculas), fusionando la misma norma con dos enlaces; conservar ambas si el epígrafe difiere materialmente
- [x] 3.3 Aplicar en la Corte Suprema con clave radicado (o url normalizada si no hay radicado), fusionando `.doc`/`.pdf` del mismo fallo
- [x] 3.4 Declarar en la respuesta `N duplicado(s) fusionado(s)` y ajustar el total declarado a únicos (declarando el total del portal si difiere)
- [x] 3.5 Añadir casos en `test/`: mismo fallo .doc/.pdf, misma norma con dos enlaces, total del portal con duplicados, helper unitario

## 4. TTL y rotulación de caché por término (DIAN)

> Subagente. Escribe en: `src/fuentes/normograma.ts` (módulo existente) y `test/`. Ya disponibles: la caché existente `const cache = new Map<string, DocDian[]>()` en `normograma.ts:73` con clave `q.toLowerCase()`; `buscar(texto, limite, desde)` ya la consulta. NO crear módulo nuevo de caché. No añadir dependencias.

- [x] 4.1 Añadir TTL (default 30 min) a la caché existente en `normograma.ts`: guardar `{ valor, expira }` y comprobar expiración al leer; limpiar entradas vencidas
- [x] 4.2 Rotular en la respuesta cuándo un resultado viene de caché (`deCache`) y cuándo caducó (refresco), sin cambiar el contrato de `buscar` (devolver el marcador en el objeto o en una nota)
- [x] 4.3 Garantizar que un fallo de red no se sirva como fresco: si hay caché, se ofrece rotulada como obsoleta; si no, error normal
- [x] 4.4 Añadir casos en `test/`: segunda consulta dentro del TTL (sin petición, marca deCache), caducidad, fallo de red con caché obsoleta

## 5. Herramienta consultar_vigencia

> Subagente. Escribe en: `src/index.ts` (registro de tool nueva) y `test/`. Ya disponibles: `resolver_cita` (tool registrada en `src/index.ts:199`) que ya integra Gestor + ficha SUIN directa con caché 30 min; el parser de citas `parsearCita` en `src/nucleo/citas.ts`; el formato `txt()`/`vacio()` del módulo. No duplicar la lógica de resolución: envolver la existente. No añadir dependencias.

- [x] 5.1 Registrar `consultar_vigencia(cita)` en `src/index.ts` reutilizando el flujo de `resolver_cita` (misma resolución) y añadiendo el nivel de confianza
- [x] 5.2 Mapear `confianza`: `alta` Gestor/ficha directa, `media` índice SUIN (con nota de contradicciones conocidas), `baja` sin cobertura (con sugerencia de Diario Oficial/Función Pública)
- [x] 5.3 Devolver estado, URL de ficha, confianza y explicación; aviso de forma para citas inválidas sin consultar fuentes (usar `parsearCita`)
- [x] 5.4 Añadir casos en `test/` con fixtures/deps inyectadas: Gestor (alta), SUIN índice (media), no consta (baja), cita inválida

## 6. solo_entidad en INVIMA y Supersalud

> Subagente. Escribe en: `src/fuentes/sectorial/invima.ts`, `src/fuentes/sectorial/supersalud.ts`, `src/index.ts` (schema de `buscar_normativa_sectorial`) y `test/sectorial-sdk.ts`. Ya disponibles: el contrato `Adaptador` (registro.ts) con `tiposDocumento`; el parámetro se añade a las `OpcionesSectorial` y al schema. El adaptador ya conoce sus tipos propios. No añadir dependencias.

- [x] 6.1 Añadir parámetro `solo_entidad` (default `false`) al schema de `buscar_normativa_sectorial` y a `OpcionesSectorial`
- [x] 6.2 En `invima.ts` y `supersalud.ts`, cuando `solo_entidad=true`, filtrar por los tipos propios de la entidad (los que la entidad expide, p.ej. Resolución/Circular) y documentar en la respuesta qué tipos se consideraron propios
- [x] 6.3 Añadir casos en `test/sectorial-sdk.ts`: `solo_entidad=true` filtra compilación y conserva actos propios; `false` devuelve todo

## 7. Perfiles salud y mineria en buscar_unificado

> Subagente. Escribe en: `src/herramientas/buscar_unificado.ts` (módulo existente) y `test/buscar_unificado.ts`. Ya disponibles: `schema.perfil` es `z.enum(['laboral','tributario','ambiental','contratacion','energia'])` (línea 35); `fuentesDe()` decide el fan-out (línea 54); los adaptadores `anm`, `invima`, `supersalud` están registrados en `registro.ts` y se consultan con `buscar_normativa_sectorial(entidad=...)`. El federado ya usa `conAlternativas`. No añadir dependencias.

- [x] 7.1 Extender `schema.perfil` con `salud` y `mineria`, y `fuentesDe()` para que `salud → [invima, supersalud]` y `mineria → [anm]` se añadan al fan-out (reutilizando `buscar_normativa_sectorial`)
- [x] 7.2 Validar perfil desconocido con mensaje que lista los admitidos (incluyendo los nuevos), sin ejecutar fan-out
- [x] 7.3 Añadir casos en `test/`: perfil salud, perfil mineria, perfil desconocido, vacío por fuente explicado (inyectar `porFuente` deps)

## 8. Advertencia de portal roto

> Subagente. Escribe en: `src/nucleo/portal-roto.ts` (nuevo helper), `src/fuentes/sectorial/parques.ts`, `src/fuentes/sectorial/mintrabajo.ts` y `test/`. Ya disponibles: `sinTildes` de `src/nucleo/parse.ts`; los adaptadores devuelven `ActoSectorial[]` con `epigrafe` y `url`. Regla conservadora: solo marcar si el epígrafe tiene número Y el nombre del archivo tiene un número distinto (o patrón claro sin número); nombres genéricos (`documento.pdf`) sin número no marcan. No añadir dependencias.

- [x] 8.1 Crear `src/nucleo/portal-roto.ts` con `advertenciaPortalRoto(epigrafe, url)` que extraiga el número del epígrafe y del nombre del archivo y devuelva advertencia solo en discordancia clara
- [x] 8.2 Aplicar como advertencia no bloqueante en los adaptadores con casos conocidos (Parques Nacionales, Mintrabajo), añadiéndola al epígrafe o a una nota
- [x] 8.3 Añadir casos en `test/`: discordancia clara, concordancia, archivo genérico sin número (sin advertencia), variante del número (sin advertencia)

## 9. Advertencia de snapshot antiguo

> Subagente. Escribe en: `src/nucleo/snapshot.ts` (nuevo helper), `scripts/generar-indice.ts`, `scripts/generar-indice-suin.ts` y las respuestas que usan los índices en `src/index.ts`. Ya disponibles: los índices en `datos/` (temático y SUIN). Verificar si ya traen fecha de generación; si no, añadirla a los metadatos en los scripts de generación. No añadir dependencias.

- [x] 9.1 Verificar si `datos/*.json` traen fecha de generación; si no, añadirla en `scripts/generar-indice.ts` y `scripts/generar-indice-suin.ts`
- [x] 9.2 Crear `src/nucleo/snapshot.ts` con `advertenciaSnapshot(fecha, umbral=30d)` que devuelva el texto de advertencia solo si la fecha supera el umbral (índice sin fecha → sin advertencia)
- [x] 9.3 Aplicar en las respuestas que usan el índice temático y el de SUIN (añadir la línea de advertencia)
- [x] 9.4 Añadir casos en `test/`: índice reciente (sin advertencia), índice antiguo (con advertencia), índice sin fecha (sin advertencia)

## 10. Documentación del opt-in de expedientes

> Subagente. Escribe en: `src/herramientas/expedientes.ts` (descripción), `src/index.ts` (INSTRUCCIONES/describir_fuentes) y `test/expedientes-herramientas.ts`. Ya disponibles: el `AVISO_DESACTIVADO` existente en `src/herramientas/expedientes.ts:13-17` ya explica cómo activar (`EXPEDIENTES=1`) y persistir (`EXPEDIENTES_DIR`). NO reimplementar el aviso; solo documentar. No añadir dependencias.

- [x] 10.1 Verificar que el `AVISO_DESACTIVADO` ya explica cómo activar y persistir; no tocarlo si ya cumple
- [x] 10.2 Documentar el opt-in en la descripción de la herramienta `expediente` (DESCRIPCION) y en `describir_fuentes`/INSTRUCCIONES: que la capacidad existe aunque esté desactivada y cómo activarla
- [x] 10.3 Añadir caso en `test/expedientes-herramientas.ts`: el mensaje de desactivación explica `EXPEDIENTES=1` y `EXPEDIENTES_DIR`; `describir_fuentes` menciona la capacidad

## 11. historial_norma: cadena de reformas navegable

> Subagente. Escribe en: `src/herramientas/historial_norma.ts` (nuevo), `src/index.ts` (registro de tool) y `test/historial_norma.ts`. Ya disponibles: `historial(texto)` en `src/nucleo/parse.ts:352` devuelve `Cambio[]` con `{accion, norma, anio, articulo, literal}` (tres formas de nota ya parseadas); `gestor.buscar({tipo, numero, anio})` y `gestor.obtenerNorma(id)` en `src/fuentes/gestor.ts`; `parsearCita` en `src/nucleo/citas.ts`. NO reimplementar el parser: estructurar lo que `historial()` ya devuelve. No añadir dependencias.

- [x] 11.1 Crear `src/herramientas/historial_norma.ts`: dado `cita`, resolver con `gestor.buscar`/`obtenerNorma` (igual que hace `comparar_articulos.articuloDe`), llamar a `historial(texto)` y estructurar la cadena: acción → norma (año) → artículo afectado → literal, con tope (p.ej. 20) y declaración de omitidos
- [x] 11.2 Registrar `historial_norma(cita)` en `src/index.ts` con schema (`cita` string requerida), devolviendo el historial estructurado y, si no hay reformas, el aviso de "sin reformas anotadas" + remitir a `resolver_cita`; NO deducir vigencia desde la cadena
- [x] 11.3 Añadir casos en `test/historial_norma.ts` con fixtures del texto del Gestor (notas pasiva, activa entre paréntesis, control constitucional): acción/norma/año/artículo/literal correctos; norma sin reformas; tope con omitidos

## 12. Patrones de cumplimiento en comparar_articulos

> Subagente. Escribe en: `src/herramientas/diff.ts` (módulo existente) y `test/diff.ts` (o el test de comparar_articulos). Ya disponibles: `clasificarDiferencia(fragmento)` en `diff.ts` con patrones ordenados `plazo|sancion|excepcion|sujeto` (líneas 13-16), gana el primero; `DESCRIPCION` y `CIERRE` en `comparar_articulos.ts` declaran el límite léxico. Ampliar patrones, no crear módulo nuevo. No añadir dependencias.

- [x] 12.1 Ampliar los patrones de `clasificarDiferencia` en `diff.ts` con categorías de cumplimiento: prohibiciones ("queda prohibido", "no podrá"), obligaciones de hacer ("el responsable deberá", "estará obligado a", "debe"), plazos concretos ("dentro de los X días hábiles", "a más tardar", "en un término no mayor a"), manteniendo el orden de evaluación (gana el primero)
- [x] 12.2 Declarar el límite léxico ampliado en `DESCRIPCION` y `CIERRE` de `comparar_articulos.ts` (sinonimia real queda en `no clasificado`)
- [x] 12.3 Añadir casos en `test/diff.ts`: prohibición detectada, obligación detectada, plazo con "días hábiles", sin patrón → `no clasificado`, sinonimia no cubierta → `no clasificado`

## 13. Autoverificación (fiabilidad operativa)

> Subagente (depende de que existan las tools nuevas de los grupos 1-12 para el mapa tool→casos; si no, cubrir solo los mecanismos). Escribe en: `scripts/verificar.ts` (nuevo), `package.json` (npm script `verificar`), `test/fixtures/` y ampliación de `scripts/barrido-disruptivo.ts`. Ya disponibles: `node:test`, `node:assert` (`strict as assert`), `spawn` (patrón en `test/e2e.ts`), `scripts/probar-tools.ts`, `scripts/medir.ts`, `scripts/barrido-disruptivo.ts`, la red `test/red*.ts`. Cero dependencias nuevas.

- [x] 13.1 Crear `scripts/verificar.ts` que orqueste con `spawn`/`node:test` la cadena: build → typecheck → tests unitarios → red de regresión contra el bundle → smoke, deteniéndose en el primer paso fallido con paso, tool, input y salida cruda
- [x] 13.2 Mantener el mapa tool→archivo de pruebas (derivable de `tools/list` y `test/red*.ts`) y hacer que `verificar` rompa si una tool publicada no tiene caso, indicando tool y archivo esperado
- [x] 13.3 Crear `test/fixtures/` con snapshots congelados por fuente y migrar los parsers clave (UPME, Consejo de Estado) a tests deterministas contra fixtures, sin red viva
- [x] 13.4 Ampliar el barrido de términos con términos conocidos por fuente y resultados esperados; reportar por fuente `rinde | vacío | red`, marcando como posible regresión de portal un término que antes rendía y ahora vacío (caso UPME)
- [x] 13.5 Añadir casos: verificar rompe con tool sin caso, fixtures sin red, barrido distingue vacío de red
- [x] 13.6 Confirmar cero dependencias nuevas

## 14. Verificación final (tras integrar todos los grupos)

- [x] 14.1 Ejecutar `npm run build` y confirmar el delta de peso del bundle (taste: verificar tamaño de `server/index.js`)
- [x] 14.2 Ejecutar `npm run typecheck` y `npm run lint` y arreglar regresiones
- [x] 14.3 Ejecutar la suite unitaria completa (`npm test`) y la red de regresión (`npm run test:red`), arreglando fallos
- [x] 14.4 Smoke manual: `buscar_normativa_upme("vehículos eléctricos")` rinde vía fallback; `consultar_vigencia("Decreto 1072 de 2015")` devuelve confianza; `historial_norma("Ley 100 de 1993")` devuelve cadena; `comparar_articulos` clasifica prohibición; `buscar_unificado` con perfil salud/mineria
- [x] 14.5 Actualizar `describir_fuentes` y las INSTRUCCIONES del prompt de sistema si las herramientas nuevas lo requieren
