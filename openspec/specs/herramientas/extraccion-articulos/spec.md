# herramientas/extraccion-articulos Specification

## Purpose
Define dónde empieza y dónde termina un artículo extraído del texto de una norma, para que un artículo pedido no arrastre el articulado siguiente cuando el portal escribe el encabezado sin espacio.

## Requirements
### Requirement: Encabezado sin espacio cierra el artículo anterior
Un renglón que empieza por «ARTÍCULO», «ARTICULO», «Artículo» o «Articulo» seguido directamente del número (sin espacio, p. ej. «ARTÍCULO3°.») SHALL reconocerse como encabezado de artículo, igual que con espacio. Esto vale tanto para cerrar el artículo pedido como para localizarlo y para el índice de artículos. Las reglas vigentes de bloques transcritos («quedará así:») y de referencias en prosa SHALL seguir aplicando.

#### Scenario: Artículo 2 de la Ley 769 de 2002
- **WHEN** se pide el artículo 2 de la Ley 769 de 2002, cuyo texto en el Gestor sigue con «CAPITULO II. AUTORIDADES. ARTÍCULO3°. AUTORIDADES DE TRÁNSITO»
- **THEN** el bloque devuelto termina antes de «ARTÍCULO3°» y no contiene «AUTORIDADES DE TRÁNSITO»

#### Scenario: Pedir el artículo escrito sin espacio
- **WHEN** se pide el artículo 3 de la Ley 769 de 2002
- **THEN** el sistema devuelve el texto que empieza en «ARTÍCULO3°. AUTORIDADES DE TRÁNSITO»

#### Scenario: Palabra pegada que no es encabezado
- **WHEN** un renglón empieza por «Artículos» o por «ARTÍCULO» seguido de una letra que no forma un número de artículo
- **THEN** no se toma como encabezado

#### Scenario: Sin regresión en normas medidas
- **WHEN** se extraen todos los artículos del índice de la Ley 769 de 2002, el Decreto Ley 624 de 1989, la Ley 1437 de 2011, la Ley 488 de 1998 y la Ley 789 de 2002, antes y después del cambio
- **THEN** solo cambian los artículos seguidos de un encabezado sin espacio, y cada cambio deja de incluir el artículo siguiente
