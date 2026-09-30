## Purpose

Asegura que las fuentes sectoriales no entreguen como normativa lo que declaran excluir ni impriman como dato un valor vacío del portal.

## ADDED Requirements

### Requirement: La SIC excluye por etiqueta y por epígrafe
El sistema SHALL excluir de los resultados de la SIC los actos cuya etiqueta de tipo contenga «Nombramientos», «Proyecto de resolución», «Proyecto de circular» o «Tablas de retención documental», aunque la etiqueta sea compuesta («Resoluciones, Nombramientos»), y los que no traen etiqueta pero cuyo epígrafe empieza por «Proyecto de». La nota de la respuesta, que declara esa exclusión, SHALL ser cierta.

#### Scenario: Etiqueta compuesta
- **WHEN** una fila de la SIC trae la etiqueta «Resoluciones, Nombramientos»
- **THEN** el sistema la excluye de los resultados

#### Scenario: Proyecto sin etiqueta
- **WHEN** una fila de la SIC no trae etiqueta y su epígrafe empieza por «Proyecto de Resolución»
- **THEN** el sistema la excluye de los resultados

#### Scenario: Resolución normal
- **WHEN** una fila de la SIC es una resolución de carácter general sin esas marcas
- **THEN** el sistema la conserva

### Requirement: Un valor vacío del portal no se imprime como dato
El sistema SHALL tratar el texto «None» que la ANH publica como categoría de un acto como ausencia de categoría, y SHALL NOT imprimirlo.

#### Scenario: Acto sin categoría en la ANH
- **WHEN** la ANH lista un acto cuya categoría es «None»
- **THEN** el resultado se muestra sin el sufijo « — None»

#### Scenario: Acto con categoría
- **WHEN** la ANH lista un acto con categoría «Regalías»
- **THEN** el resultado sigue mostrando « — Regalías»
