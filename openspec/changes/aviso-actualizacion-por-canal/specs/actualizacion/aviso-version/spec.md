## Purpose

Fija cuándo el servidor comprueba si hay una versión nueva publicada, de qué versiones avisa, cuántas veces lo hace y qué instrucción concreta recibe quien la instaló por cada canal (npx, `.mcpb`, npm o copia del código), para que nadie se quede en una versión vieja sin saberlo.

## ADDED Requirements

### Requirement: Comprobación al arrancar, sin bloquear
El servidor SHALL consultar la última versión publicada en el registro de npm una sola vez por proceso y SHALL lanzar esa consulta al arrancar, sin esperar a que llegue una llamada. La consulta SHALL NOT retrasar la respuesta a `initialize` ni la de ninguna herramienta. Si el registro no contesta en 3 segundos, o contesta con error o con un cuerpo ilegible, el servidor SHALL tratarlo como «sin versión nueva» durante el resto del proceso. El error SHALL NOT aparecer en ninguna respuesta.

#### Scenario: Registro lento
- **WHEN** el registro tarda más de 3 segundos en contestar
- **THEN** ninguna respuesta lleva aviso de versión ni mensaje de error, y las herramientas responden como siempre

#### Scenario: La primera respuesta no espera
- **WHEN** llega la primera llamada antes de que el registro haya contestado
- **THEN** esa respuesta sale sin esperar al registro, y el aviso, si procede, va en la primera respuesta posterior a la contestación del registro

#### Scenario: Servidor sin versión empaquetada
- **WHEN** el servidor se ejecuta sin versión empaquetada (desarrollo, `VERSION` = `dev`)
- **THEN** no consulta el registro ni avisa

### Requirement: Aviso de cualquier versión posterior
El servidor SHALL avisar cuando la versión publicada es posterior a la que se ejecuta en cualquiera de sus tres componentes (mayor, menor o parche), comparados numéricamente. El servidor SHALL NOT avisar si la publicada es igual o anterior.

#### Scenario: Parche nuevo
- **WHEN** se ejecuta la 1.15.1 y el registro publica la 1.15.2
- **THEN** el servidor avisa de la 1.15.2

#### Scenario: Comparación numérica
- **WHEN** se ejecuta la 1.9.0 y el registro publica la 1.10.0
- **THEN** el servidor avisa (10 es mayor que 9, aunque como texto «1.10» sea menor que «1.9»)

#### Scenario: Registro por detrás
- **WHEN** se ejecuta la 1.15.2 y el registro publica la 1.15.1 o la 1.15.2
- **THEN** no hay aviso

### Requirement: Un solo aviso por proceso, al pie
El aviso SHALL ir al final de una sola respuesta por proceso, después del descargo, y SHALL NOT repetirse en las siguientes respuestas del mismo proceso. Las respuestas con `formato: "json"` SHALL NOT llevarlo, para no romper el JSON.

#### Scenario: Varias llamadas en la misma sesión
- **WHEN** hay versión nueva y el usuario hace cinco llamadas
- **THEN** exactamente una de las cinco respuestas lleva el aviso

#### Scenario: Respuesta JSON
- **WHEN** la respuesta que tocaría llevar el aviso se pidió con `formato: "json"`
- **THEN** esa respuesta no lo lleva, y el aviso sale en la siguiente respuesta de texto

### Requirement: Instrucción según el canal de instalación
El aviso SHALL nombrar la versión en ejecución y la nueva, y SHALL dar la instrucción que corresponde al canal por el que se ejecuta el servidor. El canal se determina en este orden de prioridad:
1. **`.mcpb`**, declarado por el manifiesto de la extensión: SHALL enlazar el release de la versión nueva (`…/releases/tag/v<nueva>`) y decir que hay que instalar ese archivo en el cliente.
2. **npx** (el proceso lo lanzó `npm exec`/`npx`):
   - con el paquete pedido sin versión o con `@latest`: SHALL decir que la versión nueva se instala sola al reiniciar el cliente MCP;
   - con una versión o un rango fijados: SHALL decir que la instalación está fijada en esa especificación y que hay que cambiarla, o usar `@latest`, para recibir la nueva.
3. **npm en un proyecto** (el servidor está dentro de un `node_modules` que no es la caché de npx): SHALL dar el comando `npm install normativa-colombia-mcp@<nueva>`.
4. **Copia del código** (el servidor se ejecuta desde un repositorio clonado): SHALL indicar `git pull`, `npm install` y `npm run build`.
5. **Desconocido:** SHALL enlazar la página de releases y la instrucción de npx.

El aviso SHALL NOT afirmar que la actualización es automática en ningún canal distinto de npx sin versión fijada.

#### Scenario: Extensión .mcpb
- **WHEN** el servidor se ejecuta desde la extensión `.mcpb` y hay una versión 1.16.0
- **THEN** el aviso enlaza `https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases/tag/v1.16.0` y no dice que se actualice sola

#### Scenario: npx sin versión
- **WHEN** el servidor se lanzó con `npx -y normativa-colombia-mcp` y hay una versión nueva
- **THEN** el aviso dice que se instala sola al reiniciar el cliente MCP

#### Scenario: npx fijado
- **WHEN** el servidor se lanzó con `npx -y normativa-colombia-mcp@1.15.1` y hay una 1.15.2
- **THEN** el aviso dice que la instalación está fijada en `normativa-colombia-mcp@1.15.1` y cómo recibir la nueva

#### Scenario: Copia del código
- **WHEN** el servidor se ejecuta desde un clon del repositorio
- **THEN** el aviso indica `git pull`, `npm install` y `npm run build`, y no menciona npx como vía automática

### Requirement: Documentación de las actualizaciones por canal
El README SHALL incluir una sección de actualizaciones que diga, para cada canal (npx, `.mcpb`, npm en un proyecto, copia del código), si la versión nueva llega sola y, si no, qué hacer. SHALL decir también que el servidor avisa una vez por sesión y que, para comprobarlo, consulta el registro de npm.

#### Scenario: Usuario del .mcpb
- **WHEN** quien instaló el `.mcpb` lee la sección de actualizaciones
- **THEN** sabe que su instalación no se actualiza sola y dónde descargar la versión nueva
