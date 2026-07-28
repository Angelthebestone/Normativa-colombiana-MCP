# Aviso sobre los contenidos consultados

El código de este proyecto está bajo licencia MIT (ver [LICENSE](LICENSE)). Ese permiso cubre el software, no los contenidos que consulta.

## Origen de los datos

La extensión no aloja ni redistribuye normativa: consulta en vivo dos fuentes oficiales y devuelve enlaces a ellas.

- **Gestor Normativo** — Departamento Administrativo de la Función Pública. `https://www.funcionpublica.gov.co/eva/gestornormativo`
- **Relatoría de la Corte Constitucional** — `https://www.corteconstitucional.gov.co/relatoria`

Las normas, sentencias y conceptos son de sus entidades emisoras y son públicos por mandato de la **Ley 1712 de 2014** de transparencia y acceso a la información pública.

El único dato que se empaqueta dentro de la extensión es `datos/indice-tematico.json`: la tabla de temas y subtemas de la consulta temática del Gestor, con los títulos de las normas asociadas. Sirve para responder al instante y sin red; no incluye el texto de ninguna norma.

## Acceso automatizado

El `robots.txt` del Gestor Normativo permite el rastreo sin restricciones, y el de la Corte Constitucional permite explícitamente `/relatoria/`, que es la única ruta que se consulta. Ninguno de los dos declara `Crawl-delay`.

Aun así, la extensión se limita a una petición por segundo sostenida por dominio, con ráfagas de cinco, nunca dos peticiones simultáneas al mismo sitio, y respeta `Retry-After` cuando un portal pide calma. Son servicios públicos financiados con impuestos y conviene que un asistente automático les pese menos que una persona navegando.

## Sobre la exactitud

Ninguna de las dos fuentes publica la vigencia como un dato estructurado. La extensión traslada las marcas de «Derogado» y «Modificado por» que encuentra en el texto, pero **no puede garantizar que una norma o un artículo sigan vigentes**.

Esto no es asesoría jurídica. Verifica siempre en el enlace oficial antes de tomar una decisión.
