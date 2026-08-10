## MODIFIED Requirements

### Requirement: Adaptador Unidad para las Víctimas
El sistema SHALL registrar un adaptador `unidadvictimas` para la biblioteca de documentos de la UARIV en `/documentos_bibliotec/`, con `dominioPermitido`, `tiposDocumento` (Informes, Planeación, Presupuesto, Documento), `soportaTexto=false`, `soportaVigencia=false`, `pruebasMinimas` y `advertencia` que aclare que son documentos de gestión, no actos con fuerza normativa. El adaptador SHALL leer TODAS las pestañas/categorías de la página (cada pestaña es una categoría distinta), no solo la visible por defecto, y SHALL permitir filtrar por `categoria`.

#### Scenario: Listado de documentos
- **WHEN** `buscar_normativa_sectorial` con `entidad="unidadvictimas"` sin filtros
- **THEN** el sistema devuelve documentos con categoría como tipo, título como epígrafe, fecha de publicación y enlace a la página del documento, agregando las pestañas de todas las categorías

#### Scenario: Filtro por categoría
- **WHEN** se pide `categoria="Planeación"` (o el nombre de otra pestaña)
- **THEN** el sistema consulta la pestaña/categoría correspondiente y devuelve solo sus documentos

#### Scenario: Paginación WordPress
- **WHEN** se pide `pagina=2` en Unidad de Víctimas
- **THEN** el sistema consulta `/documentos_bibliotec/page/2/` (WordPress pagina desde /page/2/) y devuelve el segundo tramo

#### Scenario: Hueco documental
- **WHEN** la búsqueda por texto no coincide con ningún documento en ninguna categoría
- **THEN** la respuesta incluye `advertencia` completa y explica que el filtro actúa sobre título y categoría, sin concluir que el documento no exista
