Ley para todo agente, IA o humano, que cambie este repositorio. Una regla de este fichero la comprueba una herramienta o un revisor. «Pensé que estaba bien» no es defensa.

Cuando dos reglas chocan, gana la anterior: **correcto > probado > simple > rápido > elegante**.

## 0. EL PRODUCTO

`normativa-colombia-mcp` es un servidor MCP en TypeScript que lee fuentes oficiales colombianas (Gestor Normativo, Corte Constitucional, Corte Suprema, Consejo de Estado, SUIN-Juriscol, DIAN, Diario Oficial, Senado y sectoriales). **No hay API documentada: se lee HTML y PDF de portales que cambian sin avisar.** Cinco restricciones mandan sobre todo lo demás:

- **Ninguna respuesta afirma vigencia por su cuenta.** Se trasladan las marcas del texto oficial y se dice cuando no consta. Un abogado decide con esto.
- **Un parseo roto grita, no devuelve vacío.** Si un parser no encuentra lo que espera, lanza `CanarioError`. «Lista vacía» se lee como «no existe la norma», el peor fallo posible aquí.
- **Nunca se desactiva la verificación TLS en una petición.** Un portal con la cadena incompleta se completa en `src/nucleo/http/autoridades.ts`: lee el intermedio de la extensión AIA de su certificado y lo acepta solo si lo firma una raíz de Node y es una CA (los eslabones aceptados pasan a ser anclas de confianza, así que cada uno se verifica). `src/nucleo/ca.ts` queda como respaldo, con la procedencia de cada certificado (serial y huella SHA-256). La única conexión sin verificar es la sonda que lee el certificado: no envía ni recibe datos.
- **El ritmo de peticiones no sube.** Una por segundo sostenida por dominio, ráfaga de cinco, una sola en vuelo por sitio, `Retry-After` respetado (`src/nucleo/http/`). Más caudal exige explicarlo primero en un issue.
- **stdout es el protocolo JSON-RPC.** Un byte ajeno rompe a todos los clientes. Se registra con `process.stderr.write`, nunca con `console.*` ni a stdout.

Alcance: normas y jurisprudencia publicadas, no el estado procesal. Nunca prometas cobertura total. Una fuente «caída» casi nunca lo está: antes de declararla caída mide los dos extremos (¿responde desde otra red?, ¿el fallo es de tu entorno o del portal?).

## 1. CÓMO TRABAJAR

Toda tarea pasa por estos seis pasos, en orden. Saltarse uno es un defecto del trabajo aunque el diff sea correcto.

1. **Entender.** Lee el código que toca el cambio y cada llamador de lo que editas. Enuncia el objetivo y el cambio mínimo antes de escribir.
2. **Reproducir o especificar.** Un fallo empieza con una prueba roja o una reproducción registrada. Una función nueva empieza con su forma de datos (tipos, estados, campos del portal). Sin reproducción no hay arreglo. «No se puede» se comprueba ejecutando, no se afirma.
3. **Arreglar la causa.** Rastrea el síntoma hasta el primer sitio donde el sistema falló. Un parche en el síntoma es un segundo bug. Si una fuente falla, arregla el adaptador de esa fuente, no el llamador.
4. **Cambiar lo mínimo.** El diff contiene lo que la tarea necesita. Nada de refactors de paso ni reformateo de código que no tocas.
5. **Probarlo.** Corre la comprobación acotada del cambio y, al cerrar la fase, la puerta completa (sección 8). Enseña la salida. Para lo que ve el usuario, pruébalo contra el artefacto real: la herramienta MCP corriendo sobre el bundle, no solo un test de la función.
6. **Informar con honestidad.** Di qué corriste, qué pasó, qué falló, qué omitiste y por qué. Etiqueta cada afirmación como medida, inferida o supuesta. Un hallazgo mitigado con un aviso sigue abierto.

**Pregunta** solo ante una decisión de producto que ningún experimento resuelve, o antes de una acción irreversible. Lo que puedes observar ejecutando, lo ejecutas. Si la misma comprobación sigue fallando tras tres rondas, para y escala (sección 10).

## 2. CÓMO PARTIR EL TRABAJO

- **Una unidad = un asunto = un commit = una comprobación.** Si no sabes nombrar el comando cuya salida la prueba, la unidad no está definida.
- **Tamaño.** Una unidad toca una fuente o una herramienta y cabe en un diff que se lee en diez minutos, unas 300 líneas. Más grande, se parte.
- **Orden.** Borra lo muerto primero. Luego tipos y formas de datos. Luego lógica pura con sus pruebas. Luego adaptadores y cableado en `src/index.ts`. Luego docs. Cada paso deja su comprobación acotada en verde.
- **Refactor y comportamiento no comparten commit.** Un commit de refactor no cambia expectativas de tests. Uno de comportamiento no mueve código.
- **El trabajo en paralelo no comparte nada.** Dos agentes nunca editan el mismo fichero o rama a la vez. Un worktree por agente, o en secuencia. Un worktree con `node_modules` enlazado por junction borra el real al eliminarse: usa `npm ci` dentro del worktree.
- **Una herramienta por fuente.** No fusiones jurisprudencias en una herramienta con parámetros condicionales: es complejidad real, ya se rechazó.
- **Delega por dificultad.** Lo mecánico y bien especificado va al trabajador barato. El diseño transversal y lo ambiguo se queda con el modelo más fuerte. El encargo dice objetivo, ficheros, la comprobación que lo prueba y qué queda fuera.
- **El orquestador responde del resultado.** Lee el diff del delegado y reejecuta su comprobación. Su «hecho» es una afirmación, no evidencia. Lo que ya encargaste a un subagente no lo implementas en paralelo.
- **Autor y revisor distintos** en cambios no triviales.
- **Los tests de red tocan portales reales.** Gastan cortesía con terceros: usa primero los tests sin red y las fixtures, y la red solo para lo que no pueden probar.

## 3. ARQUITECTURA

**Por concepto de negocio, nunca por tipo.** El repo ya está así y se conserva:

- `src/fuentes/<fuente>/`: un adaptador por portal (`gestor/`, `suin/`, `jurisprudencia/`, `diario_oficial/`…). Sabe cómo se pide y cómo se parsea esa fuente, nada más.
- `src/herramientas/<herramienta>.ts`: una herramienta MCP por fichero (o carpeta si crece). Orquesta fuentes y formatea la respuesta.
- `src/nucleo/`: lo que usan varias fuentes y no es de ninguna (`http/`, `cache/`, `citas/`, `ca.ts`, `fecha.ts`…). Es núcleo por **concepto** (ritmo HTTP, caché, citas), no un cajón.
- `src/index.ts` registra herramientas; `src/arranque.ts` arranca. Sin lógica de dominio ahí.

Reglas:

- **Prohibido:** `utils`, `helpers`, `common`, `models`, `managers`, `misc`. Si lo buscas, no has nombrado el dominio.
- **Las dependencias apuntan hacia dentro:** una fuente no importa una herramienta; una herramienta no importa los detalles HTML de otra fuente; `nucleo` no importa `fuentes` ni `herramientas`. Un ciclo es un defecto.
- **Límites:** un fichero guarda un concepto en 300 líneas como mucho. Una función, 50 líneas, 3 parámetros (más, un objeto de opciones), sin booleanos de comportamiento (`hacer(true, false)`), anidamiento de 1 nivel con guardas tempranas. Pasado el límite de fichero, se parte en una carpeta.
- **Principios:** SOLID, alta cohesión y bajo acoplamiento, Ley de Deméter (nada de `a.b().c().d()`).
- **Sin objetos dios ni estado mutable global.** Composición sobre herencia, inmutable por defecto (`readonly`, `as const`, `ReadonlyArray`). Las cachés y el limitador de ritmo son estado deliberado en `nucleo/` y ahí se quedan; ningún test depende de lo que dejó otro (`test/aislamiento-estado.ts`).
- **Un recurso con dueño.** Temporizadores, descargas en vuelo, ficheros temporales y la caché de disco se liberan en el sitio que los crea (`try/finally`, `AbortSignal`, `using` si el objetivo lo admite), no «después, si acaso».
- **Efectos al borde.** La lógica pura (parsear, normalizar, comparar, clasificar) no hace E/S y se prueba sin red. La E/S vive en el adaptador.

## 4. DATOS Y TIPOS

- **Nombra la forma de los datos antes que la lógica.** Tipos primero, funciones después.
- **Estados ilegales irrepresentables.** Una unión discriminada sustituye a dos booleanos o a un `string` con convenciones. Un tipo con marca (`type Radicado = string & { readonly __marca: 'Radicado' }`) sustituye a un `string` que lleva identidad o formato.
- **Parsea en la frontera, confía dentro.** Los argumentos MCP (zod), el HTML de los portales (cheerio), los PDF y los JSON se convierten una vez, en el borde, en tipos propios. El código interior no revalida. Un campo que falta es `CanarioError`, no un `''`.
- **Sin `any`.** Tampoco `as unknown as T` ni `!` para callar al compilador: usa `unknown` y estrecha. `CRITICA_SRC.md` lista los `any` que ya existen en el registro de `index.ts`: son deuda para borrar, no plantilla para copiar.
- **`switch` exhaustivo** sobre uniones de dominio, con `default` que asigna a `never` para que añadir una variante rompa el build donde importa.
- **Sin números mágicos.** Un código, un offset o un límite del portal lleva constante con nombre y nota de dónde y cuándo se midió (`medido el 2026-10-15`).
- **Un hecho, un sitio.** Una regla de normalización, un nombre de tipo documental o un límite de un portal vive en un solo lugar. Se extrae a la segunda copia del mismo conocimiento; líneas que solo se parecen no son duplicación.
- **Las operaciones reintentables son idempotentes.** Llamar dos veces a una herramienta deja el mismo estado (caché incluida) que llamarla una.

## 5. CALIDAD DEL CÓDIGO

- **Lo más simple que cumple el comportamiento.** Ninguna abstracción con una sola implementación, ninguna opción para un valor que nunca cambia, ningún código para un futuro que nadie pidió.
- **Guardas antes que anidar.** Retorno temprano, sin escaleras de `else`.
- **Los nombres llevan intención.** Verbos con propósito (`normalizarCita`, no `procesar`), booleanos como preguntas (`esDerogada`, `tieneTextoCompleto`). Un verbo por concepto: `obtener` o `buscar`, nunca ambos para lo mismo. `camelCase` en código, términos del dominio en español como ya está.
- **La configuración viene de variables de entorno** y falla rápido al arrancar.
- **Biblioteca estándar antes que dependencia,** y ninguna nueva para un problema de diez líneas. El lockfile se versiona. Una dependencia nueva exige una razón que un revisor acepte. **El `.mcpb` viaja sin `node_modules`**: una librería con binario nativo no puede entrar; pruébalo en un directorio limpio antes de aceptarla.
- **Sin pesimización.** Elige la estructura a propósito (`Map`/`Set` para búsquedas) y documenta el Big O en un comentario en la lógica central. Ningún escaneo cuadrático sobre índices o listados. Mide antes de optimizar y reporta el antes y el después con la prueba `npm run medir`.

## 6. ERRORES, SEGURIDAD, REGISTRO

- **Errores tipados** con contexto: qué fuente, qué cita, qué esperaba. Un error que lista alternativas válidas dice al agente llamante qué hacer después. El mensaje distingue «el portal cambió» (`CanarioError`), «no se pudo contactar» y «no existe», porque cada uno pide una acción distinta.
- **Nunca un `catch` vacío ni un error tragado.** Nunca `throw` de un valor que no sea `Error`.
- **Valida cada entrada en la frontera.** URLs solo hacia hosts permitidos (`test/url-segura.ts`), tamaños y tiempos acotados (`test/limites-http.ts`). Sin secretos, tokens o datos personales en código, registros, fixtures o commits.
- **Toda espera tiene plazo.** Una petición, una descarga o una espera de portal lleva timeout y falla con un error que dice a qué esperaba. Sin `fetch` sin `AbortSignal`, sin bucles de sondeo sin tope.
- **Registro estructurado a stderr**, una línea JSON con campos, no strings interpolados. Sin `console.*` ni `debugger`.
- **Nunca falles en silencio hacia el agente.** Un argumento ignorado se informa como ignorado. Una acción rechazada dice la razón y la alternativa. Una coincidencia aproximada se etiqueta como aproximada.
- **Cuida a los portales.** No abras más conexiones, no repitas peticiones que una caché responde, no ignores `Retry-After`.

## 7. PRUEBAS

**Prueba el comportamiento, no la implementación.**

- **Asegura lo que ve quien usa el código:** el valor devuelto, el texto de la respuesta MCP, el fichero en disco. Dado un estado, cuando una acción, entonces un resultado observable.
- **Prohibido:** probar funciones privadas, asegurar cuántas veces se llamó a un mock, asegurar estado interno, pruebas que pasan cuando el comportamiento está roto.
- **Pocas pruebas, cada una gana su sitio.** Existe porque un comportamiento del que alguien depende se rompería sin ella. Un cambio que no altera comportamiento observable (renombre, movimiento, log, doc) no añade prueba.
- **Un comportamiento, una prueba.** Antes de añadir, busca la que ya lo cubre y amplíala. Una tabla de casos en una prueba vale más que una prueba por entrada.
- **Un arreglo trae una prueba:** la que falló antes del arreglo. **Compruébalo rompiendo el arreglo a propósito una vez**: una prueba que no puede fallar no prueba nada. Una función nueva trae las pruebas de sus comportamientos: camino principal más los errores y bordes alcanzables.
- **Prefiere el nivel más externo que siga siendo rápido.** Una prueba por la herramienta MCP o la función pública vale más que cinco de sus interiores. `test/e2e.ts` cubre el bundle real; por no tenerlo se colaron dos lotes de fallos.
- **Borrar una prueba es un cambio válido** si duplica otra o se rompe en cada refactor con el comportamiento intacto. El commit dice por qué.
- **Capas:**
  - Unitarias: lógica pura, `node:test`, junto a su tema en `test/`, sin red, bajo 100 ms. Fixtures reales de HTML, no HTML inventado a mano que el portal nunca emitió.
  - Contra el portal vivo (`test/red*.ts`, `RED:` en el nombre): detectan que el portal cambió. `SIN_RED=1` las omite. Un fallo ahí **no** prueba que tu cambio esté mal: primero distingue «el portal cambió o su certificado rotó» de «rompí algo» reejecutando sobre `main`.
- **Deterministas y aisladas.** Sin `sleep`, sin red en las unitarias, sin dependencia del orden ni del reloj real. Fakes antes que mocks.
- **Un test nuevo se registra en el script `test` de `package.json`**: la lista es explícita y un fichero que no está ahí no corre. `npm run verificar` rompe si una herramienta publicada no tiene fichero de pruebas.
- **Nunca debilites una prueba para que pase.** Una expectativa cambiada se justifica en el mensaje del commit.

## 8. LA PUERTA

El tiempo de pruebas no debe ser el cuello de botella. Dos niveles, cada uno en su momento.

**Comprobación acotada, tras cada unidad.** Solo lo que tocó la unidad:

```bash
npx tsc --noEmit                    # tipos de todo el repo (rápido)
npx oxlint src scripts test         # lint
node --test test/<fichero>.ts       # las pruebas del tema que cambiaste
SIN_RED=1 node --test test/<fichero>.ts   # si no quieres tocar el portal
```

Un comportamiento nuevo sin prueba que lo cubra trae una en la misma unidad. Un cambio en `src/nucleo/`, en tipos compartidos o en `src/index.ts` no tiene alcance estrecho: corre la puerta completa.

**Puerta completa, una vez por fase** y siempre antes de un push. Es lo que corre `prepublishOnly`:

```bash
npm run check        # typecheck + lint + npm test + test:e2e (build + e2e + red-v3)
npm run verificar    # build, typecheck, lint, unitarias, cobertura de herramientas, red y barrido adversarial
```

Referencia medida el 2026-11-19 (Node 25.8.1, Windows): `npm run check` en verde, con 590 pruebas unitarias y 65 de extremo a extremo, contra los portales vivos. Con `SIN_RED=1` se omiten las pruebas `RED:`.

Si la puerta falla al final de una fase, la fase no está hecha. Un lint se arregla, no se silencia: un `// oxlint-disable` necesita comentario con el motivo. Si falla solo por red, informa cuáles y por qué no son tuyas; no las des por buenas sin haber mirado.

## 9. DOCS Y GIT

- **Los comentarios explican el porqué, nunca el qué.** Si el qué necesita comentario, renombra. Comentarios en español, como el resto del proyecto. Un comentario nunca justifica un workaround: el siguiente agente copia el workaround y se fía de la excusa. Arregla la causa o registra el hecho medido del portal que fuerza el comportamiento (con fecha).
- **La API pública lleva docstring** con un ejemplo ejecutable. Cuando cambian las herramientas publicadas, un parámetro o una variable de entorno, `README.md` y `manifest.json` cambian en el mismo commit (`npm run build` sincroniza el manifiesto). Un cambio de comportamiento lleva entrada en `CHANGELOG.md`.
- **Conventional Commits** en español: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`. El mensaje dice el porqué y, si corrige un portal, la medida (qué respondía, cuándo).
- **Sin coautores IA en los trailers.**
- **Commit por unidad** cuando su comprobación acotada esté en verde y el usuario lo pida. **Pregunta antes de lo irreversible:** push a `main`, force-push, borrar una rama o etiqueta, reescribir historia publicada, publicar una versión.
- **Etiquetar no es publicar.** Una versión no existe para el usuario hasta que está en npm y en el `.mcpb`; tres veces una corrección etiquetada no llegó y se notó en Cowork. Tras publicar, comprueba que la versión está en el registro.
- **Los cambios grandes pasan por `openspec/`** (propuesta, specs y tareas) antes de tocar código, con los skills `opsx:*`.

## 10. VERIFICACIÓN

La verificación es lo que deja a un agente trabajar solo. Constrúyela con el cuidado del código de producción, mantenla fuera de su alcance y califícala contra los fallos que de verdad ocurrieron.

- **Código antes que prosa.** Cada vez que se corrige a un agente, pregunta en este orden: ¿puede un tipo o un API hacer imposible el error?, ¿puede `tsconfig.json`, oxlint o una prueba fallar con él?, ¿puede ser un punto de la lista de comprobación con su disparador? Una línea de este fichero es el último recurso, porque solo el código es reproducible. El mensaje de una comprobación nombra la causa, no el síntoma.
- **El código existente es la entrada principal.** Los agentes copian lo que encuentran: un workaround, una ruta obsoleta o un patrón duplicado se vuelve la plantilla del siguiente cambio. Nunca imites un antipatrón porque ya esté ahí. En un módulo que toques, borra el camino muerto en su propio commit o repórtalo; no añadas una copia más.
- **Prohíbe la trampa, no la avises.** Un API que exige matices y se usa mal dos veces pasa a una regla de lint o a una prueba, con excepción solo en el módulo que la posee.
- **Ejecuta el cambio, no solo las pruebas.** Sube la escalera solo lo que el cambio necesite: fixtures, luego la herramienta sobre el bundle (`scripts/probar-tools.ts`), luego el portal vivo (`test/red*.ts`, `npm run salud`). Un arreglo de portal se prueba contra el portal, con la medida antes y después.
- **Tres rondas, luego un humano.** Tras tres rondas de arreglo fallidas sobre la misma comprobación, para. El informe dice qué comprobación, qué probó cada ronda y por qué falló.
- **Nunca rodees una prueba inestable.** Sin reintentos hasta verde, sin `sleep`, sin `.skip` para esconderla. Encuentra la causa; si no puedes, bórrala y di por qué en el commit.
- **Diferencial en reescrituras.** Cuando reescribas un parser o una herramienta, corre el viejo y el nuevo sobre las mismas fixtures y compara la salida. Cada diferencia es un bug o un cambio aprobado, listada en el commit.
- **Un cambio no edita a su propio juez.** `AGENTS.md`, `CLAUDE.md`, `tsconfig.json`, la configuración de oxlint, el script `test` de `package.json`, `scripts/verificar.ts` y las salidas esperadas de las fixtures cambian en su propio commit, sin código de funcionalidad, y el commit dice qué acepta ahora la puerta que antes rechazaba.
- **Los fallos que llegaron a `main` se vuelven regla.** Un bug que llegó a `main`, o un error visto en dos revisiones, se vuelve una prueba o un punto de esta lista con su origen. Una regla sin disparador visible en un diff no es una regla.
- **Evidencia, no diffs.** La revisión mira artefactos: la respuesta MCP real, el texto que devuelve la herramienta, la salida de `npm run salud`, con la fecha de la medida. «Compila» no prueba nada.
- **Mide los dos extremos antes de culpar a un portal.** Dos diagnósticos de «portal caído» salieron uno falso y otro invertido. ¿Responde desde `curl` y desde Node? ¿La cadena TLS es la que sirve el portal o la de tu red?
- **Un descarte se prueba ejecutando.** Un callejón sin salida ya recorrido se registra con la petición real que lo probó, en `CHANGELOG.md` o `openspec/`, para que nadie lo recorra otra vez.
- **El hallazgo negativo es entregable.** Medir qué NO hace falta construir, con números, es trabajo hecho.
- **Reutiliza el conductor.** Un script que ejerce el servidor se escribe una vez, se guarda en `scripts/` y se prueba. Un script desechable escrito dos veces es un defecto.
- **Limpia antes de automatizar.** No pongas un bucle de agente sobre un código sucio o una comprobación débil: multiplica la basura y las peticiones a los portales.
- **Comprobaciones baratas primero.** Tipos y lint locales antes de pedir revisión. No gastes el tiempo de un revisor en lo que un comando habría cazado.
- **Un revisor principal, varias rondas.** Las rondas posteriores leen los hallazgos anteriores y el commit bajo revisión; una revisión de un commit viejo no vale. Clasifica cada hallazgo: debe arreglarse, debería arreglarse, nimiedad o preexistente.
- **Sella el commit.** Cada commit acaba con un trailer `Verified:` que nombra lo que corrió (`scoped`, `gate`, `red`, `e2e`, `manual`) o `Verified: none (motivo)`, para encontrar lo no verificado con `git log --grep`.
- **Acota cada regla.** Una corrección se vuelve una regla con su disparador y su límite, no una prohibición general: un agente que sobrecorrige un arreglo estrecho lo convierte en ley y rompe otro trabajo.
- **Poda y mide.** Al cerrar cada fase, borra reglas, puntos y pruebas que ya no disparan o que otro cubre, y reporta cuántos commits de la fase se revirtieron después. Los documentos que solo crecen dejan de leerse.

## 11. DEFINICIÓN DE HECHO

- [ ] Se cumple el objetivo y puedo nombrar la evidencia.
- [ ] Se arregló la causa, no el síntoma. Un bug tiene la prueba que falló antes del arreglo, y comprobé que falla sin él.
- [ ] El diff contiene solo este asunto. Refactor y comportamiento van en commits separados.
- [ ] Los tipos modelan el dominio: sin pares de booleanos, números mágicos, `any` ni primitivas desnudas que llevan identidad.
- [ ] Ningún módulo llamado `utils`, `helpers` o `common`. Ficheros de 300 líneas como mucho, funciones de 50.
- [ ] Sin `console.*`, `debugger` ni `catch` vacío. Los errores son tipados y llevan contexto. Un parseo roto lanza `CanarioError`.
- [ ] Nada afirma vigencia por su cuenta, no se desactivó TLS, no subió el ritmo de peticiones y nada escribe en stdout.
- [ ] Las pruebas aseguran comportamiento observable. Añadí solo las que un comportamiento nuevo necesita, y ninguna para cambios que no alteran comportamiento. Una prueba nueva está en el script `test`.
- [ ] Cada unidad pasó su comprobación acotada. La puerta completa (sección 8) está en verde, o informé por qué cada fallo de red no es mío.
- [ ] El cambio se ejecutó contra el artefacto real (sección 10) y el commit lleva el trailer `Verified:`.
- [ ] Ningún fichero «juez» (sección 10) se edita junto con código de funcionalidad.
- [ ] `README.md`, `manifest.json` y `CHANGELOG.md` coinciden con el comportamiento nuevo.
- [ ] Mi informe dice qué corrí, qué omití y qué peticiones reales gasté contra los portales.
- [ ] Si publiqué, comprobé que la versión llegó a npm y al `.mcpb`.
