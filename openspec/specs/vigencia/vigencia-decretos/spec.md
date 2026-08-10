## Purpose

Extiende la consulta de vigencia SUIN-Juriscol a decretos por ficha directa bajo demanda, para que resolver_cita y el análisis de conflictos puedan declarar vigencia también para decretos sin reindexar el corpus.

## Requirements

### Requirement: Vigencia de decretos por ficha directa
El sistema SHALL intentar la ficha SUIN directa cuando la norma es decreto (cualquier variante Decreto/Decreto Ley) y el índice empaquetado no la cubre, antes de devolver "no consta".

#### Scenario: Decreto con ficha SUIN disponible
- **WHEN** `resolver_cita` recibe "Decreto 1072 de 2015" y el índice no tiene entrada para `decreto 1072 2015`
- **THEN** el sistema pide `https://www.suin-juriscol.gov.co/viewDocument.asp?id=<id resuelto por buscador Azure o por id directo>` o el endpoint `viewDocument.asp` equivalente, extrae `estado_documento` con `fichaSuin()` y devuelve la línea `Estado de vigencia según SUIN-Juriscol (ficha directa <fecha>): <estado>` con `url` de la ficha

#### Scenario: Decreto sin ficha SUIN
- **WHEN** la ficha directa devuelve 404 o no trae `estado_documento`
- **THEN** el sistema devuelve el mensaje actual "no consta" explicando que el índice SUIN son casi solo leyes y remite al enlace del Gestor

#### Scenario: Ficha directa caída
- **WHEN** `www.suin-juriscol.gov.co` no responde o devuelve no-HTML
- **THEN** el sistema devuelve `Estado de vigencia: la ficha de SUIN-Juriscol (www.suin-juriscol.gov.co) no respondió...` sin afirmar ni negar vigencia, igual que ya hace para leyes

### Requirement: Caché y respeto al ritmo
El sistema SHALL cachear el resultado de la ficha directa en memoria (TTL 30 min por clave `tipo|numero|anio`) y SHALL respetar el ritmo por dominio de `http.ts` (cola por host, 1/s sostenido).

#### Scenario: Segunda consulta al mismo decreto
- **WHEN** se resuelve el mismo decreto dos veces en 30 min
- **THEN** la segunda no dispara petición a SUIN y reutiliza el estado previo

### Requirement: Distinción de errores observable
El sistema SHALL distinguir en la respuesta tres estados hoy confundidos: índice ausente (instalación sin `datos/indice-suin.json`), ficha caída (red), y norma no cubierta (índice sin esa clave).

#### Scenario: Instalación sin índice
- **WHEN** `coberturaIndice()` es null y se pide vigencia de un decreto
- **THEN** la respuesta dice `NO SE PUEDE CONSULTAR en esta instalación, porque el índice de SUIN no viaja con ella`

### Requirement: Integración en analizar_conflicto
El sistema SHALL intentar la ficha directa para cada norma que sea decreto en `analizar_conflicto/evidenciaDe()`, bajo las mismas reglas de caché y error.

#### Scenario: Conflicto entre dos decretos
- **WHEN** `analizar_conflicto` recibe dos decretos sin cobertura en índice
- **THEN** cada evidencia intenta la ficha directa y, si responde, expone `vigencia` en el encabezado; si no, deja `vigencia` vacía como hoy
