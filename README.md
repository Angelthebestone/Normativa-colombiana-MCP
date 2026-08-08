# Normativa Colombia — servidor MCP

[![npm](https://img.shields.io/npm/v/normativa-colombia-mcp.svg)](https://www.npmjs.com/package/normativa-colombia-mcp)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-servidor-black.svg)](https://modelcontextprotocol.io)

Consulta la normativa y la jurisprudencia colombiana desde cualquier asistente de IA que hable [Model Context Protocol](https://modelcontextprotocol.io), sin abrir el navegador ni pelear con formularios.

Conecta seis fuentes oficiales:

- **Gestor Normativo** del Departamento Administrativo de la Función Pública — leyes, decretos, resoluciones, circulares y conceptos del sector público, con la consulta temática y los *restrictores* que explican por qué cada norma aplica a un tema.
- **Relatoría de la Corte Constitucional** — 49.000 sentencias y autos, actualizados a diario.
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

Claude Desktop trae su propio Node, así que no hace falta instalar nada más.

### Opción B — cualquier otro cliente MCP, desde npm

Publicado como [`normativa-colombia-mcp`](https://www.npmjs.com/package/normativa-colombia-mcp). Requiere **Node 18 o superior**. No hay que clonar ni compilar nada: el paquete trae el servidor ya construido y el índice temático dentro, y no arrastra ninguna dependencia.

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
claude mcp add normativa-colombia -- npx -y normativa-colombia-mcp
```

**VS Code** usa la clave `servers` en vez de `mcpServers`, en `.mcp.json` del proyecto o en la configuración de usuario:

```json
{
  "servers": {
    "normativa-colombia": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "normativa-colombia-mcp"]
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
npm run build            # genera server/index.js
```

Después se apunta el cliente a `node /ruta/absoluta/a/Normativa-colombiana-MCP/server/index.js`, con el mismo formato de arriba. Funciona desde cualquier directorio de trabajo.

### Qué recibe el cliente

Al conectarse, el servidor entrega **34 herramientas**, **5 prompts** y sus **propias instrucciones de uso**: a qué tipo de pregunta corresponde cada herramienta, que debe citarse siempre la fuente y que nunca debe afirmarse por cuenta propia que una norma está vigente. Los clientes que respetan el campo `instructions` del protocolo lo aprovechan sin configurar nada.

| Fuente | Herramientas |
| --- | --- |
| Cualquiera (punto de entrada) | `resolver_cita` — cita exacta → norma o sentencia, con su vigencia si consta; `validar_cita` — comprueba cita y enlace |
| Gestor Normativo | `buscar_normas`, `buscar_por_tema`, `obtener_norma`, `listar_catalogos`, `listar_subtemas`, `explicar_relacion_tema`, `buscar_conceptos_fp`, `listar_normas_fp` |
| Corte Constitucional | `buscar_jurisprudencia`, `obtener_sentencia` |
| Corte Suprema | `buscar_jurisprudencia_suprema`, `obtener_providencia_suprema` |
| Consejo de Estado | `buscar_jurisprudencia_consejo_estado`, `obtener_providencia_consejo_estado` |
| SUIN-Juriscol | `buscar_en_suin` |
| DIAN | `buscar_normativa_tributaria`, `obtener_documento_dian` |
| V2 — jerarquía y conflictos | `consultar_por_jerarquia`, `analizar_conflicto`, `comparar_articulos`, `cambios_desde` |
| V2 — perfiles y expedientes | `consultar_perfil`, `expediente_crear`, `expediente_agregar`, `expediente_leer` |

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

### Herramientas V2 (v1.10.0)

Sobre la capa común de metadatos, evidencia y normalización:

- **`consultar_por_jerarquia`** filtra por nivel (constitución, ley, decreto, resolución, concepto, jurisprudencia) y explica el carácter de cada uno. El Gestor no cataloga la Constitución como tipo: para ese nivel se orienta.
- **`validar_cita`** comprueba que una cita y su enlace son de verdad: número/año contra el título, dominio del enlace, id de la norma y existencia del artículo. Clasifica en "validada", "parcialmente validada" o "no fue posible validar"; nunca afirma vigencia.
- **`analizar_conflicto`** reúne EVIDENCIA de un posible conflicto entre dos normas (identificación, vigencia según SUIN si consta, jerarquía, reformas anotadas, pasajes sobre un tema). **No detecta contradicciones semánticas** y el resultado es un conflicto POTENCIAL, no una conclusión jurídica.
- **`cambios_desde`** resume los cambios (modificación, derogación, adición) que el Gestor anota sobre **las normas que se le listan**, filtrados por el año de la norma modificadora. **No rastrea novedades** por su cuenta.
- **`comparar_articulos`** compara el texto de un artículo entre dos normas, marca lo añadido/eliminado, clasifica cada diferencia por patrones (plazo, sanción, excepción, sujeto obligado) y agrupa los cambios editoriales por similitud léxica (Dice sobre bigramas ≥0,92): «una línea» → «una sola línea» sale como cambio menor, no como añadido+eliminado. Lo no clasificado se marca "revisar manualmente". Sin modelo semántico.
- **`consultar_perfil`** ejecuta una consulta con las fuentes y filtros preconfigurados de un perfil: `laboral`, `tributario`, `ambiental`, `contratacion_estatal`, `energia`. Cada perfil declara su advertencia en la respuesta.
- **Expedientes temporales**: `expediente_crear`, `expediente_agregar` y `expediente_leer` agrupan consultas, citas y observaciones de una investigación **en memoria** (expiran en 6 h, se pierden al reiniciar). **Desactivados por defecto**: se activan con la variable de entorno `EXPEDIENTES=1`.

Una regla de oro de las V2: si una cita viene sin año y el número es ambiguo ("Decreto 1072" son cuatro), la herramienta **no elige por ti**: lista los candidatos y pide el año.

## Lo que debes saber antes de confiar en una respuesta

**Esto no es asesoría jurídica.** Es un buscador que le da a un asistente de IA acceso a fuentes oficiales. Verifica siempre en el enlace que acompaña cada respuesta.

**La vigencia viene de SUIN, y solo de SUIN.** Ni el Gestor ni la relatoría tienen un campo que diga «esta norma está derogada»: las derogatorias van escritas dentro del texto, y el servidor se limita a avisar cuando detecta marcas de «Derogado» o «Modificado por» (el Decreto 1083 de 2015 contiene 155 notas de modificación). SUIN-Juriscol, del Ministerio de Justicia, sí publica el estado como dato, y es la única fuente del país que lo hace: cuando la norma está en el índice empaquetado, `resolver_cita` devuelve ese estado con su enlace.

Tres advertencias sobre ese dato, todas comprobadas:

- **Se entrega literal, nunca traducido a un sí o un no.** SUIN distingue «Vigente», «DEROGADO», «Vigencia en Estudio», «Compilado», «Declarado Inexequible» y «Norma no vigente porque agotó su objeto». «Vigencia en Estudio» no significa vigente.
- **El estado se lee del registro del documento, no de su prosa.** Donde aparecen los dos se contradicen: la Ley 1541 de 2012 muestra «Vigente» en pantalla y «Vigencia en Estudio» en su campo.
- **El buscador de SUIN no sirve para esto.** `buscar_en_suin` devuelve un campo de vigencia que viene de su índice de búsqueda y contradice la ficha —la Ley 74 de 1923 figura allí como «Vigencia en Estudio» y su ficha dice DEROGADO—, así que se marca como no fiable en cada respuesta.

Y la regla de fondo no cambia: **verifica en el enlace antes de actuar.**

**El buscador del Gestor no busca en el texto completo**, solo en los resúmenes temáticos, y une los términos con OR. Su índice de palabras además es muy pobre: «teletrabajo» casa con 3 documentos en todo el portal, y con ninguno de los 43 conceptos que sí están clasificados bajo ese subtema. El servidor compensa de tres formas: quita las palabras vacías antes de consultar, reintenta por el subtema oficial cuando la búsqueda por palabras rinde poco, y busca dentro del articulado en tu computador cuando pides una norma concreta.

**Ritmo de consulta.** El servidor hace como máximo una petición por segundo sostenida a cada portal, con ráfagas de hasta cinco, y nunca dos a la vez al mismo sitio. Si un portal responde que está limitando las consultas, espera lo que él indique en vez de insistir. Son servicios públicos y conviene que un asistente automático les pese menos que una persona navegando.

**Privacidad.** Cada consulta viaja a servidores del Estado colombiano, que registran las peticiones y tu dirección IP, igual que si navegaras el sitio. No se envía nada a ningún otro servidor, no hay analítica y no se recoge información tuya. Tenlo en cuenta si vas a consultar sobre un asunto propio.

**Datos empaquetados.** Se incluyen dos índices, ambos con fecha de generación:

- El **temático** (12.063 subtemas) responde al instante y sigue sirviendo si el portal se cae. Si supera los tres meses, el servidor te lo advierte.
- El de **SUIN** (11.599 documentos, de 1844 a 2026) traduce una cita a su documento, porque SUIN no tiene buscador utilizable. La vigencia se consulta en vivo; el índice solo dice dónde mirar. **Cubre leyes, no decretos**: los sitemaps de decretos del portal devuelven 404, así que para un decreto la vigencia normalmente no consta —lo que no significa ni que esté vigente ni que esté derogado.

**Cobertura de la búsqueda tributaria.** La primera consulta de cada término a la DIAN tarda unos 20 segundos: su portal devuelve el resultado completo y no admite límite. Las páginas siguientes del mismo término son instantáneas, así que conviene paginar en lugar de repetir búsquedas.

**El enlace del Consejo de Estado caduca; el radicado no.** `buscar_jurisprudencia_consejo_estado` entrega, junto a cada providencia, un token firmado que emite el propio buscador y con el que `obtener_providencia_consejo_estado` saca el texto del PDF. Ese token **vive una hora**: sirve para leer, no para citar. Para citar se usa el radicado. Si caducó, se repite la búsqueda y sale uno nuevo.

**El texto de la Corte Suprema se pide con su ruta y su sala.** `buscar_jurisprudencia_suprema` devuelve la referencia, el ponente, la fecha y las normas citadas; `obtener_providencia_suprema` devuelve el texto completo, pero exige la MISMA sala con la que apareció la providencia: el backend la busca dentro de esa sala y desde otra no la encuentra.

**La relatoría no indexa frases largas.** `buscar_jurisprudencia` con varias palabras («mora querella policiva») hace que el buscador de la Corte responda con un aviso de «búsquedas flexibles» y 0 resultados. El servidor lo detecta, reintenta con la palabra más distintiva del término («querella») y lo anuncia en la respuesta: «La relatoría no indexa la frase completa; se buscó con el núcleo «X»». Verifica la pertinencia del resultado contra lo que buscabas.

## Para desarrolladores

```bash
npm install
npm run check              # typecheck + lint + 36 pruebas de biblioteca + 25 de extremo a extremo
npm run medir              # métricas: tamaño del bundle, arranque, coste de los índices
npm run generar-indice     # regenera datos/indice-tematico.json (~20 MB de descarga)
npm run generar-indice-suin # regenera datos/indice-suin.json (~45 min; reanudable)
npm run pack               # produce normativa-colombia.mcpb
```

`datos/` **sí está versionado**: sin él un clon limpio no pasa las pruebas, y el índice de SUIN cuesta 45 minutos de peticiones a un servicio público. Regenéralos solo cuando quieras actualizarlos.

Las pruebas consultan los portales oficiales. `SIN_RED=1 npm test` corre solo la lógica pura, útil para iterar rápido o sin conexión.

No hay integración continua: `npm run check` se corre a mano antes de publicar. Conviene ejecutarlo cada tanto aunque no se haya tocado el código, porque es lo que detecta que un portal cambió su HTML.

El fichero `glama.json` de la raíz declara los metadatos del servidor en el [registro de Glama](https://glama.ai/mcp/servers/Angelthebestone/Normativa-colombiana-MCP) (schema oficial con `maintainers`); se empaqueta en el `.mcpb` y viaja en el paquete npm. El checklist de calidad y el diagnóstico de las descripciones de las herramientas viven en `CALIDAD_HERRAMIENTAS_GLAMA.md` (nota de trabajo, no se publica en npm).

Estructura:

| Archivo | Responsabilidad |
| --- | --- |
| `src/index.ts` | Herramientas y prompts MCP |
| `src/parse.ts` | Extracción y limpieza de HTML, troceado, canario anti-rotura |
| `src/citas.ts` | Parser de citas normativas colombianas |
| `src/http.ts` | Cliente HTTP con la cadena TLS completa |
| `src/fuentes/gestor.ts` | Gestor Normativo (HTML raspado, con canarios) |
| `src/fuentes/corte.ts` | Relatoría de la Corte Constitucional (JSON) |
| `src/fuentes/suin.ts` | SUIN-Juriscol: ficha, vigencia e índice empaquetado |
| `src/fuentes/cortesuprema.ts` | Corte Suprema (GraphQL) |
| `src/fuentes/consejoestado.ts` | Consejo de Estado (WebForms, sin API) |
| `src/fuentes/normograma.ts` | Normograma de la DIAN (JSON) |
| `scripts/medir.ts` | Banco de métricas, para que optimizar no sea a ojo |
| `test/smoke.ts` | Pruebas de biblioteca contra las fuentes reales |
| `test/e2e.ts` | Arranca el servidor y le habla por stdio, como cualquier cliente MCP |

Las instrucciones de uso que recibe el modelo están en `INSTRUCCIONES`, en `src/index.ts`: son el único mecanismo que orienta *qué* herramienta se elige, cosa que ninguna prueba puede verificar.

Dos notas para quien vaya a tocar esto:

- **Dos portales envían la cadena TLS incompleta.** `funcionpublica.gov.co` presenta un certificado de «Sectigo RSA Organization Validation» pero manda el intermedio de Domain Validation; `suin-juriscol.gov.co` omite directamente el suyo. `curl` lo tolera porque su bundle ya los trae; Node no. `src/ca.ts` incluye ambos intermedios para completar la cadena **sin desactivar la verificación**: las raíces que los firman sí vienen con Node. No lo cambies por `rejectUnauthorized: false`.
- **Los códigos HTTP mienten en dos fuentes.** El backend de la Corte Suprema responde 200 con una página de mantenimiento ante rutas inventadas, y la relatoría de la Constitucional devuelve el armazón de su SPA en vez de un 404. Por eso los canarios validan la forma de la respuesta y nunca el código de estado.
- **El canario.** Si el HTML del portal cambia, los parsers lanzan `CanarioError` en vez de devolver listas vacías. Es deliberado: una lista vacía silenciosa se lee como «no existe esa norma», y en materia legal esa confusión es el peor fallo posible.

## Contribuir

Las guías están en [CONTRIBUTING.md](CONTRIBUTING.md), y hay cuatro reglas que no se negocian: el canario nunca devuelve vacío en silencio, no se desactiva la verificación TLS, no se sube el ritmo de peticiones a los portales y ninguna respuesta afirma vigencia.

Si el servidor te dio una respuesta incorrecta, ese es el reporte más valioso: hay una [plantilla de issue](https://github.com/Angelthebestone/Normativa-colombiana-MCP/issues/new/choose) para eso.

Para reportar una vulnerabilidad, mira [SECURITY.md](SECURITY.md); no abras un issue público.

## Licencia

Código bajo licencia MIT (ver [LICENSE](LICENSE)). Sobre los contenidos normativos y el acceso automatizado a los portales, mira [NOTICE.md](NOTICE.md).
