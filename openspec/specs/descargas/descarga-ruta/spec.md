# descargas/descarga-ruta Specification

## Purpose
Permite descargar resoluciones, documentos y providencias de las fuentes a una ruta local que el usuario indique, validando el dominio y reportando la ruta absoluta y el tamaño.
## Requirements
### Requirement: Descarga a ruta local configurable
El sistema SHALL exponer una opción de descarga que reciba una ruta local (directorio) y devuelva la ruta absoluta del archivo guardado y su tamaño en bytes, cuando el documento de la fuente tenga un enlace descargable.

#### Scenario: Descarga a ruta especificada
- **WHEN** el usuario pide descargar una resolución/documento/providencia indicando `ruta_destino` (p.ej. `C:\Users\...\Descargas\normativa`)
- **THEN** el sistema descarga el archivo, lo escribe en esa ruta y responde con `Archivo guardado en: <ruta absoluta> (N bytes)` y la URL de origen

#### Scenario: Ruta inexistente o no escribible
- **WHEN** la ruta destino no existe o no se puede escribir
- **THEN** el sistema devuelve un error claro indicando la ruta y el motivo, sin dejar el proceso a medias

#### Scenario: Sin ruta destino
- **WHEN** el usuario no indica ruta de descarga
- **THEN** el comportamiento actual (solo texto/lectura) no cambia

### Requirement: Validación de dominio en descargas
El sistema SHALL validar que el enlace descargado pertenezca al `dominioPermitido` de la fuente (o al dominio documentado) antes de escribir en disco.

#### Scenario: Enlace fuera del dominio permitido
- **WHEN** el enlace del documento no pertenece al dominio permitido
- **THEN** la descarga se rechaza con el dominio esperado y no se escribe ningún archivo

### Requirement: Nombre de archivo y sanitización
El sistema SHALL derivar un nombre de archivo seguro a partir del documento (tipo, número, año, o nombre del archivo origen), evitando `..` y caracteres de ruta, y SHALL evitar sobrescribir sin aviso si el archivo ya existe (añade sufijo o pregunta).

#### Scenario: Archivo ya existente
- **WHEN** ya existe un archivo con el mismo nombre en la ruta destino
- **THEN** el sistema añade un sufijo numérico (p.ej. `_1`) y lo informa, en vez de sobrescribir en silencio

### Requirement: Exportación de expedientes a archivo
El sistema SHALL permitir exportar un expediente a un archivo (markdown o JSON) en una ruta indicada, con `expediente(accion: "exportar", ruta)`, combinando la persistencia y permitiendo guardar la investigación fuera del MCP.

#### Scenario: Exportar expediente a ruta
- **WHEN** el usuario pide exportar un expediente existente a una ruta
- **THEN** el sistema escribe el expediente (agrupado por sección) en esa ruta y devuelve la ruta absoluta y el tamaño

#### Scenario: Expediente inexistente al exportar
- **WHEN** el expediente no existe o expiró
- **THEN** el sistema lo informa y no crea ningún archivo

