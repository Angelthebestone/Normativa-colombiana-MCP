## Qué cambia y por qué

<!-- Si arregla un issue, enlázalo con "Cierra #N". -->

## Cómo lo comprobaste

<!-- Qué prueba lo cubre. Si es un arreglo, la prueba debe fallar sin él. -->

## Lista de verificación

- [ ] `npm run check` en verde (typecheck, lint, pruebas de biblioteca y de extremo a extremo).
- [ ] Si arregla un fallo, hay una prueba que falla sin el arreglo, y la comprobé rompiéndola a propósito.
- [ ] No se desactiva la verificación TLS en ningún camino.
- [ ] No se sube el ritmo de peticiones a los portales.
- [ ] Un parseo que falle lanza `CanarioError`; no devuelve una lista vacía.
- [ ] Ninguna respuesta nueva afirma que una norma está vigente.
- [ ] Si cambian las herramientas o sus descripciones, `manifest.json` quedó al día.
