## Purpose

Añade el modo frase exacta al buscador de jurisprudencia del Consejo de Estado, con la misma semántica declarada que la Corte Suprema: frase exacta por defecto y ampliación a OR explícita solo cuando la exacta no rinde, para que el recuento mida pertinencia.


## Requirements

### Requirement: Modo frase exacta en Consejo de Estado
El sistema SHALL exponer un parámetro `exacto` (booleano, default `true`) en la búsqueda de jurisprudencia del Consejo de Estado, de modo que por defecto se busque la frase completa como unidad y el recuento de resultados mida la presencia de esa frase, no la unión de términos sueltos.

#### Scenario: Búsqueda por frase exacta
- **WHEN** el usuario llama la búsqueda del Consejo de Estado con `texto="responsabilidad fiscal de los servidores"` y `exacto=true` (o sin el parámetro)
- **THEN** el sistema devuelve solo providencias que contienen la frase completa, y el total declarado corresponde a esa frase, no a la unión de sus palabras

#### Scenario: Recuento sin pertinencia
- **WHEN** el usuario pide `exacto=false`
- **THEN** el sistema une los términos con OR, declara explícitamente en la respuesta que el recuento NO mide pertinencia, e invita a repetir con `exacto=true`


### Requirement: Fallback a OR declarado
El sistema SHALL, cuando la frase exacta no devuelve resultados y el texto tiene más de una palabra, reintentar uniendo las palabras con OR y SHALL declarar en la respuesta que se amplió la búsqueda, de modo que el usuario sepa que el resultado es más amplio que la frase pedida.

#### Scenario: Frase sin resultados
- **WHEN** `exacto=true` con una frase de varias palabras devuelve 0 resultados
- **THEN** el sistema reintenta con OR, devuelve resultados y antepone que se buscó la frase exacta y luego se amplió uniendo las palabras

#### Scenario: Frase con resultados
- **WHEN** la frase exacta devuelve resultados
- **THEN** el sistema no amplía a OR y no añade la nota de ampliación
