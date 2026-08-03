# Command Code como subagente

Para delegar una tarea a `command-code` (binario `cmd`, v1.9.0) en modo no interactivo:

```
cmd -p "tarea a delegar" --output-format json --trust
```

- `-p, --print [query]` — corre sin interacción, imprime la respuesta y termina (obligatorio para subagente).
- `--output-format json` — emite NDJSON con eventos + línea de resultado final; úsalo si vas a parsear la salida.
- `-t, --trust` — evita el prompt de confianza inicial del proyecto.
- `--yolo` — salta además todos los prompts de permisos (equivale a `--dangerously-skip-permissions`); solo si la tarea necesita escribir/ejecutar sin supervisión.
- `--max-turns <n>` — limita turnos (por defecto 100; sale con código 8 si se alcanza el tope).
- `-m, --model <model>` / `--effort <level>` — fijar modelo/esfuerzo si el subagente necesita algo distinto del default.
- `--add-dir <dir>` — dar contexto de directorios extra al subagente.
- `-w, --worktree [name]` — correrlo en un worktree aislado si la tarea no debe tocar el árbol de trabajo actual.

Combinación típica para un subagente aislado y sin fricción:

```
cmd -p "tarea" --output-format json --trust --yolo
```
