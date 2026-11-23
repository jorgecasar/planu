# Revisión SEO de la landing

Estado a 23 de noviembre de 2026, sobre el HTML que genera
`npm run build:landing` (`dist/`). Alcance: SEO técnico, sin tocar el diseño
(la identidad de marca está pendiente de decisión). Tarjeta HU-423, issue #423.

## Qué se ha hecho en esta tarjeta

- Cada página prerrenderizada (landing y legales, en `/`, `/en/` y `/es/`)
  lleva un único `<link rel="canonical">` absoluto que apunta a su propia URL.
- El origen sale de `SITE_ORIGIN` en `apps/web/src/ui/landing/landing.ts`, la
  misma constante que ya usa el JSON-LD. El build
  (`scripts/build-landing.js`) lo escribe en el marcador
  `<!--CANONICAL_PLACEHOLDER-->` al escribir cada fichero de destino, de modo
  que `/` y `/en/` (mismo contenido, dos URL) se autorreferencian cada una,
  igual que ya lo hacen en el par `hreflang` y en el sitemap.
- Los e2e de `apps/web/e2e-landing/landing.spec.ts` fallan si falta, si hay
  más de uno, si es relativo o si apunta a otra página.

## Qué se ha hecho en HU-424 (issue #424)

- Open Graph y Twitter card por página e idioma de la landing (`/`, `/en/`,
  `/es/`): `og:url` igual al canonical de cada página, `og:locale` del idioma
  y `og:locale:alternate` de los demás, `og:site_name`, `og:image` absoluta
  con `og:image:width`/`height` (1200 x 630) y `og:image:alt` traducido, y
  `twitter:title`, `twitter:description`, `twitter:image` y
  `twitter:image:alt`.
- Todas las URL absolutas de `landing.ts` (imagen y `hreflang`) y de
  `build-landing.js` salen de `SITE_ORIGIN`; ya no queda el origen escrito a
  mano. El marcador `<!--CANONICAL_PLACEHOLDER-->` sigue igual: el build
  rellena `og:url` y `og:locale` en el mismo punto, al escribir cada destino.
- Las páginas legales siguen `noindex` y no llevan Open Graph ni Twitter: no
  se quieren compartir ni indexar, así que no tiene sentido anunciarlas.
- No se regeneró `og.png` (HU-425) ni se tocó el JSON-LD (HU-426).
- Los e2e de `landing.spec.ts` fallan si falta alguna etiqueta, si hay más de
  una, o si URL, idioma o imagen no corresponden a la página.

## Qué se ha hecho en HU-426 (issue #426)

- El JSON-LD de cada página de la landing es un único `<script
  type="application/ld+json">` con un `@graph` de dos entidades:
  `SoftwareApplication` y `WebSite`. Ambas llevan `name`, `url` e `inLanguage`.
- `inLanguage` es el idioma de la página (`en` o `es`), no uno fijo. Antes
  faltaba y el JSON-LD de `/es/` no decía que estaba en español.
- `url` es la de la propia página (`/`, `/en/` o `/es/`), absoluta y
  construida con `SITE_ORIGIN`. Antes todas apuntaban a la raíz. Como `/` y
  `/en/` comparten idioma, `jsonLd(locale)` deja un marcador que
  `scripts/build-landing.js` sustituye al escribir cada fichero, igual que el
  canonical y `og:url`.
- `SoftwareApplication` lleva `image` absoluta (la misma imagen que
  `og:image`). Sigue sin `offers` ni precio.
- Un e2e por campo y por página en `landing.spec.ts` (`@context`,
  `inLanguage`, `url`, `image`, `name`). Comprobado a propósito: con esos
  campos rotos en `dist/es/index.html` los cuatro tests fallan.
- Sin JavaScript: sigue siendo el único `<script>` de la página.

## Qué hay y está bien

| Elemento | Estado |
| --- | --- |
| `<title>` y `meta description` por idioma | Presentes, traducidos |
| `lang` del `<html>` por idioma | Presente |
| `hreflang` es / en / x-default | Presente en la landing, absolutas |
| `robots.txt` | Presente; bloquea `/app` y apunta al sitemap |
| `sitemap.xml` con alternativas por idioma | Presente, tres URL |
| JSON-LD `SoftwareApplication` | Presente, sin precio |
| Open Graph básico y `twitter:card` | Presente en la landing |
| Un único `<h1>` | Presente |
| Sin JavaScript | Cumple; el único `<script>` es el JSON-LD |

## Qué falta

1. **Páginas legales sin metadatos.** `privacy.html` y `terms.html` no tienen
   `meta description`, ni `hreflang`, ni Open Graph. Tampoco están en el
   sitemap.
2. ~~`og:locale` y `og:locale:alternate`~~ — resuelto en HU-424.
3. ~~`og:image:alt` y dimensiones de la imagen~~ — resuelto en HU-424.
4. **`meta name="robots"`** explícito. No es necesario hoy (el valor por
   defecto es indexar), pero conviene en la aplicación bajo `/app`, donde
   `robots.txt` sólo evita el rastreo, no la indexación de una URL enlazada.
   Eso exigiría cabecera `X-Robots-Tag` en `firebase.json`, que ningún agente
   toca: queda para una decisión humana.
5. ~~Datos estructurados más ricos: `WebSite` e `inLanguage` en el
   JSON-LD~~ — resuelto en HU-426. `Organization` queda sin hacer.
6. **`theme-color`** y manifiesto web, útiles para móvil.

## Qué sobra o está mal

1. ~~`og:url` fijo a `/`~~ — resuelto en HU-424: es la URL de cada página.
2. **URL duplicada `/` y `/en/`** con el mismo contenido. Es deliberado
   (`x-default` en la raíz), y el canonical autorreferenciado es coherente
   con eso, pero si se quiere un único destino habría que decidir si la raíz
   redirige a `/en/` (eso vive en `firebase.json`; no se toca aquí).
3. ~~Origen repetido a mano~~ — resuelto en HU-424: todo usa `SITE_ORIGIN`.
4. **Comentario del sitemap** y `robots.txt` en español dentro de ficheros
   públicos: inocuo, pero se sirve tal cual.

## Propuesta de tarjetas siguientes

- SEO 2: metadatos de las páginas legales y entrada en el sitemap.
- SEO 3: `og:url` por página, `og:locale`, `og:image:alt`, usar
  `SITE_ORIGIN` en todas las URL absolutas.
- Decisión humana: `X-Robots-Tag` para `/app` y destino único de `/`
  (requieren `firebase.json`).
