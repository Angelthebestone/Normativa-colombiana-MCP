## MODIFIED Requirements

### Requirement: Extracción de PDF textual sectorial
El sistema SHALL intentar extraer texto de un PDF sectorial cuando `soportaTexto=false` pero el PDF sí contiene texto (tiene `FontFile`), usando `unpdf` + `pedirBytes` + `pdfEsEscaneo`. El sistema SHALL intentar también la extracción de documentos `.doc/.docx` textuales con los mismos límites y avisos.

#### Scenario: PDF textual de una SIC
- **WHEN** `buscar_normativa_sectorial` devuelve un acto de la SIC con enlace PDF textual y el usuario pide `obtener_documento` con `fuente="sectorial"` o el hunk de lectura asociado
- **THEN** el sistema descarga el PDF con `pedirBytes` (respeta ritmo/CA de `http.ts`), detecta que no es escaneo, extrae texto y lo devuelve troceado con `trocear`/`fragmentos` y `advertenciasVigencia`, con URL citable

#### Scenario: Documento .docx sectorial
- **WHEN** un acto sectorial enlaza un `.docx` textual
- **THEN** el sistema descarga el archivo, extrae el texto Word y lo devuelve troceado con los mismos límites y avisos

#### Scenario: PDF escaneado
- **WHEN** el PDF es escaneo (`pdfEsEscaneo` true)
- **THEN** el sistema devuelve `avisoSinTexto(..., escaneo=true)` y remite al visor/URL, sin afirmar que el acto no diga nada

#### Scenario: Límites y paginación
- **WHEN** el texto extraído supera `limite_caracteres` (200–40.000, default 8000)
- **THEN** el sistema lo trocea igual que `obtener_documento` con `fuente="gestor"`/`"corte"` e informa `total/mostrado/omitido` y `buscar_en_texto` fragmentado
