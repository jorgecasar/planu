# planu

Planificador de eventos: crear, listar, buscar y filtrar eventos con título,
descripción, ubicación, fechas e imagen. Los eventos son públicos de lectura y
sólo su creador puede modificarlos.

Esta es la **segunda implementación** del proyecto. La primera fue un prototipo
generado con Firebase Studio en julio de 2025 (Next.js, React y shadcn/ui),
abandonado el mismo día; se sustituyó por completo por esta reescritura con web
components. Del prototipo se conservan el concepto, el modelo de datos, las
reglas de seguridad —reescritas, ver más abajo— y el proyecto de Firebase
`planu-app`.

La especificación de producto original está en [`docs/blueprint.md`](docs/blueprint.md)
y el modelo de datos en [`docs/backend.json`](docs/backend.json). Ambos vienen
del prototipo y **no han sido revisados todavía** para esta reescritura.

## Stack

Monorepo con npm workspaces (`apps/*`, `packages/*`). Hoy sólo existe
`apps/web`.

| Capa | Elección |
| --- | --- |
| Componentes | Lit 3 (web components) |
| Librería de UI | Web Awesome 3 (`@awesome.me/webawesome`) |
| Build y dev server | Vite 7 |
| Lenguaje | TypeScript 5.9, `@tsconfig/strictest` |
| Tests unitarios | Vitest 4 en modo browser (Playwright/Chromium) |
| Tests e2e | Playwright + axe-core |
| Lint y formato | Biome 2, `lit-analyzer` |
| Backend | Firebase: Auth, Firestore, Storage |
| Despliegue | Firebase Hosting clásico, proyecto `planu-app` |

### Dos detalles de configuración que no son obvios

1. **Decoradores legacy, no estándar.** `tsconfig.json` usa
   `experimentalDecorators: true` y `useDefineForClassFields: false` porque
   esbuild —que es quien transpila TypeScript dentro de Vite— no implementa los
   decoradores estándar de TC39. Con `useDefineForClassFields: true` el bundle
   falla con `SyntaxError` al importar cualquier componente. Cambiarlo exige
   añadir `vite-plugin-babel` con `@babel/plugin-proposal-decorators`.
2. **La base de Firestore no es la `(default)`: se llama `planu`.** En
   `firebase.json` la clave `firestore` es un array con `"database": "planu"`,
   y el cliente tendrá que usar `getFirestore(app, "planu")`. Sin eso, las
   reglas se despliegan a una base que no existe y el SDK lee de otra vacía.
3. **`complexity/useLiteralKeys` está desactivada en Biome.** Choca de frente
   con `noPropertyAccessFromIndexSignature` de `@tsconfig/strictest`: una exige
   `process.env.CI` y la otra `process.env["CI"]`.

## Convenciones

### Idioma

- **Documentación, ADRs y comentarios de código: español.** Con acentos y
  diacríticos correctos, sin sustituirlos por ASCII.
- **Mensajes de commit: inglés**, siguiendo [Conventional Commits](https://www.conventionalcommits.org):
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. Lo valida commitlint.
- Los identificadores de código van en inglés.

### Dónde va cada cosa

| Qué | Dónde |
| --- | --- |
| Aplicación web | `apps/web/src/` |
| Tests unitarios | junto al fuente, `*.test.ts` |
| Tests e2e | `apps/web/e2e/` |
| Paquetes compartidos | `packages/` (vacío por ahora) |
| Documentación general | `docs/` |
| Decisiones arquitectónicas | `docs/adr/` |
| Plan de trabajo vigente | `tasks/plan.md` |
| Lista de tareas | `tasks/todo.md` |
| Reglas de seguridad | `firestore.rules`, `storage.rules` (raíz) |

Los ADRs se numeran (`0001-titulo-en-kebab-case.md`) y no se reescriben una vez
aceptados: si una decisión cambia, se añade un ADR nuevo que la supersede.

## Comandos

```bash
npm run setup       # instala dependencias y restaura las skills del agente
npm run dev         # servidor de desarrollo en http://localhost:3000
npm run build       # typecheck + build de producción a apps/web/dist
npm test            # tests unitarios (Vitest en Chromium real)
npm run test:e2e    # tests e2e con Playwright y axe
npm run lint        # Biome: formato y lint
npm run lint:fix    # Biome con autoarreglo
npm run lint:lit    # lit-analyzer sobre las plantillas
npm run typecheck   # tsc --noEmit
npm run emulators   # emuladores de Firebase (auth, firestore, storage)
```

`npm test` y `npm run test:e2e` necesitan el navegador de Playwright:
`npx playwright install chromium`.

`npm run emulators` necesita **Java en el PATH**. Homebrew instala `openjdk`
como *keg-only*, así que no basta con `brew install openjdk`; hay que añadirlo:

```bash
export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"   # en ~/.zshrc
```

Los puertos no son los de por defecto: Firestore usa el **8181** y Hosting el
**5050**, porque en macOS el 5000 lo ocupa el receptor AirPlay del sistema y el
8080 suele estar cogido. Están en `firebase.json` y replicados en
`src/firebase/config.ts`; si cambias uno, cambia el otro.

Las variables de entorno viven en `.env.local` **en la raíz del monorepo**, no
en `apps/web`. Por eso `vite.config.ts` fija `envDir`: sin ello Vite las busca
junto a sí mismo y la aplicación arranca con `auth/invalid-api-key`.

## Soporte de navegador

Por defecto, **Baseline widely available** sin fallback. Todo lo que no lo sea
va detrás de detección de disponibilidad y degrada a una ruta que sí funcione
en cualquier navegador moderno.

Hoy la única excepción es la IA integrada, y la resuelve el SDK: Firebase AI
Logic en modo `PREFER_ON_DEVICE` usa Gemini Nano si existe y Gemini en la nube
si no. Sin ninguno de los dos, el aviso remite al alta manual.

## Estado de seguridad

`firestore.rules` se reescribió al portarlo. El original de planu tenía dos
fallos que **no deben reintroducirse**:

- Las reglas de Firestore se combinan con **OR**. Separar la validación de
  campos en su propio `allow create, update` anulaba el control de propiedad en
  lugar de sumarse a él: cualquiera, sin autenticar, podía modificar cualquier
  evento. Regla vigente: **un único `allow` por operación**.
- El control de propiedad comparaba contra `resource.data.userId`, un campo que
  el modelo de datos no definía. `userId` es ahora obligatorio y se fija al uid
  de quien crea.

Queda pendiente en `storage.rules`: cualquier usuario autenticado puede
sobrescribir la imagen de otro, porque la ruta `event-images/{imageId}` no
incluye el uid. Requiere decidir convención de nombres.

## Toolchain de agente

Este repo trae configuración de agente versionada. Si acabas de clonar, ejecuta
`npm run setup` antes que nada.

### Skills

Se declaran en `skills-lock.json` (versionado); sus cuerpos **no** se versionan.
`npm run setup` los restaura en `.agents/skills/` y los enlaza con symlinks
relativos en `.claude/skills/`. Son 40, de cuatro orígenes:

- `addyosmani/agent-skills` — 24 skills del ciclo de desarrollo.
- `firebase/skills` — 12 skills de Firebase.
- `anthropics/skills` — `frontend-design`.
- `GoogleChrome/modern-web-guidance` — `modern-web-guidance`.
- **Web Awesome** — `webawesome` y `webawesome-design`, que viajan dentro del
  propio paquete npm (`sourceType: local` en el lock, apuntando a
  `node_modules/@awesome.me/webawesome/dist/skills/`). Por eso `setup` ejecuta
  `npm install` **antes** que `setup-skills.mjs`: sin `node_modules` no hay nada
  que enlazar. `npm update` las mantiene al día solas.

Para añadir una skill de GitHub:

```bash
npx -y skills add <owner>/<repo> --skill <nombre> --agent claude-code -y
```

Instalamos sólo para `claude-code`. Si algún día se usa otro agente, se repite
el mismo `skills add` añadiéndolo a `--agent`: el lock no cambia.

### Servidores MCP

- **serena** — navegación de código por LSP (`typescript`). Config en
  `.serena/project.yml`; reindexa con `serena project index`.
- **chrome-devtools** — DOM, consola, red y rendimiento reales. Es lo que hace
  utilizable la skill `browser-testing-with-devtools`.

Están registrados con scope local, fuera del repo: un clon nuevo debe volver a
registrarlos (ver `CLAUDE.md`).

### Búsqueda semántica (qmd)

**No está montada.** `docs/` sólo tiene los dos ficheros heredados de planu, que
no son corpus suficiente. Merece la pena montarla cuando haya ADRs y
especificaciones; `scripts/setup-skills.mjs` ya contempla el reindexado si
aparece `.qmd/index.yml`.

## Cómo trabajar aquí

1. **Antes de escribir código**, comprueba si aplica alguna skill. Para UI, las
   de Web Awesome son la referencia de componentes y de diseño.
2. **Trabaja en incrementos verificables.** El plan vive en `tasks/plan.md`.
3. **Las decisiones se documentan** en `docs/adr/`.
4. **No toques `.agents/skills/` ni `.claude/skills/` a mano**: son contenido de
   terceros y se regeneran. Lo que manda es `skills-lock.json`.
5. **La accesibilidad no es opcional**: el e2e falla si axe detecta violaciones.

## Decisiones pendientes

- Revisar `docs/blueprint.md` para la reescritura: sigue describiendo la app de
  planu, con guías de estilo (indigo #3F51B5, tipografías Belleza y Alegreya)
  que hay que traducir a tokens de Web Awesome o descartar.
- El generador de eventos con IA (Genkit sobre Next en planu) está **aplazado**.
  Al retomarlo hay que elegir entre Cloud Functions con Genkit o `@google/genai`
  directamente, y escribir el ADR correspondiente.
- Convención de nombres para las imágenes en Storage (ver arriba).
