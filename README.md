# Normativa Colombia — servidor MCP

[![npm](https://img.shields.io/npm/v/normativa-colombia-mcp.svg)](https://www.npmjs.com/package/normativa-colombia-mcp)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-servidor-black.svg)](https://modelcontextprotocol.io)

Consulta la normativa y la jurisprudencia colombiana desde cualquier asistente de IA que hable [Model Context Protocol](https://modelcontextprotocol.io), sin abrir el navegador ni pelear con formularios.

Conecta seis fuentes oficiales:

- **Gestor Normativo** del Departamento Administrativo de la Función Pública — leyes, decretos, resoluciones, circulares y conceptos del sector público, con la consulta temática y los *restrictores* que explican por qué cada norma aplica a un tema.
- **Relatoría de la Corte Constitucional** — 44.839 providencias según su propio índice, con fallos recientes publicados el mismo año.
- **SUIN-Juriscol** del Ministerio de Justicia — **el estado de vigencia**, que ninguna otra fuente del país publica, y 11.599 leyes de 1844 a 2026, muchas de las cuales el Gestor no tiene.
- **Corte Suprema de Justicia** — providencias de las salas de Tutelas, Civil, Laboral y Penal, cada una con las normas que cita.
- **Consejo de Estado** — providencias tituladas de lo contencioso administrativo, con el problema jurídico que la Sala se planteó, su respuesta y el texto completo. Con esta se completan las tres altas cortes, y las tres entregan texto.
- **Normograma de la DIAN** — normativa tributaria, aduanera y cambiaria.

Es un servidor MCP estándar que se comunica por **stdio**, así que sirve en Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed, Continue, LM Studio, agentes propios hechos con los SDK de MCP y cualquier cliente que aparezca después.

---

## Instalación

### Opción A — Claude Desktop, con un clic

La más sencilla si usas Claude Desktop: no requiere Node ni tocar archivos de configuración.

1. Descarga `normativa-colombia.mcpb` desde [Releases](https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases).
2. Abre Claude Desktop → **Configuración → Extensiones**.
3. Arrastra el archivo a esa ventana y confirma.
4. *(Opcional: instalar sin ciertas fuentes)* En Claude Desktop, abre la configuración de la extensión **Normativa Colombia**. En el campo **Fuentes** puedes indicar qué fuentes desactivar (p. ej. `-creg,-anh,-upme,-anla,-sectorial` para instalar sin fuentes sectoriales y ahorrar contexto) o cuáles conservar (`corte,suin`). Si lo dejas vacío, incluye todas.

Claude Desktop trae su propio Node, así que no hace falta instalar nada más.

### Opción B — cualquier otro cliente MCP, desde npm (recomendada)

La forma más sencilla y la que evita errores de rutas: no hay que clonar nada ni apuntar a archivos locales. Requiere **Node 18 o superior**.

```bash
# sin instalar nada, la forma habitual en clientes MCP
npx -y normativa-colombia-mcp

# o instalado en el proyecto
npm install normativa-colombia-mcp

# o disponible en todo el sistema
npm install -g normativa-colombia-mcp
```

Casi todos los clientes comparten este formato:

```json
{
  "mcpServers": {
    "normativa-colombia": {
      "command": "npx",
      "args": ["-y", "normativa-colombia-mcp"]
    }
  }
}
```

Para instalar **sin ciertas fuentes** (por ejemplo, sin los reguladores sectoriales para reducir consumo de contexto), añade la variable `FUENTES` en `env`:

```json
{
  "mcpServers": {
    "normativa-colombia": {
      "command": "npx",
      "args": ["-y", "normativa-colombia-mcp"],
      "env": {
        "FUENTES": "-creg,-anh,-upme,-anla,-sectorial"
      }
    }
  }
}
```

| Cliente | Dónde va esa configuración |
| --- | --- |
| **Claude Desktop** (manual) | `claude_desktop_config.json` — en Configuración → Desarrollador → Editar configuración |
| **Cursor** | `.cursor/mcp.json` en el proyecto, o `~/.cursor/mcp.json` para todos |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **Continue** | El bloque `mcpServers` de su configuración |
| **LM Studio** | Program → Install → Edit mcp.json |
| **Agente propio** | Como `StdioServerParameters` del SDK de MCP, en Python o TypeScript |

**Claude Code** no usa archivo; se registra por línea de comandos:

```bash
# con todas las fuentes
claude mcp add normativa-colombia -- npx -y normativa-colombia-mcp

# o sin fuentes sectoriales
claude mcp add normativa-colombia -e FUENTES="-creg,-anh,-upme,-anla,-sectorial" -- npx -y normativa-colombia-mcp
```

**VS Code** usa la clave `servers` en vez de `mcpServers`, en `.mcp.json` del proyecto o en la configuración de usuario:

```json
{
  "servers": {
    "normativa-colombia": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "normativa-colombia-mcp"],
      "env": {
        "FUENTES": "-creg,-anh,-upme,-anla,-sectorial"
      }
    }
  }
}
```

Si lo instalaste con `npm install -g`, el comando es `normativa-colombia-mcp` a secas, sin argumentos.

Si tu cliente no está en la lista, busca dónde declara servidores MCP por stdio: el comando y los argumentos son siempre los mismos.

#### Comprobar que quedó bien

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"prueba","version":"1"}}}' \
  | npx -y normativa-colombia-mcp
```

Debe responder un JSON con `"name":"normativa-colombia"` y un campo `instructions`.

### Opción C — desde el código

Para desarrollar o para fijar una versión propia. Requiere **Node 22 o superior**:

```bash
git clone https://github.com/Angelthebestone/Normativa-colombiana-MCP.git
cd Normativa-colombiana-MCP
npm install
npm run generar-indice   # índice temático, ~20 MB de descarga, una sola vez
npm run build            # genera server/: el lanzador index.js, el bundle servidor.js y el trozo de unpdf que se carga al leer un PDF
```

Después se apunta el cliente a `node /ruta/absoluta/a/Normativa-colombiana-MCP/server/index.js`, con el mismo formato de arriba. Funciona desde cualquier directorio de trabajo.

> Carpeta sin espacios: si la ruta local contiene espacios (p. ej. `C:\Users\…\normativa mcp\server\index.js`), algunos clientes lanzan el comando sin comillas y Node solo ve la primera parte (`C:\Users\…\normativa`) y sale con código 1. Para instalación local, clona en una carpeta sin espacios o usa la Opción B (`npx`), que no tiene este problema.

### Opción D — con Bun (alternativa opcional)

Node sigue siendo el runtime de referencia: es el de las pruebas (`npm run check`) y el del `.mcpb`. El servidor construido en la Opción C también arranca con [Bun](https://bun.sh), y se ha probado **a mano con Bun 1.4.2**: mismo `tools/list`, mismas respuestas y TLS íntegro (Bun respeta la cadena de certificados propia del servidor). Arranca unos 40 ms antes y ocupa unos 19 MB menos de memoria; la latencia de cada consulta es la misma, porque la marca el portal. No se prueba en cada versión: si algo falla solo con Bun, reprodúcelo antes con Node.

El cliente se apunta a `bun /ruta/absoluta/a/Normativa-colombiana-MCP/server/index.js` (misma nota de la carpeta sin espacios). Construir sigue requiriendo Node.

### Qué recibe el cliente

Al conectarse, el servidor entrega **28 herramientas**, **5 prompts** y sus **propias instrucciones de uso**: a qué tipo de pregunta corresponde cada herramienta, que debe citarse siempre la fuente y que nunca debe afirmarse por cuenta propia que una norma está vigente. Los clientes que respetan el campo `instructions` del protocolo lo aprovechan sin configurar nada.

| Fuente | Herramientas |
| --- | --- |
| Cualquiera (punto de entrada) | `resolver_cita` — cita exacta → norma o sentencia, con su vigencia si consta; acepta lote con `citas` y validación con `validar: true`. `consultar_vigencia` — el estado de vigencia con un nivel de confianza (alta/media/baja). `historial_norma` — la cadena de reformas que el Gestor anota sobre una norma (qué la modificó, adicionó o derogó y qué artículo afectó cada cambio), ordenada por el año de la norma que la hizo y con la última reforma anotada señalada; filtrable por `articulo` y paginable con `desde`/`limite`. `buscar_unificado`, `analizar_conflicto`, `historial_norma` y `resolver_cita` (con `validar: true`) aceptan `formato: "json"` para devolver el objeto de datos sin pie de texto |
| Gestor Normativo | `buscar_normas` (con marca de pertinencia por fila: qué términos menciona cada extracto), `buscar_por_tema`, `obtener_documento` (fuente `gestor`, con `sin_temas` para omitir el bloque de temas), `listar_catalogos`, `explicar_relacion_tema` |
| Corte Constitucional | `buscar_jurisprudencia` (`tipos` acepta «tutela», «auto»…), `linea_jurisprudencial` (qué providencias citan una sentencia), `obtener_documento` (fuente `corte`) |
| Corte Suprema | `buscar_jurisprudencia_suprema`, `obtener_documento` (fuente `suprema`) |
| Consejo de Estado | `buscar_jurisprudencia_consejo_estado`, `obtener_documento` (fuente `consejo`) |
| SUIN-Juriscol | `buscar_en_suin` (y vigencia vía `resolver_cita`) |
| Secretaría del Senado | el Código Civil, artículo por artículo, vía `resolver_cita` (solo HTTP sin cifrar) |
| Diario Oficial | `buscar_diario_oficial` — en qué diario salió una norma (tipo + número) o qué diarios salieron en unas fechas |
| DIAN | `buscar_normativa_tributaria`, `obtener_documento` (fuente `dian`) |
| CREG | `buscar_resoluciones_creg`, `obtener_documento` (fuente `creg`) |
| ANH / UPME / ANLA | `buscar_normativa_anh`, `buscar_normativa_upme`, `listar_normativa_ambiental_anla` |
| 14 reguladores sectoriales | `buscar_normativa_sectorial` (entidad: `sic`, `superfinanciera`, `supersalud`, `ant`, `unidadvictimas`…) + `obtener_documento` (fuente `sectorial`) |
| V2 — jerarquía y conflictos | `consultar_por_jerarquia`, `analizar_conflicto` (reúne EVIDENCIA; la búsqueda de tema prueba singular y plural y declara la variante), `comparar_articulos`, `cambios_desde` |
| V2 — perfiles y expedientes | `consultar_perfil`, `expediente` (acción `crear\|agregar\|leer\|exportar`) |
| Alcance | `describir_fuentes` — qué cubre cada fuente y qué no, sin consultar la red |

### Elegir las fuentes al instalar

Cada herramienta se paga en contexto en cada conversación, se use o no. Si no necesitas algunas fuentes, apágalas con la variable de entorno `FUENTES` (en Claude Desktop, el campo **Fuentes** de la extensión): sus herramientas desaparecen de la lista y su valor sale de los parámetros de las herramientas compartidas (`obtener_documento.fuente`, `buscar_unificado.fuentes`, `consultar_perfil.perfil`, el nivel `jurisprudencia` de `consultar_por_jerarquia`), así que la llamada a una fuente apagada no se puede ni escribir.

| `FUENTES` | Efecto | Herramientas | `tools/list` |
| --- | --- | --- | --- |
| vacía (por defecto) | todas | 28 | 41.862 B |
| `-creg,-anh,-upme,-anla,-sectorial` | todas menos la regulación sectorial | 23 | 34.493 B |
| `corte` | Gestor Normativo y Corte Constitucional | 18 | 26.590 B |

Dos formas, sin mezclar: la lista de las que quieres (`corte,suin`) o la de las que quitas (`-creg,-anh`). Claves: `corte`, `suprema`, `consejo`, `dian`, `suin`, `senado`, `diario`, `creg`, `anh`, `upme`, `anla`, `sectorial`. El Gestor Normativo va siempre: es el corpus de `resolver_cita` y de las herramientas V2. Una clave mal escrita **impide arrancar** con el motivo en el log, en vez de dejarte sin una fuente sin avisar. Las respuestas declaran lo apagado aparte de lo no consultado (`Desactivadas en esta instalación, no consultadas: CREG, ANH…`), y `describir_fuentes` sigue describiendo las fuentes apagadas, marcadas como tales.

## Qué puedes preguntar

- «¿Qué dice la Ley 1221 de 2008 sobre el auxilio de conectividad?»
- «¿Qué normas regulan el teletrabajo en el sector público y por qué aplican?»
- «¿Qué dice el Decreto 1083 sobre encargos?»
- «Búscame jurisprudencia reciente de la Corte Constitucional sobre estabilidad laboral reforzada.»
- «¿La Ley 909 de 2004 sigue vigente?»
- «¿Qué dice la DIAN sobre la retención en la fuente por servicios?»
- «Búscame tutelas de la Corte Suprema sobre teletrabajo y dime qué normas citan.»
- «¿Existe la Ley 74 de 1923 y sigue vigente?» — está derogada, y ni el Gestor la tiene.
- «¿Qué leyes hay sobre teletrabajo?» — `consultar_por_jerarquia` con nivel "ley".
- «Compara el art. 2 de la Ley 909 con el art. 2.2.5.3.1 del Decreto 1083.» — `comparar_articulos`.
- «¿Hay conflicto entre la Ley 909 de 2004 y el Decreto 1083 de 2015 en materia de encargos?» — `analizar_conflicto` (reúne evidencia, no concluye).
- «¿Qué cambió la Ley 909 de 2004 desde 2020?» — `cambios_desde`.
- «Normativa laboral sobre teletrabajo» — `consultar_perfil` con perfil "laboral".

El servidor incluye además cinco prompts listos, que los clientes que los soportan muestran como comandos: *¿Qué normas aplican sobre un tema?*, *¿Esta norma sigue vigente?*, *Explícame esta norma en lenguaje sencillo*, *Compara dos normas* y *Aclarar una consulta ambigua*.

### Herramientas V2

Sobre la capa común de metadatos, evidencia y normalización:

- **`consultar_por_jerarquia`** filtra por nivel (constitución, ley, decreto, resolución, concepto, jurisprudencia) y explica el carácter de cada uno. El Gestor no cataloga la Constitución como tipo: para ese nivel se orienta.
- **`resolver_cita` con `validar: true`** comprueba que una cita y su enlace son de verdad: número/año contra el título, dominio del enlace, id de la norma y existencia del artículo. Clasifica en "validada", "parcialmente validada" o "no fue posible validar"; nunca afirma vigencia.
- **`analizar_conflicto`** reúne EVIDENCIA de un posible conflicto entre dos normas (identificación, vigencia según SUIN si consta, jerarquía, reformas anotadas, pasajes sobre un tema). **No detecta contradicciones semánticas** y el resultado es un conflicto POTENCIAL, no una conclusión jurídica.
- **`cambios_desde`** resume los cambios (modificación, derogación, adición) que el Gestor anota sobre **las normas que se le listan**, filtrados por el año de la norma modificadora. **No rastrea novedades** por su cuenta.
- **`comparar_articulos`** compara el texto de un artículo entre dos normas, marca lo añadido/eliminado, clasifica cada diferencia por patrones (plazo, sanción, excepción, sujeto obligado) y agrupa los cambios editoriales por similitud léxica (Dice sobre bigramas ≥0,92): «una línea» → «una sola línea» sale como cambio menor, no como añadido+eliminado. Lo no clasificado se marca "revisar manualmente". Sin modelo semántico.
- **`consultar_perfil`** ejecuta una consulta con las fuentes y filtros preconfigurados de un perfil: `laboral`, `tributario`, `ambiental`, `contratacion_estatal`, `energia`. Cada perfil declara su advertencia en la respuesta.
- **`expediente`** con `accion="crear|agregar|leer|exportar"` agrupa consultas, citas y observaciones de una investigación. **Desactivado por defecto**: se activa con la variable de entorno `EXPEDIENTES=1`; la persistencia en disco, con `EXPEDIENTES_DIR`.

Una regla de oro de las V2: si una cita viene sin año y el número es ambiguo ("Decreto 1072" son cuatro), la herramienta **no elige por ti**: lista los candidatos y pide el año.

## Lo que debes saber antes de confiar en una respuesta

**Esto no es asesoría jurídica.** Es un buscador que le da a un asistente de IA acceso a fuentes oficiales. Verifica siempre en el enlace que acompaña cada respuesta.

**La vigencia viene de SUIN, y solo de SUIN.** Ni el Gestor ni la relatoría tienen un campo que diga «esta norma está derogada»: las derogatorias van escritas dentro del texto, y el servidor se limita a avisar cuando detecta marcas de «Derogado» o «Modificado por» (el Decreto 1083 de 2015 contiene 155 notas de modificación). SUIN-Juriscol, del Ministerio de Justicia, sí publica el estado como dato, y es la única fuente del país que lo hace: cuando la norma está en el índice empaquetado, `resolver_cita` devuelve ese estado con su enlace.

Tres advertencias sobre ese dato, todas comprobadas:

- **Se entrega literal, nunca traducido a un sí o un no.** SUIN distingue «Vigente», «DEROGADO», «Vigencia en Estudio», «Compilado», «Declarado Inexequible» y «Norma no vigente porque agotó su objeto». «Vigencia en Estudio» no significa vigente.
- **El estado se lee del registro del documento, no de su prosa.** Donde aparecen los dos se contradicen: la Ley 1541 de 2012 muestra «Vigente» en pantalla y «Vigencia en Estudio» en su campo.
- **El buscador de SUIN no sirve para esto.** `buscar_en_suin` devuelve un campo de vigencia que viene de su índice de búsqueda y contradice la ficha —la Ley 74 de 1923 figura allí como «Vigencia en Estudio» y su ficha dice DEROGADO—, así que se marca como no fiable en cada respuesta.

Y la regla de fondo no cambia: **verifica en el enlace antes de actuar.**

**El buscador del Gestor no busca en el texto completo**, solo en los resúmenes temáticos, y une los términos con OR. Su índice de palabras además es muy pobre: «teletrabajo» casa con 3 documentos en todo el portal, y con ninguno de los 43 conceptos que sí están clasificados bajo ese subtema. El servidor compensa de tres formas: quita las palabras vacías antes de consultar, reintenta por el subtema oficial cuando la búsqueda por palabras rinde poco, y busca dentro del articulado en tu computador cuando pides una norma concreta. Además, cada resultado de `buscar_normas` marca qué términos menciona su extracto y cuáles no, para que un resultado parcial no se lea como totalmente pertinente.

**Los códigos se citan por su nombre.** `resolver_cita` entiende "art. 191 del Código de Comercio" además de "art. 191 del Decreto 410 de 1971", y dice contra qué norma resolvió: Comercio (Decreto 410 de 1971), Sustantivo del Trabajo (Decreto 2663 de 1950), Procesal del Trabajo (Decreto 2158 de 1948), Penal (Ley 599 de 2000), Procedimiento Penal (Ley 906 de 2004), General del Proceso (Ley 1564 de 2012), CPACA (Ley 1437 de 2011), Infancia y Adolescencia (Ley 1098 de 2006) y Estatuto Tributario (Decreto 624 de 1989) salen del Gestor.

**El Código Civil (Ley 84 de 1873) sale de la Secretaría del Senado, con tres salvedades.** El Gestor no lo publica y SUIN no sirve su texto, así que `resolver_cita` con "art. 946 del Código Civil" lee el artículo de la página de la Secretaría del Senado (medido el 2026-09-28: 48 de 50 artículos de una muestra leídos bien; los otros dos, un «socket hang up» del portal, se declaran como «no respondió», nunca como «no existe»). (1) **Solo sirve HTTP sin cifrar** —su puerto 443 no abre—: el texto no se puede autenticar en tránsito, y cada respuesta lo dice; quien no lo quiera la apaga con `FUENTES=-senado`. (2) **Los apartes tachados** que el portal marca como inexequibles o derogados salen entre `~~ ~~` y la respuesta avisa: no se citan como vigentes. (3) **No se reproducen las notas de vigencia, concordancias ni jurisprudencia de cada artículo**: son del editor del portal (Avance Jurídico Casa Editorial), que reserva su copia; la respuesta remite al enlace, donde están, y hay que mirarlas antes de citar. El portal es lento e intermitente (una parte tardó 40 s en responder).

**Las leyes modificatorias traen el artículo que sustituyen.** Cuando una ley está redactada como "El artículo 217 del Código Civil quedará así:", el texto nuevo va debajo con su propia numeración; el extractor lo devuelve junto al artículo pedido en lugar de cortar en los dos puntos. El cuerpo del código modificado es otro documento, y se pide con su propia cita ("art. 217 del Código Civil").

**El texto que publica el Gestor es el consolidado.** Al comparar un artículo con su reforma (`comparar_articulos` con `con_reforma: true`) el «antes» no existe en esas páginas: se contrasta lo que dispuso la reforma con lo que el portal publica hoy, y la respuesta lo declara. Si la ley modificadora solo transcribe una parte, o el extractor no aísla su artículo, el modo lo dice y no calcula un diff que sería engañoso. El portal tampoco anota todas las reformas (medido: la Ley 2466 de 2025 modifica el art. 23 del Código Sustantivo del Trabajo y esa reforma no aparece anotada).

**La cita judicial sale compuesta, y lo que no consta se dice.** `resolver_cita` (sentencias de la Corte Constitucional) y `obtener_documento` (normas del Gestor) traen una línea «Cita oficial: …» armada solo con campos de la fuente. En la relatoría de la Corte, `prov_magistrados` es el **ponente** (238 de 240 aciertos medidos traen un solo nombre y el texto de la providencia lo declara). En SAMAI la fecha es la **del proceso**, no la del fallo, y la Corte Suprema publica la fecha de **carga**: por eso esas fechas no entran en la cita y se listan como «no consta». Tampoco se inventa la entidad expedidora de una norma: el Gestor no la publica de forma fiable.

**Vigencia diferida.** Cuando una norma no rige de inmediato —«regirá seis meses después de su promulgación», o por tramos, como la Ley 2277 de 2022—, la cabecera de `obtener_documento` lo dice a partir de su propio artículo de vigencia (medido sobre 20 normas reales). Solo calcula la fecha cuando el texto lo permite; si falta la fecha de publicación o hay varios tramos, lo declara en vez de suponer.

**Un radicado de 23 dígitos** (`11001-03-28-000-2022-00132-00`) se descompone en `resolver_cita` y se busca en las providencias tituladas del Consejo de Estado (SAMAI). Los dígitos identifican la corporación solo para el Consejo de Estado (`03xx`) y la Sala Civil de la Corte Suprema (`0203`); los de un juzgado o un tribunal (`31xx`, `23xx`…) no son de una alta corte y no se rotulan como tales. SAMAI solo titula una parte de sus providencias: no encontrar un radicado no dice nada sobre el proceso, y **el estado procesal no está en este servidor**. La Corte Suprema no permite buscar por radicado.

**El Diario Oficial** (`buscar_diario_oficial`) dice en qué diario salió una norma (tipo + número) o qué diarios salieron en unas fechas. No da el texto: el PDF del diario es de sesión (sin la cookie responde 404) y pesa hasta 15 MB. No sabe qué normas trae cada diario ni filtra por entidad.

**Línea jurisprudencial.** `linea_jurisprudencial` lista las providencias que, según la relatoría de la Corte Constitucional, citan una sentencia (su bloque «citaciones»; la premisa de que la relatoría publica «sentencias que reiteran» era falsa: sí publica quién cita a quién). Que una sentencia cite a otra **no** es que la reitere ni que la respete, la lista puede estar incompleta (medido: T-233/24 menciona la C-337/11 y no consta) y topa en 100. Que una SU posterior la haya superado no se deduce: hay que leer la providencia.

**Ritmo de consulta.** El servidor hace como máximo una petición por segundo sostenida a cada portal, con ráfagas de hasta cinco, y nunca dos a la vez al mismo sitio. Si un portal responde que está limitando las consultas, espera lo que él indique en vez de insistir. Son servicios públicos y conviene que un asistente automático les pese menos que una persona navegando.

**Caché en disco (opcional).** Con la variable de entorno `CACHE_DIR` apuntando a un directorio, las copias de documentos sobreviven a los reinicios del cliente: una providencia de 3,4 MB pasó de 2.278 ms a 26 ms en un proceso nuevo (medido el 2026-09-28) y, cuando la copia vence, se revalida con `If-Modified-Since` (304, cero bytes). Solo se guardan documentos, nunca buscadores ni APIs; el directorio se poda a 500 ficheros o 256 MB, lo más antiguo primero. Sin la variable no se toca el disco.

**Privacidad.** Cada consulta viaja a servidores del Estado colombiano, que registran las peticiones y tu dirección IP, igual que si navegaras el sitio. No se envía nada a ningún otro servidor, no hay analítica y no se recoge información tuya. Tenlo en cuenta si vas a consultar sobre un asunto propio.

**Datos empaquetados.** Se incluyen dos índices, cada uno con su fecha de generación:

- El **temático** (12.063 pares tema/subtema, 56.458 asociaciones norma–subtema, 2026-08-01) responde al instante y sigue sirviendo si el portal se cae. Si supera los tres meses, el servidor te lo advierte.
- El de **SUIN** (11.613 leyes, 2026-09-24) traduce una cita escrita como texto a su documento sin salir a la red. La vigencia **no** depende de él: se pide en vivo a la ficha de SUIN por tipo, número y año, para leyes y decretos.

**SUIN-Juriscol cambió de portal (septiembre de 2026).** La ficha con el estado de vigencia sale ahora del índice público de su buscador nuevo, que trae leyes y decretos y **llega hasta 2020**: de una norma posterior no hay ficha, y la respuesta lo dice en vez de callarlo. El **texto** de los documentos ya no se puede leer desde fuera: el visor del portal lo pide a una dirección privada del Ministerio y se queda en blanco (medido con un navegador el 2026-09-24). Se entrega la ficha, el estado y el enlace clásico `viewDocument.asp?id=`. Comprobado de nuevo el 2026-09-28, cuando el portal anunció su vuelta: el buscador nuevo (`lexis.minjusticia.gov.co/buscador/Detallado/1`, `/2` y `/3`) consulta el mismo índice, que sigue llegando a 2020, y su visor sigue apuntando a direcciones privadas; la página `suin-juriscol.gov.co/suin/normativahistorica` es una página del gestor de contenidos del Ministerio y su API responde 404 para ese identificador, así que no hay datos que leer.

**Cobertura de la búsqueda tributaria.** La primera consulta de cada término a la DIAN tarda unos 20 segundos: su portal devuelve el resultado completo y no admite límite. Las páginas siguientes del mismo término son instantáneas, así que conviene paginar en lugar de repetir búsquedas.

**El enlace del Consejo de Estado caduca; el radicado no.** `buscar_jurisprudencia_consejo_estado` entrega, junto a cada providencia, un token firmado que emite el propio buscador y con el que `obtener_documento` con fuente `consejo` saca el texto del PDF. Ese token **vive una hora**: sirve para leer, no para citar. Para citar se usa el radicado. Si caducó, se repite la búsqueda y sale uno nuevo.

**El texto de la Corte Suprema se pide con su ruta y su sala.** `buscar_jurisprudencia_suprema` devuelve la referencia, el ponente, la fecha y las normas citadas; `obtener_documento` con fuente `suprema` devuelve el texto completo, pero exige la MISMA sala con la que apareció la providencia: el backend la busca dentro de esa sala y desde otra no la encuentra.

**La relatoría no indexa frases largas.** `buscar_jurisprudencia` con varias palabras («mora querella policiva») hace que el buscador de la Corte responda con un aviso de «búsquedas flexibles» y 0 resultados. El servidor lo detecta, reintenta con la palabra más distintiva del término («querella») y lo anuncia en la respuesta: «La relatoría no indexa la frase completa; se buscó con el núcleo «X»». Verifica la pertinencia del resultado contra lo que buscabas.

## Para desarrolladores

```bash
npm install
npm run check              # typecheck + lint + pruebas de biblioteca + de extremo a extremo
npm run medir              # métricas: bundle, arranque, índices y una fila por herramienta (p50/p95/peticiones/bytes)
npm run generar-indice     # regenera datos/indice-tematico.json (~20 MB de descarga)
npm run generar-indice-suin # regenera datos/indice-suin.json (unos segundos: pagina el índice del portal de SUIN)
npm run pack               # produce normativa-colombia.mcpb
npm run salud              # healthcheck interno: sondea en paralelo los portales que consulta el servidor (OK / LENTO / CAÍDO, con latencia)
```

`datos/` **sí está versionado**: sin él un clon limpio no pasa las pruebas. Regenéralo solo cuando quieras actualizarlo.

Las pruebas consultan los portales oficiales. `SIN_RED=1 npm test` corre solo la lógica pura, útil para iterar rápido o sin conexión.

No hay integración continua: `npm run check` se corre a mano antes de publicar. Conviene ejecutarlo cada tanto aunque no se haya tocado el código, porque es lo que detecta que un portal cambió su HTML.

El fichero `glama.json` de la raíz declara los metadatos del servidor en el [registro de Glama](https://glama.ai/mcp/servers/Angelthebestone/Normativa-colombiana-MCP) (schema oficial con `maintainers`); se empaqueta en el `.mcpb` y viaja en el paquete npm. El checklist de calidad y el diagnóstico de las descripciones de las herramientas viven en `CALIDAD_HERRAMIENTAS_GLAMA.md` (nota de trabajo, no se publica en npm).

Estructura:

| Archivo | Responsabilidad |
| --- | --- |
| `src/index.ts` | Herramientas y prompts MCP |
| `src/nucleo/` | Núcleo compartido: `parse.ts` (extracción y limpieza de HTML, troceado, canario anti-rotura), `citas.ts` (parser de citas), `codigos.ts` (los códigos por su nombre y su cobertura), `http.ts` (cliente HTTP con la cadena TLS completa), `ca.ts` (intermedios TLS), `evidencia.ts`, `compiladas.ts`, `alternativas.ts`, `entidades.ts`, `jerarquia.ts`, `perfiles.ts`, `indice.ts`, `expediente.ts`, `actualizacion.ts`, `deduplicar.ts`, `portal-roto.ts`, `snapshot.ts` |
| `src/herramientas/` | Handlers de herramientas MCP: `obtener_documento.ts`, `diff.ts` (comparación de artículos), V2 (`analizar_conflicto`, `cambios_desde`, `comparar_articulos`, `consultar_jerarquia`, `consultar_perfil`, `consultar_vigencia`, `expedientes`, `historial_norma`, `validar_cita`, `buscar_unificado`); `resolver_cita` está en `index.ts` |
| `src/fuentes/gestor.ts` | Gestor Normativo (HTML raspado, con canarios) |
| `src/fuentes/suin.ts` | SUIN-Juriscol: ficha, vigencia e índice empaquetado |
| `src/fuentes/normograma.ts` | Normograma de la DIAN (JSON) |
| `src/fuentes/jurisprudencia/` | Tres tribunales: `corte.ts` (relatoría Constitucional, JSON), `cortesuprema.ts` (GraphQL), `consejoestado.ts` (WebForms, sin API) |
| `src/fuentes/sectorial/` | Reguladores sectoriales (CREG, ANH, UPME, ANLA y 11 más vía `buscar_normativa_sectorial`) |
| `scripts/medir.ts` | Banco de métricas, para que optimizar no sea a ojo |
| `scripts/verificar.ts` | `npm run verificar`: comando único de salud (build → typecheck → lint → unit → cobertura tool→caso → red → barridos) |
| `scripts/barrido-terminos.ts` | `npm run barrido-terminos`: detecta "término que antes rendía y ahora vacío" por fuente (regresión de portal) |
| `test/smoke.ts` | Pruebas de biblioteca contra las fuentes reales |
| `test/e2e.ts` | Arranca el servidor y le habla por stdio, como cualquier cliente MCP |
| `test/red*.ts` | Red de regresión: casos por dominio leyendo `content[0].text` crudo e `isError` |

Las instrucciones de uso que recibe el modelo están en `INSTRUCCIONES`, en `src/index.ts`: son el único mecanismo que orienta *qué* herramienta se elige, cosa que ninguna prueba puede verificar.

Dos notas para quien vaya a tocar esto:

- **Cuatro portales envían la cadena TLS incompleta.** `funcionpublica.gov.co` presenta un certificado de «Sectigo RSA Organization Validation» pero manda el intermedio de Domain Validation; `suin-juriscol.gov.co`, `sic.gov.co` y `www.corteconstitucional.gov.co` (intermedio «Go Daddy Secure Certificate Authority - G2») omiten directamente el suyo. `curl` lo tolera porque su bundle ya los trae; Node no. `src/nucleo/ca.ts` incluye los cuatro intermedios para completar la cadena **sin desactivar la verificación**: las raíces que los firman sí vienen con Node. No lo cambies por `rejectUnauthorized: false`.
- **Los códigos HTTP mienten en dos fuentes.** El backend de la Corte Suprema responde 200 con una página de mantenimiento ante rutas inventadas, y la relatoría de la Constitucional devuelve el armazón de su SPA en vez de un 404. Por eso los canarios validan la forma de la respuesta y nunca el código de estado.
- **El canario.** Si el HTML del portal cambia, los parsers lanzan `CanarioError` en vez de devolver listas vacías. Es deliberado: una lista vacía silenciosa se lee como «no existe esa norma», y en materia legal esa confusión es el peor fallo posible.
- **Un fallo de red nunca se presenta como un vacío.** `buscar_unificado` distingue "respondió sin nada" de "no se pudo consultar: <mensaje>" por fuente; una fuente caída no autoriza a concluir que no hay resultados ahí.
- **La SIC vive en la sede electrónica.** El repositorio viejo (`www.sic.gov.co/repositorio-de-normatividad`) responde 301 a `sedeelectronica.sic.gov.co/transparencia/normativa/busqueda-de-normas/entidad`; el adaptador apunta directo a la sede porque `pedir` no sigue redirecciones.

## Contribuir

Las guías están en [CONTRIBUTING.md](CONTRIBUTING.md), y hay cuatro reglas que no se negocian: el canario nunca devuelve vacío en silencio, no se desactiva la verificación TLS, no se sube el ritmo de peticiones a los portales y ninguna respuesta afirma vigencia.

Si el servidor te dio una respuesta incorrecta, ese es el reporte más valioso: hay una [plantilla de issue](https://github.com/Angelthebestone/Normativa-colombiana-MCP/issues/new/choose) para eso.

Para reportar una vulnerabilidad, mira [SECURITY.md](SECURITY.md); no abras un issue público.

## Licencia

Código bajo licencia MIT (ver [LICENSE](LICENSE)). Sobre los contenidos normativos y el acceso automatizado a los portales, mira [NOTICE.md](NOTICE.md).
