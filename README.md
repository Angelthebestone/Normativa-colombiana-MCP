# Normativa Colombia — servidor MCP

[![npm](https://img.shields.io/npm/v/normativa-colombia-mcp.svg)](https://www.npmjs.com/package/normativa-colombia-mcp)
[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-servidor-black.svg)](https://modelcontextprotocol.io)

Consulta la normativa y la jurisprudencia colombiana desde cualquier asistente de IA que hable [Model Context Protocol](https://modelcontextprotocol.io), sin abrir el navegador ni pelear con formularios.

Conecta dos fuentes oficiales:

- **Gestor Normativo** del Departamento Administrativo de la Función Pública — leyes, decretos, resoluciones, circulares y conceptos del sector público, con la consulta temática y los *restrictores* que explican por qué cada norma aplica a un tema.
- **Relatoría de la Corte Constitucional** — 49.000 sentencias y autos, actualizados a diario.

Es un servidor MCP estándar que se comunica por **stdio**, así que sirve en Claude Desktop, Claude Code, Cursor, VS Code, Windsurf, Zed, Continue, LM Studio, agentes propios hechos con los SDK de MCP y cualquier cliente que aparezca después.

---

## Instalación

### Opción A — Claude Desktop, con un clic

La más sencilla si usas Claude Desktop: no requiere Node ni tocar archivos de configuración.

1. Descarga `normativa-colombia.mcpb` desde [Releases](https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases).
2. Abre Claude Desktop → **Configuración → Extensiones**.
3. Arrastra el archivo a esa ventana y confirma.

Claude Desktop trae su propio Node, así que no hace falta instalar nada más.

### Opción B — cualquier otro cliente MCP, con `npx`

Requiere **Node 18 o superior**. No hay que clonar ni compilar nada: el paquete de npm trae el servidor ya construido y el índice temático dentro.

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

Al conectarse, el servidor entrega **11 herramientas**, **4 prompts** y sus **propias instrucciones de uso**: a qué tipo de pregunta corresponde cada herramienta, que debe citarse siempre la fuente y que nunca debe afirmarse que una norma está vigente. Los clientes que respetan el campo `instructions` del protocolo lo aprovechan sin configurar nada.

## Qué puedes preguntar

- «¿Qué dice la Ley 1221 de 2008 sobre el auxilio de conectividad?»
- «¿Qué normas regulan el teletrabajo en el sector público y por qué aplican?»
- «¿Qué dice el Decreto 1083 sobre encargos?»
- «Búscame jurisprudencia reciente de la Corte Constitucional sobre estabilidad laboral reforzada.»
- «¿La Ley 909 de 2004 sigue vigente?»

El servidor incluye además cuatro prompts listos, que los clientes que los soportan muestran como comandos: *¿Qué normas aplican sobre un tema?*, *¿Esta norma sigue vigente?*, *Explícame esta norma en lenguaje sencillo* y *Compara dos normas*.

## Lo que debes saber antes de confiar en una respuesta

**Esto no es asesoría jurídica.** Es un buscador que le da a un asistente de IA acceso a fuentes oficiales. Verifica siempre en el enlace que acompaña cada respuesta.

**La vigencia no es un dato del portal.** Ni el Gestor ni la relatoría tienen un campo que diga «esta norma está derogada»: las derogatorias van escritas dentro del texto. El servidor avisa cuando detecta marcas de «Derogado» o «Modificado por», pero no puede garantizar que un artículo siga vigente. El Decreto 1083 de 2015, por ejemplo, contiene 155 notas de modificación.

**El buscador del Gestor no busca en el texto completo**, solo en los resúmenes temáticos, y une los términos con OR. Su índice de palabras además es muy pobre: «teletrabajo» casa con 3 documentos en todo el portal, y con ninguno de los 43 conceptos que sí están clasificados bajo ese subtema. El servidor compensa de tres formas: quita las palabras vacías antes de consultar, reintenta por el subtema oficial cuando la búsqueda por palabras rinde poco, y busca dentro del articulado en tu computador cuando pides una norma concreta.

**Ritmo de consulta.** El servidor hace como máximo una petición por segundo sostenida a cada portal, con ráfagas de hasta cinco, y nunca dos a la vez al mismo sitio. Si un portal responde que está limitando las consultas, espera lo que él indique en vez de insistir. Son servicios públicos y conviene que un asistente automático les pese menos que una persona navegando.

**Privacidad.** Cada consulta viaja a servidores del Estado colombiano, que registran las peticiones y tu dirección IP, igual que si navegaras el sitio. No se envía nada a ningún otro servidor, no hay analítica y no se recoge información tuya. Tenlo en cuenta si vas a consultar sobre un asunto propio.

**Datos empaquetados.** Se incluye un índice temático (12.054 subtemas) para responder al instante y seguir sirviendo si el portal se cae. Ese índice tiene fecha: si supera los tres meses, el servidor te lo advierte.

## Para desarrolladores

```bash
npm install
npm run check             # typecheck + lint + 30 pruebas de biblioteca + 18 de extremo a extremo
npm run generar-indice    # regenera datos/indice-tematico.json (~20 MB de descarga)
npm run pack              # produce normativa-colombia.mcpb
```

`datos/indice-tematico.json` no está versionado por su tamaño: genéralo antes de empaquetar.

Las pruebas consultan los portales oficiales. `SIN_RED=1 npm test` corre solo la lógica pura, útil para iterar rápido o sin conexión.

No hay integración continua: `npm run check` se corre a mano antes de publicar. Conviene ejecutarlo cada tanto aunque no se haya tocado el código, porque es lo que detecta que un portal cambió su HTML.

Estructura:

| Archivo | Responsabilidad |
| --- | --- |
| `src/index.ts` | Herramientas y prompts MCP |
| `src/parse.ts` | Extracción y limpieza de HTML, troceado, canario anti-rotura |
| `src/citas.ts` | Parser de citas normativas colombianas |
| `src/http.ts` | Cliente HTTP con la cadena TLS completa |
| `src/fuentes/gestor.ts` | Gestor Normativo (HTML) |
| `src/fuentes/corte.ts` | Relatoría de la Corte Constitucional (JSON) |
| `test/smoke.ts` | Pruebas de biblioteca contra las fuentes reales |
| `test/e2e.ts` | Arranca el servidor y le habla por stdio, como cualquier cliente MCP |

Las instrucciones de uso que recibe el modelo están en `INSTRUCCIONES`, en `src/index.ts`: son el único mecanismo que orienta *qué* herramienta se elige, cosa que ninguna prueba puede verificar.

Dos notas para quien vaya a tocar esto:

- **El portal envía una cadena TLS incompleta.** Su certificado lo emite «Sectigo RSA Organization Validation», pero el servidor manda el intermedio de «Domain Validation». `curl` lo tolera porque su bundle ya trae ese certificado; Node no. `src/ca.ts` incluye el intermedio correcto para completar la cadena **sin desactivar la verificación**. No lo cambies por `rejectUnauthorized: false`.
- **El canario.** Si el HTML del portal cambia, los parsers lanzan `CanarioError` en vez de devolver listas vacías. Es deliberado: una lista vacía silenciosa se lee como «no existe esa norma», y en materia legal esa confusión es el peor fallo posible.

## Contribuir

Las guías están en [CONTRIBUTING.md](CONTRIBUTING.md), y hay cuatro reglas que no se negocian: el canario nunca devuelve vacío en silencio, no se desactiva la verificación TLS, no se sube el ritmo de peticiones a los portales y ninguna respuesta afirma vigencia.

Si el servidor te dio una respuesta incorrecta, ese es el reporte más valioso: hay una [plantilla de issue](https://github.com/Angelthebestone/Normativa-colombiana-MCP/issues/new/choose) para eso.

Para reportar una vulnerabilidad, mira [SECURITY.md](SECURITY.md); no abras un issue público.

## Licencia

Código bajo licencia MIT (ver [LICENSE](LICENSE)). Sobre los contenidos normativos y el acceso automatizado a los portales, mira [NOTICE.md](NOTICE.md).
