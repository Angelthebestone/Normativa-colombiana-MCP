## Purpose

Fija la forma de la respuesta de `resolver_cita` para que cada dato aparezca una sola vez por respuesta: la ficha de una norma, el alcance y la URL no se repiten por cita ni por artículo.

## ADDED Requirements

### Requirement: Lote agrupado por norma
Cuando `resolver_cita` recibe un lote (`citas`) y dos o más citas resuelven a la MISMA norma, el sistema SHALL emitir la ficha de esa norma (título, id, vigencia, siguiente paso, URL y, si procede, la equivalencia del código) UNA sola vez. A continuación SHALL emitir los artículos pedidos de esa norma en el orden en que aparecieron en el lote. Las normas SHALL aparecer en el orden de su primera cita. Una cita que no resuelve, o que falla por red, SHALL conservar su propio bloque con el motivo, sin afectar a las demás.

#### Scenario: Tres artículos de la misma ley en un lote
- **WHEN** `resolver_cita` recibe `citas: ["art. 14 de la Ley 1437 de 2011", "art. 17 de la Ley 1437 de 2011", "art. 21 de la Ley 1437 de 2011"]`
- **THEN** la respuesta contiene una sola línea `id: 41249`, una sola línea de estado de vigencia y los bloques de los artículos 14, 17 y 21 en ese orden

#### Scenario: Lote con normas distintas
- **WHEN** el lote mezcla `art. 140 de la Ley 488 de 1998`, `art. 59 de la Ley 788 de 2002` y `art. 143 de la Ley 488 de 1998`
- **THEN** la ficha de la Ley 488 sale una vez con los artículos 140 y 143, y la de la Ley 788 sale una vez con el artículo 59, en el orden en que cada norma se citó por primera vez

#### Scenario: Una cita del lote falla
- **WHEN** una cita del lote no se puede resolver
- **THEN** esa cita tiene su propio bloque con el motivo y las demás normas se agrupan igual

### Requirement: Alcance una vez por respuesta
El sistema SHALL emitir la línea `Alcance:` una sola vez, al principio de la respuesta de `resolver_cita`. Esa línea SHALL declarar como consultada toda fuente consultada para alguna cita del lote, y como no consultadas solo las que ninguna cita consultó.

#### Scenario: Lote con y sin ficha SUIN
- **WHEN** un lote incluye una ley con ficha SUIN y el artículo de la Constitución Política, que no tiene ficha SUIN
- **THEN** la respuesta tiene una sola línea `Alcance:`, que declara consultados el Gestor Normativo y SUIN-Juriscol

### Requirement: Artículos sin URL repetida
El bloque de cada artículo SHALL constar de su encabezado (`--- Artículo N ---`), su texto y sus advertencias de vigencia, sin una línea `URL:` propia. La URL de la norma SHALL seguir apareciendo una vez en la ficha.

#### Scenario: Varios artículos de una norma
- **WHEN** `resolver_cita` recibe `cita: "Decreto Ley 624 de 1989"` y `articulos: ["715", "717"]`
- **THEN** la URL `norma.php?i=6533` aparece una sola vez en la respuesta

### Requirement: contexto=false sin nota
Con `contexto: false`, el sistema SHALL omitir el extracto de tema asociado sin añadir ninguna nota que lo anuncie. Con `contexto` ausente o `true`, el extracto SHALL emitirse como hoy, una vez por norma y por respuesta.

#### Scenario: Extracto omitido
- **WHEN** `resolver_cita` recibe `cita: "art. 40 de la Ley 769 de 2002"` y `contexto: false`
- **THEN** la respuesta no contiene «Extracto de tema asociado» ni «contexto=true»
