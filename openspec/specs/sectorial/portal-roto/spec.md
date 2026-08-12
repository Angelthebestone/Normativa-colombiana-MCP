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
