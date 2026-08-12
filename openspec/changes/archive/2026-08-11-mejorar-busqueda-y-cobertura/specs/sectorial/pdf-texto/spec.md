## MODIFIED Requirements

### Requirement: Extracción de PDF textual sectorial
El sistema SHALL intentar extraer texto de un PDF sectorial cuando `soportaTexto=false` pero el PDF sí contiene texto (tiene `FontFile`), usando `unpdf` + `pedirBytes` + `pdfEsEscaneo`. El sistema SHALL intentar también la extracción de documentos `.doc/.docx` textuales con los mismos límites y avisos. Además, el sistema SHALL permitir que el **buscador** localice actos cuyo término clave está solo en el PDF (no en el índice del portal), empezando por la UPME como caso piloto: cuando la búsqueda por índice devuelve vacío y el portal ofrece un buscador que indexa el contenido del PDF (p.ej. `?q=` de la Biblioteca Jurídica), el sistema SHALL consultar ese buscador como fallback y rotular la procedencia.

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

#### Scenario: Término solo en el PDF de la UPME
- **WHEN** `buscar_normativa_upme` con `texto="vehículos eléctricos"` devuelve 0 por el REST de WordPress, pero el buscador del portal (`?q=vehículos eléctricos`) encuentra circulares cuyo término está solo en el PDF
- **THEN** el sistema consulta el buscador del portal como fallback, devuelve los actos encontrados y rotula la procedencia (`resultados del buscador del portal, que indexa el contenido del PDF`)

#### Scenario: Sin texto que extraer en UPME
- **WHEN** el acto de la UPME enlaza un PDF sin texto extraíble (escaneo)
- **THEN** el sistema entrega la referencia y el enlace, con el aviso de escaneo y sin afirmar que el acto no diga nada

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
