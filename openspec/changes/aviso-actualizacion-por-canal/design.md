## Context

Ver proposal.md (Why). El estado actual que condiciona el enfoque:

- `src/nucleo/actualizacion.ts` guarda estado de módulo (`comprobado`, `yaAvisado`, `disponible`). La primera vez que se llama a `avisoVersion()`, la comprobación se dispara y la función devuelve vacío. La llama `txt()` en `src/index.ts`, que pone el pie de las respuestas de texto. Las respuestas con `formato: "json"` no pasan por `txt()`, así que ya no llevan el aviso.
- `mereceAviso()` descarta los parches, y `test/smoke.ts` fija esa regla.
- `VERSION` lo inyecta el build (`__VERSION__`). Sin build es `dev`.
- Medido el 2026-10-04 con npm 11.11 y Node 25. Un proceso lanzado por `npx` recibe `npm_command=exec` y `npm_config_package` con la especificación tal como se escribió (`normativa-colombia-mcp` o `normativa-colombia-mcp@latest`). El paquete se instala en `<npm-cache>/_npx/<hash>/node_modules/normativa-colombia-mcp`. La especificación sin versión, con 1.15.1 en caché, arrancó la 1.15.2.
- El `.mcpb` se ejecuta con `node ${__dirname}/server/index.js` y el entorno que declara `manifest.json` (`server.mcp_config.env`; hoy solo `FUENTES`). `scripts/construir.ts` reescribe el manifiesto con `{ ...actual, tools }`, así que conserva las claves que no toca.
- `server/index.js` es un lanzador que importa `./servidor.js`. Las dos piezas viven en la misma carpeta `server/` del paquete.

## Goals / Non-Goals

**Goals:**
- Que la decisión (si hay aviso, para qué canal y con qué texto) sean funciones puras, probadas sin red ni estado global.
- Que un canal mal detectado degrade a una instrucción genérica correcta y nunca a una promesa falsa de actualización automática.

**Non-Goals:**
- Añadir una variable para apagar la consulta al registro. Hoy no existe, y el número de consultas (una por proceso) no cambia.
- Detectar Bun u otros lanzadores. Caen en «desconocido».
- Leer la especificación de npx con varios paquetes (`-p a -p b`). Si `npm_config_package` no es una especificación única de este paquete, se trata como «desconocido».

## Decisions

**D1. El `.mcpb` se declara a sí mismo en el entorno.** `manifest.json` añade `"INSTALACION": "mcpb"` a `server.mcp_config.env`, y el servidor lo lee como el canal de más prioridad.
*Alternativa descartada:* deducirlo de la ruta (`…\Claude\Claude Extensions\…`). Depende del cliente y del sistema operativo, y otros clientes que instalan `.mcpb` usan otras rutas.

**D2. npx por variables de entorno, confirmado por la ruta.** El canal es npx si `npm_command === 'exec'` **y** el módulo está bajo un directorio `_npx`. Exigir la ruta separa el caso de `npx` dentro de un proyecto que ya tiene el paquete en su `node_modules`: ahí npx usa la copia local y reiniciar no actualiza nada, así que ese caso va al canal «npm en un proyecto». Si `npm_config_package` contiene la especificación de este paquete:
- sin versión o con `@latest` → no fijado;
- con cualquier otra versión, rango o etiqueta → fijado, y el aviso repite la especificación literal.

**D3. Los demás canales, por la ruta del módulo.** Con la ruta normalizada (`\` → `/`):
- bajo `node_modules/normativa-colombia-mcp/` sin `_npx` → npm en un proyecto;
- si el directorio padre de `server/` contiene `.git` → copia del código;
- en otro caso → desconocido.

La ruta sale de `import.meta.url` del bundle. La comprobación de `.git` es la única operación de disco, y se hace una vez.

**D4. Funciones puras y una instancia por proceso.** `actualizacion.ts` expone:
- `esPosterior(actual, nueva)`: compara los tres componentes numéricos e ignora un sufijo de prerelease. Sustituye a `mereceAviso`.
- `detectarCanal({ env, rutaModulo, existe })`: devuelve `{ tipo: 'mcpb' | 'npx' | 'npm' | 'codigo' | 'desconocido', especificacion?, fijado? }`.
- `textoAviso(actual, nueva, canal)`: el párrafo completo.
- `crearAviso({ consultar, canal })`: devuelve `{ iniciar(), pie() }`. El módulo exporta una instancia por defecto, construida con la consulta real (`pedir` al registro, 3 s) y el canal detectado.

Las pruebas construyen su propia instancia con una consulta falsa. Así no hace falta resetear estado global entre pruebas.
*Alternativa descartada:* mantener variables de módulo y exportar un «reset» para pruebas. Es una API que solo existe para las pruebas.

**D5. La comprobación arranca tras `server.connect`.** `src/index.ts` llama a `void aviso.iniciar()` justo después de conectar el transporte. `iniciar()` es idempotente. `pie()` devuelve el texto la primera vez que hay versión disponible y, a partir de ahí, vacío. Si el registro aún no contestó, `pie()` devuelve vacío sin marcar nada, así que el aviso sale en la primera respuesta posterior a la contestación. `txt()` sigue siendo el único que llama a `pie()`, y por eso las respuestas JSON siguen sin aviso.
*Alternativa descartada:* esperar al registro antes del primer pie, con un tope. Retrasaría una consulta legal por un dato accesorio.

**D6. Textos.** Una línea con «Hay una versión nueva: X → Y.» seguida de la instrucción del canal, terminada en «Este aviso no se repite en esta sesión.».
- **`.mcpb`:** el enlace a `releases/tag/vY`.
- **npx no fijado:** «se instala sola la próxima vez que reinicies el cliente MCP».
- **npx fijado:** «tu configuración la fija en `<especificación>`; cámbiala por `normativa-colombia-mcp` o `@latest`».
- **npm:** `npm install normativa-colombia-mcp@Y`.
- **código:** `git pull`, `npm install` y `npm run build`.
- **desconocido:** el enlace a releases y la frase de npx en condicional («si lo lanzas con npx sin versión…»).

Las pruebas comprueban la presencia de la versión, el enlace o el comando de cada canal, y que solo el npx no fijado diga que se actualiza sola. No fijan la redacción.

## Risks / Trade-offs

- **[Otro npm o cliente no exporta `npm_command`/`npm_config_package`]** → El canal cae a «npm en un proyecto» (por la ruta `node_modules`) o a «desconocido», y ninguno de los dos promete actualización automática. Se documenta la versión de npm medida.
- **[npm antiguo con `npx` sin versión que no revalida la caché]** → No medido. El README recomienda `@latest` para npm anterior al 11 [INFERENCIA] y el aviso de npx dice «reinicia el cliente». Si no llega, el aviso se repite en la sesión siguiente, porque la versión en ejecución sigue siendo menor.
- **[Avisar de parches aumenta el ruido]** → Sigue saliendo una sola vez por proceso, al pie y después del descargo.
- **[`.git` en la carpeta padre por otra razón (paquete vendorizado dentro de un repo)]** → La instrucción de `git pull` sería incorrecta pero inocua. La ruta `node_modules` tiene prioridad sobre `.git`.
- **[El build y las pruebas e2e arrancan el servidor y ahora consultan el registro al arrancar]** → Antes ya se consultaba en la primera llamada, y las pruebas e2e hacen llamadas. El build solo pide `tools/list`, así que gana una consulta de hasta 3 s que no bloquea.

## Migration Plan

Sale en la siguiente versión publicada.
- Las instalaciones `.mcpb` existentes no llevan `INSTALACION` hasta que instalen la versión nueva, pero tampoco llevan el código nuevo, así que no hay estado intermedio.
- Revertir es volver a la versión anterior; no hay estado persistido.
- La prueba de humo de `mereceAviso` se sustituye por las de `esPosterior`. Que los parches no se anunciaban era la regla vieja y no se conserva.
