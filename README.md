# planu

Planificador de eventos personales. Creas eventos con título, descripción,
ubicación, fechas e imagen; los buscas por texto y los acotas por rango de
fechas. **Tus eventos son privados: nadie más los ve.**

Como atajo puedes subir la foto de un cartel y dejar que la IA extraiga los
campos. Lo que devuelva no se guarda solo: prerrellena el formulario y tú
confirmas.

## Empezar

Necesitas **Node 20 o superior** y, para los emuladores, **Java 11 o superior**.

```bash
npm run setup                  # dependencias + skills del agente
cp .env.example .env.local     # y rellena los valores
```

Los valores de Firebase se obtienen con:

```bash
firebase apps:sdkconfig WEB 1:854295039681:web:1181b841906dba24160e40 \
  --project planu-app
```

No son secretos —viajan en el bundle del cliente— pero no se versionan para que
cada entorno apunte a su propio proyecto.

Después, en dos terminales:

```bash
npm run emulators   # Firebase local: auth, firestore, storage
npm run dev         # http://localhost:3000
```

En desarrollo la aplicación habla siempre con los emuladores, nunca con datos
reales.

> Homebrew instala `openjdk` como *keg-only*, así que `brew install openjdk` no
> basta: añade `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"` a tu shell.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Comprueba tipos y compila a `apps/web/dist` |
| `npm test` | Unitarios en Chromium real |
| `npm run test:rules` | Reglas de seguridad contra el emulador |
| `npm run test:e2e` | End to end con Playwright y axe |
| `npm run lint` · `lint:lit` | Biome y `lit-analyzer` |
| `npm run localize:extract` · `localize:build` | Traducciones |

Los tests con navegador necesitan `npx playwright install chromium`.

## Cómo está montado

Monorepo con npm workspaces; hoy sólo existe `apps/web`.

- **Lit 3** y **Web Awesome 3** para la interfaz, **Vite 7** para el build.
- **Firebase** como único backend: Auth, Firestore y Storage. Sin servidor
  propio, así que **las reglas de seguridad son la única frontera real** — de
  ahí que tengan sus propios tests.
- **Firebase AI Logic** en modo híbrido para la generación desde imagen: usa la
  IA integrada del navegador si existe y la nube si no. La nube está **cerrada
  por defecto** porque factura por token.
- Interfaz traducible con `@lit/localize`. El idioma sale del navegador y cae a
  inglés si no lo servimos.

La base de Firestore **no** es la `(default)`: se llama `planu`.

## Documentación

- [`SPEC.md`](SPEC.md) — qué se construye, con qué criterios de éxito y qué
  fronteras no se cruzan sin preguntar.
- [`AGENTS.md`](AGENTS.md) — convenciones de trabajo, para personas y agentes.
- [`docs/adr/`](docs/adr/) — por qué se decidió cada cosa importante.
- [`tasks/`](tasks/) — plan vigente y lista de tareas.

## Despliegue

```bash
firebase deploy --only hosting          # compila antes, vía predeploy
firebase deploy --only firestore:rules,storage
```

## Lo que todavía no está

Con honestidad, porque afecta a quien lo use:

- **App Check sin configurar.** Es requisito antes de abrir la IA en la nube.
- **Sin recuperación de contraseña.** Quien olvide la suya se queda fuera.
- **Sin observabilidad.** Un error en producción hoy no se registra en ningún
  sitio.
- **El acceso con Google no se ha probado** de punta a punta.
- Las imágenes se sirven con una URL que lleva un token: quien la tenga accede
  sin sesión. El texto del evento sí lo protegen las reglas.
