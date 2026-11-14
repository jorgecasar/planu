# ADR 0016: Una sola cara por familia tipográfica

## Contexto

El [ADR 0008](0008-identidad-visual.md) fijó «Belleza 400/700» y «Alegreya
400/500/700». Medido en el servidor de la landing, esa declaración servía
ficheros repetidos:

- `belleza-latin-400.woff2` y `belleza-latin-700.woff2` son idénticos byte a
  byte (SHA-1 igual, 15,7 KiB) y sin tabla `fvar`: Belleza sólo existe en un
  peso, así que el 700 era el 400 con otro nombre.
- Los tres `alegreya-latin-*.woff2` también son idénticos (109 KiB) y llevan
  tabla `fvar`: es una fuente variable declarada tres veces.

El navegador descarga una URL por cada `@font-face` que se usa. La landing
bajaba `belleza-latin-700` más dos copias de Alegreya (400 y 500).

## Decisión

1. Belleza se declara una vez, a 400. El tema `wa-theme-planu` fija
   `--wa-font-weight-heading: 400` y los encabezados (`h1`–`h3` y el título de
   `wa-dialog`) usan ese token. Sin esto, pedir 600 o 700 a una cara de 400
   hace que Chrome sintetice una falsa negrita.
2. Alegreya se declara una vez, con `font-weight: 400 700`, sobre su fuente
   variable.
3. Se borra `belleza-latin-700.woff2`. Los dos Alegreya sobrantes quedan sin
   referencia y se retirarán aparte.

Esto sustituye el «400/700» y el «400/500/700» de la tabla de tipografías del
ADR 0008. El resto de ese ADR sigue vigente.

## Consecuencias

- La landing y la aplicación descargan Belleza una vez y Alegreya una vez.
- Los encabezados pasan de pesos 500–700 a 400. Es un cambio visual
  deliberado: Belleza no tiene negrita, y lo que se veía en negrita era la
  misma cara.
- Cualquier encabezado nuevo debe usar `--wa-font-weight-heading`; fijar otro
  peso en un elemento con Belleza reintroduce la falsa negrita.
- Los tests comprueban una sola cara por familia, el peso computado de cada
  encabezado y, en la landing, los `.woff2` realmente pedidos.
