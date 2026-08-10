## Purpose

Permite leer el texto de los actos sectoriales cuando el PDF publicado es textual, reutilizando la extracción ya disponible, y mantiene el aviso de escaneo cuando no hay texto que extraer.

## Requirements

### Requirement: Extracción de PDF textual sectorial
El sistema SHALL intentar extraer texto de un PDF sectorial cuando `soportaTexto=false` pero el PDF sí contiene texto (tiene `FontFile`), usando `unpdf` + `pedirBytes` + `pdfEsEscaneo`.

#### Scenario: PDF textual de una SIC
- **WHEN** `buscar_normativa_sectorial` devuelve un acto de la SIC con enlace PDF textual y el usuario pide `obtener_documento` con `fuente="sectorial"` o el hunk de lectura asociado
- **THEN** el sistema descarga el PDF con `pedirBytes` (respeta ritmo/CA de `http.ts`), detecta que no es escaneo, extrae texto y lo devuelve troceado con `trocear`/`fragmentos` y `advertenciasVigencia`, con URL citable

#### Scenario: PDF escaneado
- **WHEN** el PDF es escaneo (`pdfEsEscaneo` true)
- **THEN** el sistema devuelve `avisoSinTexto(..., escaneo=true)` y remite al visor/URL, sin afirmar que el acto no diga nada

#### Scenario: Límites y paginación
- **WHEN** el texto extraído supera `limite_caracteres` (200–40.000, default 8000)
- **THEN** el sistema lo trocea igual que `obtener_documento` con `fuente="gestor"`/`"corte"` e informa `total/mostrado/omitido` y `buscar_en_texto` fragmentado

### Requirement: No romper el contrato sectorial
El sistema SHALL mantener `soportaTexto` y `advertencia` del adaptador tal cual: la extracción es un intento best-effort, no cambia la declaración de la fuente.

#### Scenario: Fuente declara soportaTexto=false
- **WHEN** un adaptador existente declara `soportaTexto=false`
- **THEN** su `advertencia` y su `soportaTexto` siguen igual; solo la respuesta de lectura puede traer texto extraído además del epígrafe

### Requirement: Seguridad y ritmo
El sistema SHALL validar `dominioPermitido` del PDF contra el adaptador y SHALL descargar vía `http.ts` (TLS con CA completa, sin `rejectUnauthorized:false`, con cola por dominio y reintento 429/503).

#### Scenario: PDF en dominio no permitido
- **WHEN** el enlace PDF no pertenece al `dominioPermitido` del adaptador
- **THEN** el sistema no lo descarga y devuelve aviso con el dominio esperado
