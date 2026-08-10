# sectorial/contenido-documental Specification

## Purpose
Permite extraer directamente el texto de los documentos `.doc/.docx` que publican las fuentes sectoriales, manteniendo el contrato `soportaTexto=false` y el aviso cuando no hay texto que extraer.
## Requirements
### Requirement: Lectura de documentos Word sectoriales
El sistema SHALL intentar extraer el texto de un documento `.doc/.docx` de una fuente sectorial cuando el enlace del acto apunta a un archivo Word y el archivo es textual, devolviendo el texto troceado con los mismos límites (`trocear`/`fragmentos`, `limite_caracteres` 200–40.000, default 8000) y las advertencias de vigencia.

#### Scenario: Documento .docx textual de una fuente sectorial
- **WHEN** `buscar_normativa_sectorial` devuelve un acto cuyo enlace es un `.docx` textual y el usuario pide el texto vía la herramienta de lectura
- **THEN** el sistema descarga el archivo con `pedirBytes`, detecta que es un documento Word, extrae el texto y lo devuelve troceado, con la URL citable y sin afirmar vigencia

#### Scenario: Documento .doc binario sin decodificador
- **WHEN** el archivo es `.doc` binario y el sistema no dispone de decodificador
- **THEN** el sistema devuelve el aviso de "sin texto extraíble" con el enlace, sin afirmar que el documento no diga nada

#### Scenario: Límites y paginación del texto Word
- **WHEN** el texto extraído supera `limite_caracteres`
- **THEN** el sistema lo trocea igual que `obtener_documento` y reporta `total/mostrado/omitido` y `buscar_en_texto` fragmentado

### Requirement: Validación de dominio y seguridad
El sistema SHALL validar el `dominioPermitido` del archivo Word contra el adaptador y SHALL descargar vía `http.ts` (TLS con CA completa, sin `rejectUnauthorized:false`, cola por dominio y reintento 429/503).

#### Scenario: Archivo en dominio no permitido
- **WHEN** el enlace `.doc/.docx` no pertenece al `dominioPermitido` del adaptador
- **THEN** el sistema no lo descarga y devuelve un aviso con el dominio esperado

### Requirement: No romper el contrato sectorial
El sistema SHALL mantener `soportaTexto`, `soportaVigencia` y `advertencia` del adaptador tal cual: la extracción Word es best-effort y no cambia la declaración de la fuente.

#### Scenario: Fuente declara soportaTexto=false
- **WHEN** un adaptador declara `soportaTexto=false` y su acto enlaza un `.docx`
- **THEN** la `advertencia` y el `soportaTexto` se mantienen; solo la respuesta de lectura puede traer texto extraído además del epígrafe

### Requirement: Ritmo de 1 llamada por segundo por fuente
El sistema SHALL limitar las llamadas a cada fuente a 1 por segundo (máximo 1/s sostenido por dominio), de modo que el ritmo se mantenga incluso cuando una consulta dispara varias peticiones (pestañas de Unidad de Víctimas, lote de citas, federado).

#### Scenario: Consulta que dispara varias peticiones
- **WHEN** una consulta dispara varias peticiones a la misma fuente (varias pestañas, varias citas)
- **THEN** el sistema las serializa a 1/s y no supera ese ritmo por dominio

#### Scenario: Lote de citas
- **WHEN** `resolver_citas` resuelve varias citas
- **THEN** las peticiones al Gestor se espacian a 1/s y la respuesta llega completa, sin errores de ritmo

