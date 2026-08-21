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

### Contraste: calculado, no medido todavía

Los pares se eligieron para superar **WCAG AA (4.5:1)** y la tabla está en
`src/styles/theme.css` como comentario. Pero **es un cálculo sobre los valores,
no una medida sobre la página pintada**: hoy ningún e2e visita la landing, así
que axe no ha comprobado nada aquí. Queda pendiente y se dice, en vez de
marcarlo por adelantado.

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

Pendiente, y de quién depende:

- **axe sobre la landing en los dos idiomas.** No hay ningún e2e que la visite
  (`apps/web/e2e/` no la cubre); el contraste de la tabla está calculado sobre
  los valores, no medido sobre la página. Lo cierra T29.
- **Lighthouse con rendimiento y SEO en 100.** Exige un bundle desplegado, no
  `npm run dev`; y con n = 1 este proyecto oscila entre 93 y 98, así que hace
  falta la mediana de cinco pasadas. Lo cierra T29 con `/webperf`.

## Enlaces

- Spec fase 2: `docs/spec-fase-2.md` § F12
- Tareas: T26 (decisión), T27 (implementación tokens), T28/T29 (landing usa tokens)
- Blueprint original: `docs/blueprint.md` § Style Guidelines