## 1. Metadatos de perfil Glama

- [x] 1.1 Crear `glama.json` en la raíz con nombre, descripción, autor, repositorio, categorías y `related_servers` (seguir el formato documentado por Glama)
- [x] 1.2 Añadir `glama.json` a `files` en `package.json` y verificar que `npm run build` / `npm run pack` lo incluye en el `.mcpb`
- [x] 1.3 Verificar con `npm run medir` (o el comando de empaquetado) que el bundle no crece en dependencias ni en tamaño apreciable (+0–1 KB)

## 2. Reescritura de descripciones de herramientas

- [x] 2.1 Reescribir la descripción y los `describe()` de `expediente_agregar` (objetivo: eliminar el mínimo de 2.6 que arrastra la nota global)
- [x] 2.2 Reescribir la descripción de `expediente_leer` (eliminar la cláusula confusa "crea un expediente EN MEMORIA"; aclarar el origen del `id`)
- [x] 2.3 Reescribir las descripciones de `buscar_normativa_anh` y `buscar_resoluciones_creg` (Purpose 4 → 5, Usage Guidelines 3–4 → 5)
- [x] 2.4 Reescribir las descripciones de `buscar_jurisprudencia`, `consultar_perfil` y `consultar_por_jerarquia` (subir Parameters y Completitud)
- [x] 2.5 Añadir `describe()` a parámetros sin descripción señalados por Glama: `limite` en `consultar_perfil` y `buscar_conceptos_fp`, `max_pasajes` donde falte
- [x] 2.6 Mantener el patrón de estilo actual (front-loaded, advertencias en MAYÚSCULAS, referencias cruzadas a herramientas alternativas) en todas las reescritas

## 3. Verificación de no-cambio de contrato

- [x] 3.1 Ejecutar `npm run typecheck` y `npm run lint`
- [x] 3.2 Ejecutar `npm test` y `npm run test:e2e` sin modificar las pruebas
- [x] 3.3 Verificar que los `inputSchema` de las herramientas reescritas conservan nombres, tipos, required/optional y defaults idénticos (comparar contra el estado previo)

## 4. Documentación de calidad

- [x] 4.1 Actualizar `CALIDAD_HERRAMIENTAS_GLAMA.md`: marcar como ✅ "Has glama.json" y "Has related servers" en el checklist
- [x] 4.2 Registrar en el mismo documento que el único ítem pendiente es "No recent usage — Try in Browser" como paso manual
- [x] 4.3 Documentar el comando/URL de "Try in Browser" y el sembrado de uso como opcional, sin depender de los portales del Estado
