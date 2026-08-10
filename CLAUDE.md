# Instrucciones del proyecto

## Criterio al escribir código

Rige para **todos los agentes**: para mí y para cualquier subagente. Cada punto está aquí porque su ausencia ya costó algo en este repo.

- **Borrar el camino viejo, no envolverlo.** Cuando el enlace permanente del Consejo de Estado resultó equivalente al postback de WebForms, se sustituyó entero en vez de dejar los dos. Nada de capas de compatibilidad, respaldos ni migraciones para conservar lo que ya no hace falta.
- **La implementación más simple que cumpla el requisito de hoy.** Se descartó empaquetar el corpus en SQLite con FTS5 —dependencia nativa y un snapshot que envejece— porque el requisito real se cubría consultando en vivo. Sin abstracciones especulativas ni configuración para valores que no cambian.
- **Crecer por capas, sin romper lo que ya sirve.** Primero cuatro reguladores funcionando de extremo a extremo, después diez encima. Nunca cambiar un producto que funciona por complejidad a medio terminar.
- **Un módulo por responsabilidad.** Una fuente, un fichero en `src/fuentes/`. Cuando diez fuentes resultaron tener la misma forma, se les dio un contrato común (`src/fuentes/sectorial.ts`) en lugar de diez herramientas casi iguales.
- **Reutilizar lo que ya está instalado antes de escribir nada.** `pedir` de `src/nucleo/http.ts` para todo HTTP y `cargar` de `src/nucleo/parse.ts` para HTML: traen ritmo por dominio, reintentos, decodificación y cadena de certificados. Un `fetch` directo se salta las cuatro cosas. Comprobar la documentación y los tipos de una dependencia antes de dar por hecho que le falta algo.
- **Decidir para el largo plazo.** El contrato `Adaptador` se escribió antes que los adaptadores, y por eso diez subagentes en paralelo produjeron piezas que encajan. Un apaño pensado para reemplazarse después se queda para siempre.
- **Cuando el atajo es deliberado, se marca.** Comentario `ponytail:` diciendo cuál es el techo y cuál sería el salto siguiente.

## Command Code como subagente

Se invoca como **`cmdc`** (el nombre corto) o `command-code`; `commandcode` es otro alias. Están en el PATH.
**No uses `cmd`**: aunque el paquete registra ese alias, en Windows lo tapa el `cmd.exe` del sistema y lanzarlo abre un intérprete de órdenes en vez del agente.

```
cmdc -p "tarea" -n nombre-sesion --trust --yolo --skip-onboarding --effort high
```

### Cuándo usarlo

- **Antes que mis propios subagentes.** Si hacen falta cinco, **cuatro van en Command Code** y uno en los míos.
- **También para retroalimentación.** No solo para producir: pedirle que critique un cambio hecho, que busque el fallo que se me pasó o que revise una decisión de diseño. Funciona: revisando este mismo documento detectó una afirmación falsa sobre su propio catálogo de modelos.

### Lo que no se toca

- **El modelo se queda en DeepSeek V4 Flash**, que es el de por defecto. Nada de `-m` / `--model`.
  Comprobado ejecutándolo el 2026-08-03 con la v1.9.0 instalada, porque es fácil equivocarse en las dos direcciones: el catálogo **sí** incluye modelos de Anthropic y OpenAI, pero `--model claude-sonnet-5` responde **403 `MODEL_NOT_IN_PLAN`** (exige plan Pro) y `--model sonnet` responde **`unknown model`** porque ese alias corto no existe. Si alguien afirma lo contrario citando documentación, vuelve a ejecutarlo antes de creerlo: la documentación del catálogo y el binario no coinciden.
- **El tope de turnos no se establece.** Nada de `--max-turns`; se queda en 100. La consecuencia hay que asumirla al encargar, no al ejecutar: **trocear la tarea para que quepa**. Dos entidades por lote entraron; cinco no habrían entrado.

### Lo que sí se ajusta

- **`--effort`**, entre `high` y `max` según la tarea. `max` para diseño, depuración esquiva o revisión crítica; `high` para trabajo mecánico y acotado. La ayuda del binario solo documenta hasta `high`, pero **`max` funciona** y confirma con `Reasoning effort set to max`.

### Continuidad de sesión

Cada invocación con `-p` arranca **en frío**: sin `--resume` no hay nada del hilo anterior, y el aprendizaje de preferencias está apagado (`.commandcode/settings.json`), así que tampoco queda poso entre sesiones. Con `--resume`, en cambio, el hilo sigue entero. Si la segunda petición necesita el contexto de la primera, se reanuda:

```
cmdc -p "primera tarea" -n adaptadores-salud --trust --yolo --skip-onboarding
cmdc -p "ahora corrige X" --resume adaptadores-salud --trust --yolo --skip-onboarding
```

- `-n <nombre>` nombra la sesión al crearla; `--resume <nombre>` la retoma con el hilo intacto (verificado: recordó un dato de la petición anterior).
- `--continue` retoma la última sin nombrarla. `--fork-session` la bifurca sin tocar la original.
- Abrir una sesión nueva para seguir el mismo trabajo obliga a reexplicarlo todo y se paga en contexto.

### Banderas que hacen falta

| Bandera | Para qué |
|---|---|
| `-p "tarea"` | Modo no interactivo. Obligatoria como subagente. |
| `-n <nombre>` / `--resume <nombre>` | Nombrar la sesión y retomarla después. |
| `-c, --continue` | Retomar la última sesión sin haberla nombrado. |
| `--trust` | Evita el aviso de confianza del proyecto. |
| `--yolo` | Salta los permisos. Necesaria si va a escribir ficheros sin supervisión. |
| `--skip-onboarding` | Evita el asistente de «taste» en ejecuciones automáticas. |
| `--output-format json` | Flujo NDJSON de eventos **más una última línea con el resultado**. Solo si vas a parsear; en modo texto la cola de la salida ya es el informe final y se lee mejor. |
| `--add-dir` / `-w, --worktree` | Contexto extra; aislarlo del árbol de trabajo. |

No envolver la llamada en `timeout`: corta la ejecución a media tarea. Para trabajos largos, lanzarla en segundo plano y recoger el informe cuando avise.

### Lo aprendido usándolo

- **El código de salida no prueba nada.** Con `--model sonnet` terminó en **exit 0** habiendo fallado por completo; el error solo estaba en la salida. Leer siempre la salida.
- **Los 100 turnos se agotan y el trabajo queda a medias**, con un aviso al final que es fácil pasar por alto. Ya dejó un adaptador sin la nota que él mismo había decidido añadir.
- **Sus informes no se dan por buenos.** Entregó dos adaptadores reportados como verificados que ignoraban el parámetro `limite` y devolvían la tabla entera. Regla: **si escribió código, se reejecuta contra la fuente real antes de integrarlo**; si solo opinó (revisión, crítica), se verifica lo que afirme antes de actuar. Su crítica de este documento acertó en el catálogo de modelos y se equivocó en el detalle, y solo se supo comprobándolo.
- **Escribe `.commandcode/` en el proyecto.** Ya está en `.gitignore`; no commitearlo.

### Cómo se le encarga una tarea

1. **Los ficheros exactos que debe escribir, y prohibirle el resto.** Con varios en paralelo es lo único que evita que se pisen.
2. **El contrato contra el que programar** (la interfaz o el tipo), no una descripción en prosa.
3. **Un fichero del repo como modelo de estilo.** `src/fuentes/anh.ts` para una fuente nueva. Las fuentes viven una por fichero en `src/fuentes/`; las sectoriales, en `src/fuentes/sectorial/` y se dan de alta en `registro.ts`.
4. **Los comandos de verificación del repo**, o inventará los suyos: `npm run typecheck`, `npm run lint`, `npm test` y `npm run test:e2e` (`npm run check` los encadena). Las pruebas marcadas `RED` consultan portales reales; `SIN_RED=1` las salta.
5. **La obligación de verificar**: un script temporal **fuera del repo**, ejecutado contra la fuente real, con números medidos en el informe.
6. **Una cláusula de honestidad explícita**: si algo no es viable, que lo diga con evidencia —URL, código HTTP, qué vio— en vez de inventar un parser que falle en silencio. Sin esa cláusula, rellena huecos.
