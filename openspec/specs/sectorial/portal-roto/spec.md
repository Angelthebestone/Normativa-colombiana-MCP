## Purpose

Detecta discordancias entre el número citado en el epígrafe de un acto y el nombre del archivo enlazado (errores confirmados en Parques Nacionales y Mintrabajo), y las expone como advertencia no bloqueante para que el usuario verifique antes de abrir el PDF.


## Requirements

### Requirement: Advertencia de discordancia epígrafe-archivo
El sistema SHALL comparar, cuando ambos datos estén disponibles, el número de norma citado en el epígrafe (p.ej. "Resolución 1234") contra el nombre del archivo enlazado (p.ej. `RESOLUCION-HONORARIOS-FIN.pdf`) y SHALL añadir una advertencia no bloqueante cuando no correspondan, sin descartar el resultado.

#### Scenario: Archivo que no corresponde al epígrafe
- **WHEN** un acto de Parques Nacionales muestra epígrafe "Resolución 123 de 2020" y enlaza `RESOLUCION-HONORARIOS-FIN.pdf`
- **THEN** el sistema devuelve el acto con una advertencia tipo `El nombre del archivo enlazado no parece corresponder al número citado; verificar antes de citar`, sin ocultar el resultado

#### Scenario: Concordancia normal
- **WHEN** el epígrafe y el nombre del archivo coinciden (mismo número)
- **THEN** el sistema no añade la advertencia


### Requirement: Advertencia conservadora
El sistema SHALL limitar la advertencia a los casos donde la discordancia es clara (número presente en el epígrafe y ausente o distinto en el nombre del archivo) y SHALL no marcar falsos positivos por nombres de archivo genéricos, abreviados o sin número.

#### Scenario: Nombre de archivo sin número
- **WHEN** el archivo enlazado tiene un nombre genérico sin número identificable (p.ej. `documento.pdf`, `acto.pdf`)
- **THEN** el sistema no marca discordancia y no añade la advertencia

#### Scenario: Número coincidente con variante
- **WHEN** el archivo usa una variante del número (p.ej. `Resolucion_123_2020.pdf` para "Resolución 123 de 2020")
- **THEN** el sistema no marca discordancia


### Requirement: El nombre del archivo se compara ya decodificado
El sistema SHALL extraer el número del archivo enlazado después de decodificar los escapes de porcentaje de su nombre, de modo que «DECRETO%201227%20DEL%2018%20DE%20JULIO%20DE%202022.pdf» dé 1227 y no 201227. Un enlace con escapes mal formados SHALL NOT romper la comparación: se usa el nombre tal cual.

#### Scenario: Espacios codificados junto al número
- **WHEN** el archivo enlazado se llama «DECRETO%201227%20DEL%2018%20DE%20JULIO%20DE%202022.pdf» y el acto declara el número 1227
- **THEN** el sistema no añade advertencia de discordancia

#### Scenario: Escape mal formado
- **WHEN** el nombre del archivo trae un «%» que no es un escape válido
- **THEN** el sistema compara con el nombre sin decodificar y no falla


### Requirement: El número propio del acto es el de su celda «Norma»
Para las fuentes que publican el número del acto en su propia celda (Mintrabajo), el sistema SHALL comparar el número del archivo con el de esa celda y SHALL NOT compararlo con el epígrafe, porque el epígrafe de un acto modificatorio cita la norma que modifica y no la suya.

#### Scenario: Decreto que modifica a otro
- **WHEN** la fila dice «Decreto 1227 de 2022», su epígrafe habla de modificar el Decreto 1072 de 2015 y el archivo es el del 1227
- **THEN** el sistema no advierte discordancia

#### Scenario: Fila con el número equivocado
- **WHEN** la fila dice «Ley 2021 de 2021» y enlaza el PDF de la Ley 2101 de 2021
- **THEN** el sistema sigue advirtiendo de la discordancia
