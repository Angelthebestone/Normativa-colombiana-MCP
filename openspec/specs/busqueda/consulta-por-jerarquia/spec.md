## Purpose

Hace que la consulta por nivel de autoridad busque en el tipo de documento que el nivel nombra y no dé por vacío lo que la búsqueda temática sí encuentra, de modo que un «no hay nada de nivel X» sea una respuesta fiable.

## Requirements

### Requirement: Cada nivel busca en su tipo del Gestor
El sistema SHALL buscar cada nivel de autoridad en el tipo de documento del Gestor que ese nivel nombra: constitución en Constitución Política, ley en Ley, decreto en Decreto, resolución en Resolución y concepto en Concepto. El nivel constitución SHALL NOT buscar entre resoluciones, y su respuesta vacía SHALL NOT afirmar que el Gestor no cataloga la Constitución: SHALL remitir a la resolución de citas con «art. N de la Constitución Política» para el texto y a la jurisprudencia para las sentencias.

#### Scenario: Nivel constitución
- **WHEN** el usuario consulta el nivel constitución con el texto «trabajo»
- **THEN** los resultados, si los hay, son de tipo Constitución Política y nunca resoluciones

#### Scenario: Vacío del nivel constitución
- **WHEN** el nivel constitución no encuentra nada para un término
- **THEN** la respuesta no dice que el Gestor no cataloga la Constitución y remite a `resolver_cita` con «art. N de la Constitución Política»

#### Scenario: Otros niveles
- **WHEN** el usuario consulta el nivel ley, decreto, resolución o concepto
- **THEN** los resultados son del tipo de documento correspondiente, como hoy

### Requirement: El refuerzo por subtema es común a las búsquedas del Gestor
Cuando la búsqueda por palabras rinde poco y el término tiene un subtema oficial, el sistema SHALL reconsultar por esa vía, respetando el filtro de tipo, y SHALL declarar en la respuesta que la usó. Esto SHALL valer por igual para la búsqueda general de normas y para la consulta por nivel, de modo que los dos caminos no den respuestas distintas a la misma pregunta.

#### Scenario: Nivel concepto sobre un tema con subtema oficial
- **WHEN** el usuario consulta el nivel concepto con el texto «teletrabajo»
- **THEN** el sistema devuelve conceptos del Gestor clasificados bajo ese subtema (p.ej. el Concepto 602731 de 2025) y declara que reconsultó por el subtema

#### Scenario: Mismo conjunto que la búsqueda general
- **WHEN** se busca «teletrabajo» con tipo de documento Concepto en la búsqueda general de normas, y con nivel concepto en la consulta por nivel
- **THEN** ambos devuelven los mismos conceptos, hasta el límite pedido

#### Scenario: Término sin subtema oficial
- **WHEN** el término no tiene subtema en el índice temático
- **THEN** el sistema responde solo con la búsqueda por palabras y no añade aviso de refuerzo
