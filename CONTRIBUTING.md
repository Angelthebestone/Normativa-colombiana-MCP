# Cómo contribuir

Gracias por el interés. Este proyecto le da a Claude acceso a normativa oficial colombiana, así que hay gente que va a tomar decisiones laborales y disciplinarias con lo que responda. Eso condiciona cómo se contribuye.

## Empezar

```bash
git clone https://github.com/Angelthebestone/Normativa-colombiana-MCP.git
cd Normativa-colombiana-MCP
npm install
npm run generar-indice   # ~20 MB de descarga; no está versionado por su tamaño
npm run check            # typecheck + lint + pruebas de biblioteca + de extremo a extremo
```

Hace falta Node 22 o superior (se usa TypeScript nativo, sin paso de compilación para los scripts).

`npm run check` consulta los portales reales. Si estás sin conexión o quieres iterar rápido, `SIN_RED=1 npm test` corre solo la lógica pura.

## Reglas que no se negocian

Son cuatro y todas nacen de errores que ya cometimos:

**1. Un parseo roto grita, no devuelve vacío.** Si un parser deja de encontrar lo que espera, lanza `CanarioError`. Una lista vacía en silencio se lee como «no existe esa norma», y esa confusión es el peor fallo posible aquí. Si añades un parser, añade su comprobación.

**2. Nunca desactives la verificación TLS.** `funcionpublica.gov.co` envía una cadena incompleta —presenta un certificado emitido por «Sectigo RSA Organization Validation» pero manda el intermedio de «Domain Validation»—. Se resuelve incluyendo el intermedio correcto en `src/ca.ts`, no con `rejectUnauthorized: false`. La autenticidad de la fuente es parte del producto.

**3. No subas el ritmo de las peticiones.** Una por segundo sostenida por dominio, ráfaga de cinco, una sola en vuelo por sitio, y respeto a `Retry-After`. Está en `src/http.ts` con el razonamiento. Si necesitas más caudal, primero explica por qué en el issue.

**4. Ninguna respuesta afirma vigencia.** Las fuentes no publican ese dato. Se trasladan las marcas del texto y se dice con claridad que no se puede confirmar.

## Antes de abrir un PR

- `npm run check` en verde.
- Si arreglas un fallo, deja una prueba que falle sin el arreglo. Los dos lotes de fallos que llegaron desde Claude Desktop se colaron porque las herramientas MCP no estaban cubiertas; por eso existe `test/e2e.ts`.
- Comprueba que tu prueba de verdad falla: rómpela a propósito una vez. Una prueba que no puede fallar no prueba nada.
- Comentarios y mensajes de commit en español, como el resto del proyecto.

## Cuando el portal cambia

Es el fallo más probable de este proyecto: los portales no tienen API documentada y pueden cambiar su HTML sin avisar. Si `npm run check` falla de repente sin que nadie haya tocado el código, es casi seguro eso. Abre un issue con la plantilla «El portal cambió» e incluye el mensaje del canario.

## Añadir una fuente

Las fuentes viven en `src/fuentes/`. Antes de escribir código, comprueba dos cosas y ponlas en el issue: qué dice el `robots.txt` del sitio y si existe una API JSON aunque no esté documentada —los bundles de JavaScript del propio sitio suelen revelarla, que es como se encontró la de la Corte Constitucional—. Sondear rutas como `/api` solo encuentra APIs que ya se anunciaban solas.

## Cómo añadir una fuente sectorial

Las sectoriales viven en `src/fuentes/sectorial/` (un fichero por entidad), se dan de alta en `registro.ts` y comparten el contrato `Adaptador` de `src/fuentes/sectorial.ts`. Además de `id`, `nombre`, `sector`, `portal`, `advertencia` y `buscar`, el contrato exige cinco campos de metadatos:

- `dominioPermitido`: URL base https del portal que publica los actos (p. ej. `https://www.sic.gov.co`).
- `tiposDocumento`: los tipos de acto que publica, como los nombra su propio portal (p. ej. `['Resolución', 'Circular']`).
- `soportaTexto`: `true` solo si el texto del acto se lee aquí; hoy todas publican PDF y valen `false`.
- `soportaVigencia`: `true` solo si el portal publica una señal de vigencia comprobable; hoy ninguna lo hace.
- `pruebasMinimas`: el nombre del test de `test/smoke.ts` que cubre la fuente.

`registrar()` valida esos campos ANTES de insertar: `dominioPermitido` debe ser una URL https válida y ninguno puede ir vacío (`tiposDocumento` con al menos un elemento); si algo falla, lanza `Error` y no deja la fuente en el registro. La firma de búsqueda es la de siempre: `buscar(opts: OpcionesSectorial): Promise<ResultadoSectorial>`, con `OpcionesSectorial` (`texto`, `anio`, `pagina`, `limite`) como entrada y `ResultadoSectorial` (`items`, `total?`, `nota?`, `url`) como salida.

## Código de conducta

Al participar aceptas el [Código de Conducta](CODE_OF_CONDUCT.md).
