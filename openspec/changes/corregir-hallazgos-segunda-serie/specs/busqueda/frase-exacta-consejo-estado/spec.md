## ADDED Requirements

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
