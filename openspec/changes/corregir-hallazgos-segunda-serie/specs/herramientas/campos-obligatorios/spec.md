## Purpose

Garantiza que un campo obligatorio ausente se rechace como ausente, con el nombre del campo, y que el esquema que se publica a los clientes lo declare obligatorio, en vez de convertir la ausencia en el texto «undefined» y presentarlo como un valor equivocado.

## ADDED Requirements

### Requirement: Un campo obligatorio ausente se rechaza como ausente
Cuando falta un campo obligatorio de una herramienta, el sistema SHALL rechazar la llamada con el mensaje «Falta "<campo>", que es obligatorio» seguido de la descripción del campo, y SHALL NOT convertir la ausencia en la cadena «undefined» ni citarla como si el cliente la hubiera enviado. Esto SHALL valer para todo campo obligatorio, tenga o no una expresión regular de formato.

#### Scenario: `explicar_relacion_tema` sin `temsubid`
- **WHEN** el cliente llama a `explicar_relacion_tema` solo con `normid`
- **THEN** el sistema responde que falta «temsubid», que es obligatorio, y explica que sale de `buscar_por_tema` con su prefijo («ts-38872»), sin la palabra «undefined»

#### Scenario: Campo presente pero de otro catálogo
- **WHEN** el cliente envía `temsubid` con un id pelado o con el prefijo de otra taxonomía
- **THEN** el sistema sigue rechazándolo con la explicación de los tres catálogos temáticos, como hasta ahora

#### Scenario: Campo obligatorio con formato
- **WHEN** falta `normid`, que exige solo dígitos
- **THEN** el sistema responde que falta «normid», como hasta ahora

### Requirement: El esquema publicado declara obligatorio lo que es obligatorio
El esquema JSON que cada herramienta publica a los clientes SHALL listar como obligatorio todo campo sin el cual la herramienta no puede funcionar. En `explicar_relacion_tema` SHALL figurar `temsubid` junto a `normid`.

#### Scenario: Esquema de `explicar_relacion_tema`
- **WHEN** un cliente lee el esquema de `explicar_relacion_tema`
- **THEN** los campos obligatorios son `temsubid` y `normid`

#### Scenario: Ninguna herramienta acepta un obligatorio por omisión
- **WHEN** se recorre el esquema de las 28 herramientas
- **THEN** ningún campo cuya ausencia produce «undefined» al validarse figura como opcional
