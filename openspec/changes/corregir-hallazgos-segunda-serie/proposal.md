## Why

La segunda serie de pruebas (2026-09-30, unas 160 llamadas a las 28 tools, servidor 1.14.0) encontró 9 fallos confirmados y varios menores. Se contrastaron uno a uno con el código de la 1.15.0 (`origin/main`): **dos ya estaban corregidos y se descartan** (`entero`/`ruta_destino` en `obtener_documento`, y el «undefined» de `explicar_relacion_tema`); el resto sigue vigente. Casi todos son falsos vacíos o etiquetas engañosas, justo el error que en una herramienta jurídica se lee como «no existe» o «no fue reformado».

## What Changes

Quince correcciones mínimas, cada una en el sitio donde nace el defecto, sin capas nuevas:

- `historial_norma`: el filtro `articulo` deja de comparar contra el artículo de la norma *modificadora* y usa el texto del artículo pedido (el criterio que `obtener_documento historial=true` y `comparar_articulos` ya usan). Hoy `Ley 909, articulo=31` dice «ninguno» aunque el artículo lleva «Modificado por el Art. 6 de la Ley 1960 de 2019».
- `historial()`: la prosa de una ley modificatoria («modificado por la Ley 2101 de 2021, el cual quedará así:») deja de contarse como reforma de esa ley (`analizar_conflicto` decía que la Ley 2466/2025 fue «modificada por la Ley 2101 de 2021»). `analizar_conflicto` rotula esas notas como de cualquier artículo, no de la norma entera.
- `obtener_documento` (gestor + `articulo`): el artículo pasa por `trocear`, así que respeta `limite_caracteres` y `desde`; las advertencias de vigencia se calculan sobre el artículo completo.
- `resolver_cita`: la Constitución Política se cita por su nombre («art. 53 de la Constitución Política») como ya se citan los códigos.
- `consultar_por_jerarquia`: `nivel=constitucion` deja de buscar entre las Resoluciones (`tipoANivel('constitucion')` cae en `'resolucion'`) y el aviso falso «el Gestor no cataloga la Constitución» desaparece; `nivel=concepto` (y el resto) reciben el mismo refuerzo por subtema que ya tiene `buscar_normas`, extraído a una función compartida.
- `buscar_jurisprudencia_consejo_estado`: una frase exacta sin resultados deja de disparar el error «el portal cambió su estructura, actualiza la extensión»; ahora es «cero resultados» y sigue a la ampliación a OR ya documentada.
- `consultar_perfil ambiental`: recorre la primera página de las 7 secciones de Eureka (hoy solo «leyes») y su advertencia dice qué revisó. Los perfiles de contratación y de energía dejan de rotularse con fuentes que no consultan.
- Fechas: en Consejo de Estado el campo es la fecha del *proceso*; en la Suprema, la de *registro* en el índice. Ninguna es la de la providencia y así se rotulan.
- Sectorial: SIC excluye por etiqueta compuesta («Resoluciones, Nombramientos») y por epígrafe («Proyecto de Resolución»); el aviso de «portal roto» decodifica el nombre del archivo (`%201227` se leía como 201227) y compara contra la celda «Norma», no contra el epígrafe (que cita el decreto modificado, 1072); ANH no imprime el «None» del portal.
- Menores: `buscar_diario_oficial` recorta a `limite`; `buscar_en_suin` descarta lo que no contiene todos los términos de la variante que sustituyó a la búsqueda (hoy «teletrabajo» → «trabajo remoto» devuelve 15 documentos que casan solo con «trabajo»); `cargar()` quita los iconos `material-symbols-outlined` que se colaban en el texto de CREG, INVIMA y Supersalud; las descripciones de `listar_catalogos`, INVIMA y Supersalud dejan de afirmar lo que ya no es cierto.

**Cambio de comportamiento (no de API):** `obtener_documento` con `articulo` deja de devolver artículos de hasta 20.000 caracteres enteros y respeta el tope (8.000 por defecto), con el «trozo siguiente» ya disponible en `reanudar()`. Es lo que el spec vigente ya exigía.

## Capabilities

### New Capabilities
- `herramientas/cita-constitucion`: la Constitución Política se resuelve por su nombre en `resolver_cita`.
- `busqueda/consulta-por-jerarquia`: el nivel se traduce al tipo correcto del Gestor y comparte el refuerzo por subtema de `buscar_normas`.
- `busqueda/perfiles-alcance`: cada perfil barre lo que dice y declara solo las fuentes que consulta.
- `busqueda/fechas-de-providencias`: la fecha mostrada se rotula por lo que es, no como la de la providencia.
- `sectorial/limpieza-de-filas`: SIC excluye lo que dice excluir; ANH no imprime valores vacíos del portal.
- `herramientas/contrato-de-respuesta`: `limite` se respeta en el diario oficial, la sustitución de términos en SUIN conserva la pertinencia, y las descripciones no afirman lo falso.

### Modified Capabilities
- `historial/historial-norma`: qué significa «artículo» en el filtro y en cada cambio; la prosa modificatoria no es una nota.
- `herramientas/obtener-documento`: el modo `articulo` respeta el troceado; el texto de páginas HTML no arrastra iconos.
- `busqueda/frase-exacta-consejo-estado`: cero resultados no es un cambio de marcado.
- `sectorial/portal-roto`: el nombre del archivo se decodifica y se compara con el número propio del acto.

## Impact

- **Código** (todo bajo `src/`): `herramientas/historial_norma.ts`, `nucleo/parse.ts` (`historial`, `cargar`), `herramientas/obtener_documento.ts`, `herramientas/analizar_conflicto.ts`, `nucleo/citas.ts` (y `herramientas/resolver_cita.ts` si la vigencia de SUIN sale mal rotulada), `herramientas/consultar_jerarquia.ts`, `nucleo/jerarquia.ts`, `herramientas/buscar_normas.ts`, `fuentes/gestor.ts`, `fuentes/jurisprudencia/consejoestado.ts`, `herramientas/buscar_jurisprudencia_consejo_estado.ts`, `herramientas/buscar_jurisprudencia_suprema.ts`, `nucleo/perfiles.ts`, `fuentes/sectorial/sic.ts`, `fuentes/sectorial/mintrabajo.ts`, `nucleo/portal-roto.ts`, `fuentes/anh.ts`, `fuentes/diario_oficial.ts`, `herramientas/buscar_en_suin.ts`, `herramientas/listar_catalogos.ts`, `fuentes/sectorial/invima.ts`, `fuentes/sectorial/supersalud.ts`, más los tests de cada zona.
- **Dependencias:** ninguna. **API pública:** sin parámetros nuevos ni retirados.
- **Fuera de alcance, con motivo** (detalle en `design.md`): `entero`/`ruta_destino` y el «undefined» (ya corregidos en 1.15.0); ordenación inestable de UPME (empates de fecha del portal, sin verificar); Superfinanciera «degradada» (externo, sin medir); filtro `SU` (no concluyente); `expediente` (configuración, `EXPEDIENTES=1`); `conOrigen` (`URL:` por párrafo, decisión deliberada); texto sin tildes de la Constitución (viene así del Gestor); el número de la Res. 232 de ANH (dato del portal).
- **No incluye** subir versión ni publicar en npm.
