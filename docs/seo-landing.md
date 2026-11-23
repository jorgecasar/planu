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
2. **`og:locale` y `og:locale:alternate`** no existen; en `/es/` el idioma
   sólo se deduce de `lang`.
3. **`og:image:alt`** y dimensiones de la imagen (`og:image:width/height`).
4. **`meta name="robots"`** explícito. No es necesario hoy (el valor por
   defecto es indexar), pero conviene en la aplicación bajo `/app`, donde
   `robots.txt` sólo evita el rastreo, no la indexación de una URL enlazada.
   Eso exigiría cabecera `X-Robots-Tag` en `firebase.json`, que ningún agente
   toca: queda para una decisión humana.
5. **Datos estructurados más ricos**: `Organization`/`WebSite` y
   `inLanguage` en el JSON-LD.
6. **`theme-color`** y manifiesto web, útiles para móvil.

## Qué sobra o está mal

1. **`og:url` fijo a `/`** en todos los idiomas: en `/es/` declara la URL
   inglesa. Debería ser la misma URL que el canonical de cada página.
2. **URL duplicada `/` y `/en/`** con el mismo contenido. Es deliberado
   (`x-default` en la raíz), y el canonical autorreferenciado es coherente
   con eso, pero si se quiere un único destino habría que decidir si la raíz
   redirige a `/en/` (eso vive en `firebase.json`; no se toca aquí).
3. **Origen repetido a mano** en `og:url`, `og:image` y los tres `hreflang`
   de `landing.ts`: deberían usar `SITE_ORIGIN`. Se deja para una tarjeta
   siguiente para no mezclar cambios.
4. **Comentario del sitemap** y `robots.txt` en español dentro de ficheros
   públicos: inocuo, pero se sirve tal cual.

## Propuesta de tarjetas siguientes

- SEO 2: metadatos de las páginas legales y entrada en el sitemap.
- SEO 3: `og:url` por página, `og:locale`, `og:image:alt`, usar
  `SITE_ORIGIN` en todas las URL absolutas.
- Decisión humana: `X-Robots-Tag` para `/app` y destino único de `/`
  (requieren `firebase.json`).
