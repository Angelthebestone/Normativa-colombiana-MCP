## Purpose

Deduplica los resultados de búsqueda por número de norma (sectorial) o radicado (jurisprudencia) antes de paginar, de modo que el total declarado corresponda a documentos únicos y la paginación entregue documentos nuevos.


## Requirements

### Requirement: Deduplicación por número de norma o radicado
El sistema SHALL deduplicar los resultados de búsqueda por una clave estable antes de paginar: número de norma (tipo+numero+anio) en fuentes sectoriales y radicado en jurisprudencia. Cuando dos entradas comparten la clave (p.ej. el mismo fallo publicado como `.doc` y como `.pdf`, o la misma ley listada con dos enlaces), el sistema SHALL conservar una sola entrada y SHALL declarar cuántas entradas duplicadas se fusionaron.

#### Scenario: Mismo fallo en .doc y .pdf
- **WHEN** la Corte Suprema devuelve dos entradas del mismo fallo (un `.doc` y un `.pdf`) en la misma respuesta
- **THEN** el sistema conserva una sola entrada, indica `X duplicado(s) fusionado(s)` y el total declarado cuenta documentos únicos

#### Scenario: Misma norma con dos enlaces
- **WHEN** Minagricultura o Mintrabajo listan la misma ley/decreto con dos enlaces distintos en la misma página
- **THEN** el sistema las fusiona en una entrada única y ajusta el total


### Requirement: Total coherente con la paginación
El sistema SHALL calcular el total declarado sobre documentos únicos (tras deduplicar) y SHALL advertir si el total del portal incluye duplicados, de modo que paginar con `desde`/`pagina` rinda documentos nuevos y no re-muestre entradas ya vistas.

#### Scenario: Paginación tras dedup
- **WHEN** el usuario pagina a la siguiente página tras una respuesta con duplicados fusionados
- **THEN** la siguiente página no repite las entradas ya mostradas y el total de páginas refleja el conjunto deduplicado

#### Scenario: Total del portal con duplicados
- **WHEN** el portal declara un total que incluye entradas duplicadas
- **THEN** el sistema lo declara y ofrece el total deduplicado estimado, sin afirmar que el total del portal esté mal
