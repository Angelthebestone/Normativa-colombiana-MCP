# busqueda/busqueda-por-palabras Specification

## Purpose
Mejora los buscadores por palabras de las fuentes para que los términos se combinen con una semántica clara (todos los términos o frase exacta), se descarten palabras comunes y se cierren los huecos conocidos del índice SUIN.
## Requirements
### Requirement: Semántica de combinación de términos
El sistema SHALL aplicar una semántica de combinación de términos declarada y comprobable en los buscadores por palabras: por defecto, TODOS los términos deben aparecer (AND) o la frase completa debe coincidir (frase exacta), y si una fuente une con OR debe declararlo explícitamente en la respuesta.

#### Scenario: Todos los términos requeridos
- **WHEN** el usuario busca `contrato de prestación de servicios` en el Gestor
- **THEN** el sistema devuelve resultados donde todos los términos significativos aparecen, o declara que une con OR y no presenta el recuento como pertinencia

#### Scenario: Frase exacta
- **WHEN** el usuario pide el modo frase exacta
- **THEN** el sistema devuelve solo documentos que contienen la frase completa, sin variaciones de orden

### Requirement: Descarte de palabras comunes
El sistema SHALL descartar palabras vacías (artículos, preposiciones, conjunciones) en los buscadores de texto completo, de modo que términos poco distintivos no devuelvan decenas de miles de resultados inútiles.

#### Scenario: Término poco distintivo
- **WHEN** el usuario busca `la de` o un término con muchas palabras vacías en la Corte Suprema o el Consejo de Estado
- **THEN** el sistema filtra las palabras vacías y devuelve resultados acotados, o declara el descarte y su efecto

### Requirement: Cierre de huecos del índice SUIN
El sistema SHALL cubrir los huecos conocidos del índice SUIN mediante un índice complementario por título o un fallback por tesauro/alternativas, de modo que términos presentes en títulos de normas (p.ej. "teletrabajo" en la Ley 1221 de 2008) no devuelvan cero resultados por hueco del índice.

#### Scenario: Término con hueco del índice
- **WHEN** el usuario busca `teletrabajo` en SUIN y el índice no contiene la entrada aunque la norma tiene el término en su título
- **THEN** el sistema aplica el fallback (búsqueda viva de la API) y devuelve la norma, o declara explícitamente el hueco y sugiere `buscar_por_tema`/`resolver_cita`

### Requirement: Diccionario de abreviaturas jurídicas
El sistema SHALL resolver abreviaturas jurídicas comunes (SMLMV → "salario mínimo legal mensual vigente", DUR → "decreto único reglamentario", CPC, CCA, etc.) de forma determinista y sin tildes, ampliando el tesauro de alternativas, de modo que una búsqueda con la abreviatura encuentre los resultados del término completo.

#### Scenario: Búsqueda con abreviatura
- **WHEN** el usuario busca `SMLMV` o `DUR 1072`
- **THEN** el sistema amplía la búsqueda con el término desarrollado y devuelve los resultados, indicando la expansión usada

#### Scenario: Abreviatura no conocida
- **WHEN** el término no coincide con ninguna abreviatura del diccionario
- **THEN** el sistema busca el término literal y no inventa expansiones

