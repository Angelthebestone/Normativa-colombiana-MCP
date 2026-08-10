# Política de seguridad

## Versiones con soporte

Se da soporte a la última versión publicada en [Releases](https://github.com/Angelthebestone/Normativa-colombiana-MCP/releases).

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Escribe a **adavidpena@uts.edu.co** con:

- Qué encontraste y cómo reproducirlo.
- Qué versión de la extensión y qué sistema operativo.
- El impacto que le ves.

Recibirás respuesta en un plazo de 7 días. Si el reporte se confirma, se publica una versión corregida y se te acredita, salvo que prefieras lo contrario.

También puedes usar el reporte privado de GitHub desde la pestaña *Security* del repositorio.

## Qué cuenta como vulnerabilidad aquí

Este es un servidor MCP que corre en el computador del usuario, lee dos portales públicos y no guarda credenciales. El perfil de riesgo es distinto al de un servicio web, así que conviene ser explícito.

**Sí interesa saberlo:**

- Cualquier forma de ejecutar código a través de una respuesta de los portales.
- Escritura o lectura de archivos fuera de la carpeta de la extensión y del directorio temporal.
- Que la extensión mande datos a algún sitio que no sean los dos portales oficiales.
- Debilitamiento de la verificación TLS. La cadena de `funcionpublica.gov.co` se completa con un intermedio público incluido en `src/nucleo/ca.ts`; cualquier cambio que en la práctica desactive la verificación es un fallo de seguridad, no una comodidad.
- Que un `.mcpb` publicado no corresponda al código de este repositorio.

**No cuenta como vulnerabilidad:**

- Que los portales oficiales estén caídos, lentos o cambien su HTML. Eso es un fallo funcional: ábrelo como issue con la plantilla «El portal cambió».
- Que una norma esté desactualizada o mal clasificada en la fuente. La extensión no edita los contenidos oficiales.
- Que la extensión no pueda confirmar si una norma sigue vigente. Es una limitación conocida y documentada: las fuentes no publican ese dato.

## Privacidad

Las consultas viajan a servidores del Estado colombiano, que registran las peticiones y la dirección IP igual que si la persona navegara el sitio. La extensión no envía nada a ningún otro servidor, no incorpora analítica y no recoge información del usuario. Está advertido en el README porque alguien puede consultar sobre su propio proceso disciplinario.
