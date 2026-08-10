# herramientas/obtener-documento Specification

## Purpose
TBD - created by archiving change soporte-doc-docx-y-contenido-sectorial. Update Purpose after archive.
## Requirements
### Requirement: obtener_documento
El sistema SHALL exponer `obtener_documento(fuente, …)` como el único punto de lectura para las fuentes con texto: `gestor`, `corte`, `suprema`, `consejo`, `dian`, `creg`, y `sectorial` (fuentes sectoriales con documento `.doc/.docx`/PDF textual). La herramienta SHALL devolver el texto troceado por defecto (respetando `limite_caracteres` 200–40.000, default 8000, e informando total/mostrado/omitido), y SHALL permitir pedir el documento completo con un parámetro explícito (`entero=true` o `limite_caracteres=0`). La herramienta SHALL permitir descargar el documento a una ruta local con un parámetro de ruta destino.

#### Scenario: Texto troceado por defecto
- **WHEN** el usuario llama `obtener_documento` sin `entero` ni `ruta_destino`
- **THEN** el sistema devuelve el texto troceado con `limite_caracteres` e informa `total/mostrado/omitido`, como hoy

#### Scenario: Documento completo
- **WHEN** el usuario pide `entero=true` (o `limite_caracteres=0`)
- **THEN** el sistema devuelve el documento íntegro sin trocear, con su URL y las advertencias de vigencia

#### Scenario: Descarga a ruta
- **WHEN** el usuario indica `ruta_destino`
- **THEN** el sistema descarga el documento a esa ruta y devuelve la ruta absoluta y el tamaño

#### Scenario: Fuente sectorial
- **WHEN** `fuente="sectorial"` y el acto enlaza un documento `.doc/.docx` o PDF textual
- **THEN** el sistema extrae el texto del documento con los mismos límites y avisos que el resto de fuentes

#### Scenario: Límite fuera de rango
- **WHEN** `limite_caracteres` se envía fuera de 200–40.000
- **THEN** el sistema lo ajusta al rango (salvo `0`/`entero` que piden el documento completo) y no revienta con un error de validación crudo

### Requirement: Citas navegables en los textos
El sistema SHALL detectar en el texto devuelto las menciones a otras normas ("Ley 100 de 1993", "Decreto 1072 de 2015") usando el parser de citas existente, y SHALL devolverlas como lista "Este documento menciona: …" con la forma canónica y un recordatorio de `resolver_cita`, para que el MCP sea navegable entre normas.

#### Scenario: Texto con menciones
- **WHEN** `obtener_documento` devuelve un texto que menciona "Ley 100 de 1993" y "Decreto 1072 de 2015"
- **THEN** la respuesta incluye la lista "Este documento menciona: Ley 100 de 1993; Decreto 1072 de 2015" tras el texto

#### Scenario: Sin menciones
- **WHEN** el texto no contiene citas parseables
- **THEN** la respuesta no inventa la lista y sigue el formato actual

### Requirement: Lote de citas
El sistema SHALL aceptar una lista de citas en `resolver_cita` (o una variante `resolver_citas`) y SHALL resolverlas de una llamada, devolviendo cada veredicto con su forma y su enlace, sin aumentar el ritmo de llamadas por segundo.

#### Scenario: Varias citas en una llamada
- **WHEN** el usuario pide resolver "Ley 100 de 1993" y "Decreto 1072 de 2015" en una sola llamada
- **THEN** el sistema resuelve ambas y devuelve un resultado por cita, cada uno con su forma y su enlace

#### Scenario: Una cita inválida en el lote
- **WHEN** una de las citas del lote no tiene forma de cita colombiana
- **THEN** el sistema resuelve las válidas y marca la inválida con el aviso de forma, sin fallar el lote entero

