# Tareas — port de planu

Derivadas de [`plan.md`](plan.md). Orden por dependencia, no por importancia.

## Fase 1 — Capa de Firebase y reglas

- [x] **T0 · Corregir las reglas de seguridad**
  - Acepta: `events` sólo legible por su propietario; una única regla `allow` por
    operación; Storage en `events/{userId}/{fileName}` con `uid == userId`, tope
    de 5 MB y `contentType` de imagen.
  - Verifica: `firebase deploy --only firestore:rules --project planu-app --dry-run`
  - Ficheros: `firestore.rules`, `storage.rules`

- [x] **T1 · Configuración y contextos**
  - Acepta: config desde `import.meta.env` con tipos; `DATABASE_ID = "planu"`;
    contextos de auth, firestore, storage y usuario, con el usuario en tres
    estados (comprobando, sin sesión, autenticado).
  - Verifica: `npm run typecheck`
  - Ficheros: `src/vite-env.d.ts`, `src/firebase/config.ts`, `src/firebase/context.ts`

- [x] **T2 · Provider e inicialización**
  - Acepta: `<planu-firebase-provider>` inicializa la app, usa
    `getFirestore(app, "planu")`, conecta emuladores en `DEV` y publica los
    contextos; `onAuthStateChanged` actualiza el usuario.
  - Verifica: unitario que monta el provider y comprueba que los contextos llegan
  - Ficheros: `src/firebase/firebase-provider.ts`, `.env.example`, `.gitignore`

- [x] **T3 · Controllers de Firestore y Storage**
  - Acepta: `CollectionController` y `DocController` sobre `onSnapshot`, con
    desuscripción en `hostDisconnected` y sin resuscribirse si la consulta no
    cambia; `uploadFile` reporta progreso.
  - Verifica: unitarios contra el emulador de Firestore, incluido el caso de
    desmontaje sin fugas
  - Ficheros: `src/firebase/collection-controller.ts`, `doc-controller.ts`, `storage.ts`

## Fase 2 — Autenticación

- [x] **T4 · Acceso y registro**
  - Acepta: pestañas de entrar y registrarse con email y contraseña (mínimo 6
    caracteres, confirmación que debe coincidir) y acceso con Google; errores de
    Firebase mostrados al usuario, no sólo en consola.
  - Verifica: unitarios de validación; e2e de registro contra el emulador
  - Ficheros: `src/auth/login-view.ts`

- [x] **T5 · Guarda de ruta, perfil y cabecera**
  - Acepta: sin sesión, toda ruta privada redirige a `/login` sin parpadeo
    mientras se comprueba; cabecera con avatar, acceso a perfil y cierre de sesión.
  - Verifica: e2e que entra a `/` sin sesión y acaba en `/login`
  - Ficheros: `src/app-shell.ts`, `src/profile/profile-view.ts`

## Fase 3 — Listado y filtros

- [x] **T6 · Listado de eventos**
  - Acepta: consulta filtrada por `userId`; tarjetas con imagen, título,
    descripción, ubicación y fechas; esqueletos durante la carga; estado vacío
    que distingue "sin eventos" de "sin resultados"; borrado con confirmación.
  - Verifica: e2e con datos sembrados en el emulador
  - Ficheros: `src/events/events-view.ts`, `src/events/event-card.ts`

- [x] **T7 · Búsqueda y filtro por fechas**
  - Acepta: `filterEvents` como función pura; búsqueda por título o descripción
    sin distinguir mayúsculas; rango de fechas con la semántica del prototipo
    para eventos sin fechas, con sólo inicio o con sólo fin.
  - Verifica: unitarios que cubren las seis combinaciones de fechas
  - Ficheros: `src/events/filter-events.ts`, `src/events/event-filters.ts`

## Fase 4 — Editor y generación con IA

- [x] **T8 · Editor de eventos**
  - Acepta: diálogo de alta y edición con validación por `EventSchema`; subida de
    imagen con barra de progreso y posibilidad de quitarla; `userId` fijado en el
    cliente al `uid` de la sesión.
  - Verifica: e2e de alta con imagen y de edición
  - Ficheros: `src/events/event-editor.ts`

- [x] **T9 · Generación desde imagen**
  - Acepta: `InferenceMode.PREFER_ON_DEVICE`, con `responseSchema` equivalente al
    `GenerateEventOutputSchema` del prototipo; el resultado prerrellena el editor
    y el usuario confirma antes de guardar; fallo de IA no rompe el alta manual.
  - Verifica: unitarios con el modelo simulado (éxito, error, no disponible)
  - Ficheros: `src/events/ai-event-generator.ts`

- [x] **T10 · Documentación**
  - Acepta: ADR 0001 stack, 0002 visibilidad privada con la fuga que corrige,
    0003 IA híbrida; `AGENTS.md` al día; nota en `docs/blueprint.md` de que el
    listado público queda superado.
  - Verifica: revisión de enlaces y coherencia con `SPEC.md`
  - Ficheros: `docs/adr/*.md`, `AGENTS.md`, `docs/blueprint.md`
