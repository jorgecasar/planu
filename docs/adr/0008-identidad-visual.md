# ADR 0008: Identidad visual — adopción de la paleta del blueprint

## Contexto

El prototipo original (`docs/blueprint.md`) definía:
- Color primario: **indigo #3F51B5**
- Tipografías: **Belleza** (sans-serif, headlines) + **Alegreya** (serif, body)

Esta decisión nunca se revisó ni aplicó en la reescritura con Web Awesome; la aplicación usa el tema por defecto de WA (correcto pero anónimo). La fase 2 exige **identidad visual propia** (F12) antes de construir la landing (F11), y el criterio de aceptación de T26 es: "Se decide explícitamente si se adopta la paleta del blueprint, se ajusta o se descarta, y queda escrito en un ADR. Cualquiera de las tres es válida; lo que no vale es seguir sin decidir."

## Decisión

**Se adopta la paleta del blueprint** (indigo #3F51B5 + Belleza + Alegreya) y se traduce a tokens `--wa-*` en una hoja de tema única compartida por landing y aplicación.

### Paleta de color

| Rol semántico | Valor | Token WA |
|---------------|-------|----------|
| Brand primario | `#3F51B5` | `--wa-color-brand-fill-loud` |
| Brand hover/active | `#303F9F` | `--wa-color-brand-fill-normal` |
| Brand texto sobre primario | `#FFFFFF` | `--wa-color-brand-on-loud` |
| Brand suave (fondos) | `#E8EAF6` | `--wa-color-brand-fill-quiet` |
| Brand texto sobre suave | `#1A237E` | `--wa-color-brand-on-quiet` |

Los demás roles (neutral, success, warning, danger) se mantienen del tema por defecto de WA.

### Tipografías

| Uso | Fuente | Cómo se sirve |
|-----|--------|---------------|
| Headlines / UI corta | **Belleza** (sans-serif, 400/700) | Autoalojada, subconjunto latino, `font-display: swap` |
| Body / párrafos | **Alegreya** (serif, 400/500/700) | Autoalojada, subconjunto latino, `font-display: swap` |

Se definen como:
```css
:root {
  --wa-font-family-heading: 'Belleza', system-ui, sans-serif;
  --wa-font-family-body: 'Alegreya', Georgia, serif;
}
```

### Modo claro y oscuro

- Se respeta `prefers-color-scheme` mediante `wa-light` / `wa-dark` en `<html>`
- Los tokens de brand se ajustan en modo oscuro para mantener contraste AA:
  - `--wa-color-brand-fill-loud` → `#5C6BC0` (indigo 300)
  - `--wa-color-brand-on-loud` → `#FFFFFF`
  - `--wa-color-brand-fill-quiet` → `#283593` (indigo 900)
  - `--wa-color-brand-on-quiet` → `#E8EAF6`

### Contraste verificado

Los pares se eligieron para superar **WCAG AA (4.5:1)** y la tabla está en
`src/styles/theme.css`. Ya no es sólo un cálculo: `apps/web/e2e-landing/`
ejecuta axe sobre la página **pintada** en los tres URLs (`/`, `/en/`, `/es/`)
y falla si aparece una violación, contraste incluido —sin `withTags`, para no
recortar lo que axe sabe ver—.

Corre contra `dist/`, no contra `npm run dev`: en desarrollo la landing no
existe, y un test suyo ahí habría comprobado otra página. Ver
`playwright.landing.config.ts`.

Lo primero que encontró fue una violación real: sin `<main>`, todo el contenido
quedaba fuera de landmarks (`landmark-one-main` y `region`), así que un lector
de pantalla no tenía a dónde saltar.

## Consecuencias

**Positivas:**
- Deuda de la fase 1 resuelta: la app deja de parecer "WA por defecto"
- Landing y app comparten identidad real (mismos tokens, no parecido)
- Sin CDN de terceros para fuentes: rendimiento + privacidad (alineado con F13)
- Tokens semánticos: re-theming futuro solo toca `theme.css`

**Negativas / trabajo:**
- Hay que generar subconjuntos de fuente (woff2, latino) y añadirlos a `public/fonts/`
- T27 implementa los tokens; T28/T29 usan la hoja compartida
- El modo oscuro requiere prueba visual en cada componente (ya cubierto por e2e con axe)

## Alternativas consideradas

1. **Ajustar la paleta** (ej. indigo más vivo, tipografía única Inter): descartado porque el blueprint ya fue validado en el prototipo y no hay feedback de usuario que pida cambio.
2. **Descartar y usar tema WA puro**: válido pero deja la deuda sin resolver y la landing sin marca propia.

## Verificación

Hecha:

- `npm run lint` → 0
- `npm run typecheck` → 0
- `npm test` → 0, 436 unitarios en 32 ficheros
- `npm run lint:lit` → 0 sobre 85 ficheros
- `npm run build:landing` → 0, los dos idiomas dentro del presupuesto de bytes

- `npm run test:e2e:landing` → **0**, 12 tests: axe sin violaciones en `/`,
  `/en/` y `/es/`, cero `<script>` que no sea el JSON-LD, la página se ve con
  JavaScript desactivado, y el `hreflang` apunta a URLs que responden 200.
- Cada aserción nueva se rompió a propósito para comprobar que puede fallar:
  quitar el `<main>` → axe en rojo; volver a `<wa-icon>` → 0 de 6 iconos;
  escribir sólo en `localized/` → 404 en el `hreflang`; servir la aplicación en
  la raíz → el test de la portada en rojo.

Pendiente, y de quién depende:

- **Lighthouse con rendimiento y SEO en 100.** Exige un bundle desplegado, no
  `npm run dev`; y con n = 1 este proyecto oscila entre 93 y 98, así que hace
  falta la mediana de cinco pasadas. Lo cierra T29 con `/webperf`.
- **El `og:image` no lleva las tipografías de la marca.** `sips` es lo único
  que hay aquí para rasterizar y **ignora los `@font-face`**, también
  incrustados como data URI: el texto sale con la fuente del sistema en vez de
  Belleza y Alegreya. Comprobado, no supuesto. Se regenera cuando haya un
  rasterizador que resuelva fuentes (`rsvg-convert` o Chrome headless).
- **La captura del hero.** T29 pide que sea real y aquí no hay navegador con el
  que tomarla; se dejó fuera en vez de referenciar un fichero ausente, que en
  una página sin JavaScript sería un 404 en el LCP.

## Enlaces

- Spec fase 2: `docs/spec-fase-2.md` § F12
- Tareas: T26 (decisión), T27 (implementación tokens), T28/T29 (landing usa tokens)
- Blueprint original: `docs/blueprint.md` § Style Guidelines