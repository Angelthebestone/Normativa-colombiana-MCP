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


### Requirement: Cero resultados no es un cambio de marcado
Cuando SAMAI responde 200 sin el rótulo de paginación y sin filas de resultados, pero la respuesta conserva el armazón de la página de resultados, el sistema SHALL tratarlo como cero resultados y SHALL NOT lanzar el error de «el portal cambió su estructura». Con una frase de varias palabras SHALL seguir a la ampliación a OR ya declarada; con una sola palabra SHALL devolver el vacío con orientación. El sistema SHALL seguir lanzando el error de estructura cuando falta también el armazón, o cuando el portal declara páginas de resultados y no se lee ninguna fila.

#### Scenario: Una palabra sin resultados
- **WHEN** el usuario busca «qwertyzzz» con `exacto=true`
- **THEN** el sistema responde que no encontró providencias y sugiere un término más general, sin error de estructura ni la orden de actualizar la extensión

#### Scenario: Frase sin resultados
- **WHEN** el usuario busca una frase de varias palabras sin apariciones exactas con `exacto=true`
- **THEN** el sistema amplía a OR y antepone el aviso de ampliación, en vez de fallar

#### Scenario: Página realmente rota
- **WHEN** SAMAI responde sin el rótulo de paginación y sin el armazón de resultados
- **THEN** el sistema sigue lanzando el error de cambio de estructura, que sí manda a actualizar la extensión

#### Scenario: Perfil de contratación estatal
- **WHEN** el usuario consulta el perfil de contratación estatal con un término sin resultados
- **THEN** el sistema responde con el vacío del perfil y no con el error de estructura


### Requirement: El aviso de OR solo acompaña a una búsqueda hecha en OR
La respuesta de `buscar_jurisprudencia_consejo_estado` SHALL decir que el buscador une los términos con OR y que el número de páginas no mide pertinencia únicamente cuando la búsqueda se hizo en OR: porque el usuario pidió `exacto=false` o porque una frase exacta sin resultados se amplió. Con la frase exacta activa y resultados, el número de páginas SHALL presentarse como el de providencias que contienen la frase.

#### Scenario: Frase exacta con resultados
- **WHEN** el usuario busca «nulidad electoral» con `exacto=true` y hay providencias que contienen la frase
- **THEN** la respuesta no afirma que el buscador une los términos con OR ni que el número de páginas mide el corpus

#### Scenario: Búsqueda ampliada a propósito
- **WHEN** el usuario busca «nulidad electoral» con `exacto=false`
- **THEN** la respuesta declara que es el modo ampliado (OR), que el número de páginas no mide pertinencia y cómo repetir con la frase exacta

#### Scenario: Frase sin resultados que se amplía
- **WHEN** una frase exacta sin resultados se amplía a OR
- **THEN** la respuesta antepone el aviso de ampliación y declara el modo OR
