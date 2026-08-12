## Purpose

Expone una herramienta única `consultar_vigencia` que resuelve la vigencia de una cita intentando `resolver_cita` primero y explica el nivel de confianza de la respuesta según la fuente que la sustenta (Gestor confiable, SUIN con contradicciones conocidas, sectoriales sin verificación), ahorrando recordar qué índice creerle a cada fuente.

## ADDED Requirements

### Requirement: Herramienta consultar_vigencia
El sistema SHALL exponer `consultar_vigencia(cita)` que recibe una cita normativa (p.ej. "Ley 100 de 1993", "Decreto 1072 de 2015") y devuelve: el estado de vigencia resuelto por `resolver_cita` (o el de la ficha SUIN directa cuando aplique), la URL de la ficha, y un nivel de confianza declarado según la fuente (`alta` para Gestor/ficha directa, `media` para SUIN índice con contradicciones conocidas, `baja` para fuentes sectoriales sin verificación), junto con la explicación de por qué ese nivel.

#### Scenario: Vigencia desde el Gestor
- **WHEN** `consultar_vigencia("Decreto 1072 de 2015")` y `resolver_cita` responde desde el Gestor
- **THEN** la herramienta devuelve el estado del Gestor con `confianza: alta` y la URL de la ficha

#### Scenario: Vigencia desde SUIN
- **WHEN** `consultar_vigencia("Ley 74 de 1923")` y la respuesta viene del índice SUIN
- **THEN** la herramienta devuelve el estado con `confianza: media` y recuerda que el índice SUIN ha contradicho la ficha oficial del documento en casos conocidos, remitiendo a la ficha directa

#### Scenario: Vigencia no consta
- **WHEN** ninguna fuente cubre la cita
- **THEN** la herramienta responde "no consta" con `confianza: baja` y explica qué fuente podría tener el dato (p.ej. Diario Oficial, Función Pública)

### Requirement: Una sola llamada, sin ampliar el ritmo
El sistema SHALL resolver la vigencia en una sola llamada reutilizando los módulos existentes (`resolver_cita`, ficha SUIN directa, caché de ficha) y SHALL no aumentar el ritmo de llamadas por segundo de `http.ts`.

#### Scenario: Cita con ficha cacheada
- **WHEN** la misma cita se consulta dos veces en 30 min
- **THEN** la segunda llamada reutiliza la caché de ficha y no dispara petición nueva

#### Scenario: Cita inválida
- **WHEN** la cita no tiene forma de cita colombiana
- **THEN** la herramienta devuelve el aviso de forma del parser, sin consultar ninguna fuente
