## Why

Las versiones salen cada pocos días, y quien instala la extensión no se entera de ellas ni sabe qué tiene que hacer para recibirlas. El aviso actual (`src/nucleo/actualizacion.ts`) tiene cuatro problemas:

- Calla los parches. La 1.15.2, que cambia el formato de salida, no la anuncia a nadie que esté en la 1.15.x.
- Da la misma instrucción a todos y promete algo que no siempre es cierto: «Si la instalaste con npx se actualiza sola al reiniciar». Quien usa el `.mcpb`, una copia local o una versión fijada no recibe nada al reiniciar.
- Comprueba la versión solo después de la primera llamada, así que el aviso nunca llega en la primera respuesta, al contrario de lo que dice su comentario.
- Medido el 2026-10-04 con npm 11.11: `npx -y normativa-colombia-mcp` sin versión pasó solo de 1.15.1 a 1.15.2 al arrancar, así que el canal npx ya se actualiza. Los demás canales no pueden hacerlo desde el código, y lo único que puede hacer el servidor por ellos es decirles exactamente qué hacer.

## What Changes

- **Aviso de cualquier versión mayor**, parches incluidos, una sola vez por proceso. Nunca se avisa de una versión anterior ni de una igual. **BREAKING** respecto a la regla vigente de no anunciar parches; la prueba de humo que la fija se reescribe.
- **Comprobación al arrancar el proceso**, sin retrasar el `initialize`. El aviso sale en la primera respuesta si el registro ya contestó, o en la siguiente si no. Un registro que no contesta en 3 s sigue sin degradar nada.
- **Instrucción según el canal de instalación**, detectado por el propio proceso:
  - **`.mcpb`:** enlace al release de la versión nueva. El manifiesto declara el canal en el entorno.
  - **npx sin versión o con `@latest`:** se instala sola al reiniciar el cliente MCP.
  - **npx con una versión fijada:** decir que está fijada y cómo cambiarla.
  - **`npm install` en un proyecto:** el comando para actualizar.
  - **copia del código:** `git pull`, `npm install` y `npm run build`.
  - **canal desconocido:** el enlace a los releases.
- **README:** una sección «Actualizaciones» que diga qué canal se actualiza solo y qué hacer en cada uno, con la medición de npx.

## Capabilities

### New Capabilities
- `actualizacion/aviso-version`: cuándo se comprueba si hay versión nueva, de qué versiones se avisa, cuántas veces y qué instrucción recibe cada canal de instalación.

### Modified Capabilities
<!-- Ninguna: no hay spec previa del aviso de versión. -->

## Impact

- **Código:** `src/nucleo/actualizacion.ts` (comparación de versiones, detección de canal, texto del aviso, momento de la comprobación) y `src/index.ts` (disparar la comprobación al arrancar).
- **Manifiesto:** `manifest.json`, donde `server.mcp_config.env` declara el canal `.mcpb`. `scripts/construir.ts` reescribe el manifiesto, así que hay que comprobar que conserve la variable.
- **Pruebas:** `test/smoke.ts` (la prueba de `mereceAviso` fija hoy que los parches no se anuncian) y pruebas nuevas, sin red, de la detección de canal y del texto.
- **Documentación:** `README.md` y `CHANGELOG.md`.
- **API pública:** sin herramientas ni parámetros nuevos. Cambia el texto del pie de una respuesta por proceso.
- **Red:** la consulta a `registry.npmjs.org` pasa de hacerse tras la primera llamada a hacerse al arrancar, con la misma frecuencia (una por proceso).
- **Fuera de alcance:** que el servidor descargue y sustituya su propio código (ejecución remota sin consentimiento), la publicación en directorios de extensiones de los clientes, la telemetría y el aviso fuera de las respuestas (notificaciones MCP, logs).
