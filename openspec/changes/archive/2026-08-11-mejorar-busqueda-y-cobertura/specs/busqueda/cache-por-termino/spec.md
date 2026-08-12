## Purpose

Extiende la caché por término que la DIAN ya tiene (`normograma.ts`, `Map` en memoria sin TTL) con un TTL configurable y la rotulación de las respuestas servidas desde caché, para servicio largo y para que el agente sepa cuándo un resultado no es fresco.

## ADDED Requirements

### Requirement: TTL y rotulación de caché por término
El sistema SHALL mantener la caché por término existente (clave normalizada, sin duplicar la implementación) y SHALL añadirle un TTL configurable (default 30 min) y una marca en la respuesta cuando el resultado proviene de caché, de modo que una consulta repetida dentro del TTL no dispare petición a la fuente y el agente sepa que el resultado es de caché, no fresco.

#### Scenario: Segunda consulta del mismo término
- **WHEN** el usuario busca el mismo término en la DIAN dos veces con menos de 30 min de diferencia
- **THEN** la segunda llamada no hace petición a la fuente y la respuesta indica que viene de caché

#### Scenario: Caducidad del TTL
- **WHEN** el término se vuelve a buscar después de que el TTL expiró
- **THEN** el sistema consulta la fuente de nuevo y actualiza la caché

### Requirement: No alterar la semántica ni el ritmo
El sistema SHALL mantener la semántica de términos y el ritmo por dominio de `http.ts` intactos al cachear: la caché es transparente a la fuente, y un fallo de red no se sirve desde caché como si fuera un resultado fresco.

#### Scenario: Fallo de red con caché existente
- **WHEN** la fuente no responde pero existe una entrada de caché del mismo término
- **THEN** el sistema NO presenta la caché como resultado fresco: reporta el error de red y, si ofrece la caché, la rotula explícitamente como obsoleta
