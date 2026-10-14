## 1. Comparación de versiones

- [ ] 1.1 En `src/nucleo/actualizacion.ts`, sustituir `mereceAviso` por `esPosterior(actual, nueva)`: los tres componentes se comparan numéricamente y se ignora un sufijo de prerelease (D4). Mover su prueba de `test/smoke.ts` a un `test/actualizacion.ts` nuevo, añadido al script `test` de `package.json`, con los casos 1.15.1→1.15.2 (sí), 1.9.0→1.10.0 (sí), igual (no) y anterior (no). Verificar con `node --test test/actualizacion.ts`.

## 2. Detección de canal

- [ ] 2.1 Implementar `detectarCanal({ env, rutaModulo, existe })` según D1–D3: `INSTALACION=mcpb` primero; luego npx (`npm_command=exec` y ruta bajo `_npx`), con `especificacion` y `fijado` sacados de `npm_config_package`; luego `node_modules`; luego `.git` en el padre de `server/`; y si nada encaja, desconocido. Normalizar `\` a `/`. Verificar en `test/actualizacion.ts` con entradas inyectadas: mcpb; npx sin versión, con `@latest` y con `@1.15.1`; npx dentro de un proyecto (ruta `node_modules` sin `_npx` → npm); clon; desconocido; y una especificación con varios paquetes → desconocido.
- [ ] 2.2 Añadir `"INSTALACION": "mcpb"` a `server.mcp_config.env` de `manifest.json`. Verificar que `npm run build` lo conserva (`node -p "require('./manifest.json').server.mcp_config.env"`).

## 3. Texto y ciclo del aviso

- [ ] 3.1 Implementar `textoAviso(actual, nueva, canal)` con las instrucciones de D6. Verificar en `test/actualizacion.ts`, sin fijar la redacción:
  - cada canal contiene la versión nueva y su enlace o comando (`releases/tag/v<nueva>`, `npm install normativa-colombia-mcp@<nueva>`, `git pull`);
  - solo el npx no fijado afirma que se actualiza sola;
  - el npx fijado repite la especificación.
- [ ] 3.2 Implementar `crearAviso({ consultar, canal })` → `{ iniciar(), pie() }` y exportar la instancia por defecto con la consulta real (registro de npm, 3 s, errores silenciados, nada si `VERSION` es `dev`) (D4, D5). Verificar en `test/actualizacion.ts` con una consulta inyectada:
  - antes de que conteste, `pie()` da vacío;
  - después, la primera llamada da el aviso y las siguientes vacío;
  - una consulta que rechaza o tarda deja `pie()` vacío siempre;
  - `iniciar()` dos veces consulta una sola vez.
- [ ] 3.3 En `src/index.ts`, llamar a `void aviso.iniciar()` tras `server.connect` y hacer que `txt()` use `aviso.pie()`. Borrar `avisoVersion` y el comentario de cabecera que ya no describe el comportamiento. Verificar con `npm run typecheck` y con el servidor construido: `initialize` responde sin esperar al registro, y en una sesión de varias llamadas el aviso sale como mucho una vez (comprobación a mano con una `VERSION` forzada por debajo de la publicada, descrita en el informe de la tarea).

## 4. Documentación y cierre

- [ ] 4.1 Añadir a `README.md` una sección «Actualizaciones»: qué canal se actualiza solo (npx sin versión, medido con npm 11.11), qué hacer con `.mcpb`, npm en un proyecto y copia del código, la recomendación de `@latest` para npm antiguo, y que el servidor consulta el registro de npm una vez por proceso para avisar. Verificar leyendo la sección contra el requisito «Documentación de las actualizaciones por canal».
- [ ] 4.2 Entrada en `CHANGELOG.md`: el aviso incluye parches, se comprueba al arrancar y da la instrucción del canal; el `.mcpb` declara `INSTALACION`. Verificar que la entrada existe.
- [ ] 4.3 Ejecutar `npm run check` en verde, `npm run pack` y confirmar que el `.mcpb` contiene el manifiesto con `INSTALACION=mcpb`, y `graphify update .`.
