# Normativa Colombia — extensión para Claude

Consulta la normativa y la jurisprudencia colombiana directamente desde Claude, sin abrir el navegador ni pelear con formularios.

Conecta dos fuentes oficiales:

- **Gestor Normativo** del Departamento Administrativo de la Función Pública — leyes, decretos, resoluciones, circulares y conceptos del sector público, con la consulta temática y los *restrictores* que explican por qué cada norma aplica a un tema.
- **Relatoría de la Corte Constitucional** — 49.000 sentencias y autos, actualizados a diario.

## Instalación (no necesitas saber programar)

1. Descarga `normativa-colombia.mcpb` desde [Releases](https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases).
2. Abre Claude Desktop → **Configuración → Extensiones**.
3. Arrastra el archivo a esa ventana y confirma.

No hace falta instalar nada más: Claude Desktop trae todo lo necesario.

## Qué puedes preguntar

- «¿Qué dice la Ley 1221 de 2008 sobre el auxilio de conectividad?»
- «¿Qué normas regulan el teletrabajo en el sector público y por qué aplican?»
- «¿Qué dice el Decreto 1083 sobre encargos?»
- «Búscame jurisprudencia reciente de la Corte Constitucional sobre estabilidad laboral reforzada.»
- «¿La Ley 909 de 2004 sigue vigente?»

La extensión también añade comandos listos en Claude Desktop: *¿Qué normas aplican sobre un tema?*, *¿Esta norma sigue vigente?*, *Explícame esta norma en lenguaje sencillo* y *Compara dos normas*.

## Lo que debes saber antes de confiar en una respuesta

**Esto no es asesoría jurídica.** Es un buscador que le da a Claude acceso a fuentes oficiales. Verifica siempre en el enlace que acompaña cada respuesta.

**La vigencia no es un dato del portal.** Ni el Gestor ni la relatoría tienen un campo que diga «esta norma está derogada»: las derogatorias van escritas dentro del texto. La extensión avisa cuando detecta marcas de «Derogado» o «Modificado por», pero no puede garantizar que un artículo siga vigente. El Decreto 1083 de 2015, por ejemplo, contiene 155 notas de modificación.

**El buscador del Gestor no busca en el texto completo**, solo en los resúmenes temáticos, y une los términos con OR. Su índice de palabras además es muy pobre: «teletrabajo» casa con 3 documentos en todo el portal, y con ninguno de los 43 conceptos que sí están clasificados bajo ese subtema. La extensión compensa de tres formas: quita las palabras vacías antes de consultar, reintenta por el subtema oficial cuando la búsqueda por palabras rinde poco, y busca dentro del articulado en tu computador cuando pides una norma concreta.

**Ritmo de consulta.** La extensión hace como máximo una petición por segundo sostenida a cada portal, con ráfagas de hasta cinco, y nunca dos a la vez al mismo sitio. Si un portal responde que está limitando las consultas, espera lo que él indique en vez de insistir. Son servicios públicos y conviene que un asistente automático les pese menos que una persona navegando.

**Privacidad.** Cada consulta viaja a servidores del Estado colombiano, que registran las peticiones y tu dirección IP, igual que si navegaras el sitio. No se envía nada a ningún otro servidor, no hay analítica y no se recoge información tuya. Tenlo en cuenta si vas a consultar sobre un asunto propio.

**Datos empaquetados.** La extensión incluye un índice temático (12.054 subtemas) para responder al instante y seguir sirviendo si el portal se cae. Ese índice tiene fecha: si supera los tres meses, la extensión te lo advierte.

## Para desarrolladores

```bash
npm install
npm run check             # typecheck + lint + 30 pruebas de biblioteca + 17 de extremo a extremo
npm run generar-indice    # regenera datos/indice-tematico.json (~20 MB de descarga)
npm run pack              # produce normativa-colombia.mcpb
```

`datos/indice-tematico.json` no está versionado por su tamaño: genéralo antes de empaquetar.

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
| `test/e2e.ts` | Arranca el servidor y le habla por stdio, como Claude Desktop |

Dos notas para quien vaya a tocar esto:

- **El portal envía una cadena TLS incompleta.** Su certificado lo emite «Sectigo RSA Organization Validation», pero el servidor manda el intermedio de «Domain Validation». `curl` lo tolera porque su bundle ya trae ese certificado; Node no. `src/ca.ts` incluye el intermedio correcto para completar la cadena **sin desactivar la verificación**. No lo cambies por `rejectUnauthorized: false`.
- **El canario.** Si el HTML del portal cambia, los parsers lanzan `CanarioError` en vez de devolver listas vacías. Es deliberado: una lista vacía silenciosa se lee como «no existe esa norma», y en materia legal esa confusión es el peor fallo posible.

## Licencia

MIT (ver [LICENSE](LICENSE)). Los contenidos normativos son de sus entidades emisoras y públicos por mandato de la Ley 1712 de 2014.
