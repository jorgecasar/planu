# Spec: planu

## Objetivo

Planificador de eventos. Cada usuario crea, consulta, busca, filtra, ordena,
edita y borra sus eventos, con título, descripción, ubicación, fechas de
inicio y fin —con o sin hora—, etiquetas e imagen de portada. Los eventos son
**privados por defecto**: sólo los ve quien los crea, salvo que su dueño
invite a alguien más por email, como lector o como editor. Ver
[ADR 0006](docs/adr/0006-sharing-with-invited-members.md).

Un evento se puede consultar en tres formas —rejilla de tarjetas, calendario
mensual y agenda cronológica— y exportarse a `.ics` o a Google Calendar para
que viva junto al resto del calendario del usuario.

Como atajo, el usuario puede subir la foto de un cartel o pegar un texto
suelto —un email de convocatoria, un mensaje— y dejar que la IA extraiga los
campos del evento, que luego revisa y confirma antes de guardar. La IA
también puede sugerir etiquetas a partir del título y la descripción.

La aplicación vive bajo `/app`; la raíz (`/`) es una landing pública
prerrenderizada, sin JavaScript propio, que explica qué es planu antes de
pedir sesión. Ver «Fases siguientes» al final de este documento.

**Usuario objetivo:** producto público en potencia, no herramienta interna. Eso
fija tres exigencias que no serían negociables en un proyecto personal:
accesibilidad verificada de forma automática, textos preparados para traducirse,
y control del coste de la IA en la nube.

**Éxito** = un usuario nuevo llega a la landing, se registra, crea su primer
evento con imagen, lo encuentra buscando por texto, filtrando por fechas o por
etiqueta, lo comparte con alguien más si quiere, lo edita y lo borra, sin que
ninguna de esas rutas dependa de tener Chrome ni hardware potente.

### Origen

Reescritura completa del prototipo generado con Firebase Studio en julio de 2025
(Next.js, React, shadcn/ui, Genkit). Se conserva el concepto, el modelo de datos
y el proyecto de Firebase; se descarta todo el código de interfaz.

## Stack

| Capa | Elección |
| --- | --- |
| Componentes | Lit 3.3 |
| Librería de UI | Web Awesome 3.11 |
| Build | Vite 7 |
| Lenguaje | TypeScript 5.9 con `@tsconfig/strictest` |
| Enrutado | `@lit-labs/router` 0.1 |
| Estado compartido | `@lit/context` |
| Validación | Zod 4 |
| Backend | Firebase 12: Auth, Firestore, Storage |
| IA | Firebase AI Logic híbrido (`firebase/ai`) |
| Analítica | Firebase Analytics (GA4), tras su puerto propio |
| Observabilidad | Sentry: errores y rendimiento real de usuario |
| Landing | `@lit-labs/ssr`, sólo como dependencia de build; 0 KB en el navegador |
| Tests unitarios | Vitest 4 en navegador real (Playwright/Chromium) |
| Tests e2e | Playwright + axe-core |
| Calidad | Biome 2, `lit-analyzer` |
| Despliegue | Firebase Hosting clásico, proyecto `planu-app` |

**Firestore:** la base **no** es la `(default)`, se llama `planu`. Siempre
`getFirestore(app, "planu")`.

**Decoradores:** legacy (`experimentalDecorators: true`,
`useDefineForClassFields: false`). esbuild no implementa los estándar y el bundle
rompe con `SyntaxError`.

## Comandos

```bash
npm run setup             # instala dependencias y restaura las skills del agente
npm run dev                # servidor de desarrollo en http://localhost:3000
npm run build               # tsc --noEmit && vite build → apps/web/dist
npm run build:landing       # landing prerrenderizada + app, a dist/ (lo que se publica)
npm test                    # Vitest en Chromium real
npm run test:e2e            # Playwright + axe, contra npm run dev
npm run test:e2e:landing    # e2e de la landing, contra dist/ (exige build:landing)
npm run test:rules          # reglas de Firestore, contra el emulador
npm run test:arch           # frontera de Firebase (biome.json), sin emuladores
npm run lint                # Biome
npm run lint:lit            # lit-analyzer sobre las plantillas
npm run typecheck           # tsc --noEmit
npm run emulators           # emuladores: auth 9099, firestore 8181, storage 9199, hosting 5050
```

`npm test`, `npm run test:e2e` y `npm run test:e2e:landing` requieren
`npx playwright install chromium`.

## Estructura

La migración a arquitectura hexagonal está en marcha —ver
[`docs/spec-arquitectura-hexagonal.md`](docs/spec-arquitectura-hexagonal.md)—,
así que conviven dos organizaciones: por capa donde ya se migró, por
funcionalidad donde no.

```
apps/web/
  app.html                  Única entrada de Vite; la SPA vive bajo /app
  src/
    main.ts                 Punto de entrada: idioma, tema y arranque
    app-shell.ts            Router, cabecera y guarda de sesión
    domain/                 Modelo (Zod) y reglas puras: filter-events,
                             sort-events, tags, format-dates, build-ics,
                             google-calendar-url, ai-policy, pick-locale…
    application/            Casos de uso y sus puertos: ports/session,
                             event-repository, image-store, account-data,
                             analytics; sign-in, sign-up, delete-account…
    infrastructure/firebase/  Adaptadores. El único sitio pensado para
                             `firebase/*`: session-adapter, event-repository,
                             image-store, analytics-adapter,
                             account-data-adapter
    firebase/               config, contextos, provider — en migración; aún
                             concentra usos de Firebase que `infrastructure/`
                             todavía no ha absorbido
    auth/                   login-view, guard
    events/                 events-view, event-card, event-editor,
                             event-filters, ai-event-generator,
                             generate-from-text, suggest-tags, empty-state
    calendar/               calendar-view, agenda-view, month-grid,
                             agenda-days, calendar-export
    sharing/                user-directory, share-dialog, invitations-inbox,
                             permissions
    profile/                profile-view (incluye el borrado de cuenta)
    landing/                landing, legal (privacidad/términos), estilos
                             propios — prerrenderizada, sin JavaScript
    observability/          Sentry: errores y rendimiento real de usuario
    lib/                    types (esquema Zod de persistencia), utilidades
  e2e/                    Tests end to end, contra `npm run dev`
  e2e-landing/            Tests end to end de la landing, contra `dist/`
scripts/
  build-landing.js        Prerender de la landing + presupuesto de bytes
packages/                 Paquetes compartidos (vacío)
docs/                     Documentación; docs/adr/ decisiones
tasks/                    plan.md y todo.md
```

Reglas de seguridad en la raíz: `firestore.rules`, `storage.rules`.

## Modelo de datos

Un evento (`apps/web/src/lib/types.ts`; detalle completo de campos, tipos y
límites en [`docs/backend.json`](docs/backend.json) y en `firestore.rules`):

| Campo | Tipo | Notas |
| --- | --- | --- |
| `title`, `description`, `location` | `string` | `title` con mínimo 3 caracteres |
| `startDate`, `endDate` | fecha o `null` | opcionales; ver la semántica de rango sin fecha en `filter-events.ts` |
| `allDay` | `boolean` | por defecto `true`; un evento anterior a esta bandera se lee como día completo |
| `imageUrl` | `string` | portada en Storage, o vacío |
| `tags` | `string[]` | de cero a diez, normalizadas (recortadas, en minúsculas, sin duplicados) |
| `userId` | `string` | dueño, fijado al `uid` de quien crea, inmutable |
| `memberIds` | `string[]` | incluye al dueño; es lo que consulta el listado con `array-contains` |
| `roles` | `{ [uid]: "viewer" \| "editor" }` | uno por invitado; el dueño no tiene entrada aquí |
| `createdAt` | fecha | para ordenar por fecha de creación |

Colecciones auxiliares, sin equivalente en la fase 1:

- `eventInvites/{eventId}_{uid}`: invitación pendiente a un evento —título,
  quién invita, a quién y con qué rol—; se borra al aceptarla o rechazarla.
  No hay historial: ver «Fases siguientes».
- `userDirectory/{sha256(email)}`: traduce un email a `uid` para poder
  invitar por email. Ver [ADR 0007](docs/adr/0007-client-side-user-directory.md).
- `userProfiles/{uid}`: nombre y foto públicos de cada usuario, para pintar la
  lista de invitados de un evento sin exponer emails de terceros.

## Estilo de código

Biome con tabulaciones. Comentarios en inglés desde T42; documentación, ADRs y
Markdown en español. Elementos personalizados con prefijo `planu-`.

```ts
import "@awesome.me/webawesome/dist/components/card/card.js";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { StoredEvent } from "../lib/types.js";

/** A single event's card in the listing. */
@customElement("planu-event-card")
export class PlanuEventCard extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}
	`;

	// No `accessor`: that belongs to standard decorators, and these are legacy.
	@property({ attribute: false }) event!: StoredEvent;

	override render() {
		return html`
			<wa-card>
				<h3 slot="header">${this.event.title}</h3>
				<p>${this.event.description}</p>
			</wa-card>
		`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		"planu-event-card": PlanuEventCard;
	}
}
```

Convenciones que se dan por sentadas: `override` explícito lo exige
`@tsconfig/strictest`; declarar el elemento en `HTMLElementTagNameMap` para que
`lit-analyzer` valide las plantillas; importar cada componente de Web Awesome por
su ruta concreta, nunca el paquete entero.

## Estrategia de tests

Cinco niveles, cada uno con su responsabilidad:

- **Unitarios de lógica pura** (`src/**/*.test.ts`): el filtrado y orden de
  eventos, la normalización de etiquetas, el parseo de la respuesta de la IA,
  la validación del formulario, la serialización a `.ics`. Sin DOM ni red.
  Aquí es donde se cubren los casos límite.
- **Unitarios de componentes** (Vitest en Chromium real, no jsdom): render,
  slots, eventos emitidos. Web Awesome depende de shadow DOM y de custom
  elements, que jsdom no reproduce con fidelidad.
- **Tests de reglas de seguridad** (`apps/web/rules/*.test.ts`, `npm run
  test:rules`): contra el emulador de Firestore, sin la aplicación montada.
  Toda regla nueva llega con el test que **deniega**, escrito antes que la
  regla.
- **Frontera de arquitectura** (`apps/web/arch/*.test.ts`, `npm run
  test:arch`): en Node, sin emuladores; vigila que `firebase/*` sólo se
  importe donde `biome.json` lo permite y que esa lista de excepciones no
  crezca sin justificación. Ver «Capas» en `AGENTS.md`.
- **End to end** (`e2e/*.spec.ts` contra `npm run dev`, `e2e-landing/*.spec.ts`
  contra `dist/`): los recorridos completos contra los emuladores. **Cada e2e
  comprueba accesibilidad con axe y falla si hay violaciones.** No es
  opcional ni un test aparte.

La IA no se prueba contra el modelo real: se simula. Determinismo por encima de
realismo, y así los tests corren sin credenciales ni cuota.

Sin umbral numérico de cobertura. La regla es: toda lógica con ramas tiene test
unitario, y todo recorrido de usuario tiene e2e.

## Fronteras

**Siempre:**
- Ejecutar `npm run lint`, `npm run typecheck`, `npm run lint:lit`, `npm test`,
  `npm run test:rules`, `npm run test:arch` y `npm run test:e2e` antes de dar
  por terminado un incremento.
- Una única regla `allow` por operación en Firestore: se combinan con OR y
  separarlas anula los controles en lugar de sumarlos.
- Fijar `userId` al `uid` de quien escribe, nunca aceptarlo del cliente.
- Detectar disponibilidad antes de usar cualquier API no Baseline.
- Documentar en `docs/adr/` toda decisión con alternativas reales.
- Al tocar un componente acoplado a Firebase, dejarlo tras su puerto de
  `application/` antes de darlo por hecho (ver «Capas» en `AGENTS.md`).

**Preguntar primero:**
- Añadir dependencias.
- Cambiar el modelo de datos o las reglas de seguridad.
- Fusionar a `main`: desde el [ADR 0004](docs/adr/0004-despliegue-continuo.md),
  cualquier push que pase la verificación despliega solo a `planu-app`, que es
  un proyecto vivo compartido con el prototipo.
- Habilitar facturación Blaze o cualquier cosa con coste recurrente.
- Tocar el repo remoto `planu`.

**Nunca:**
- Versionar `.env.local` ni credenciales.
- Escribir la clave de la IA en el cliente sin App Check.
- Editar `.agents/skills/` o `.claude/skills/` a mano: se regeneran del lock.
- Borrar o silenciar un test que falla para que pase la build.
- Reintroducir `allow read: if true` en `events`.

## Criterios de éxito

1. Registro y acceso con email y contraseña y con Google; sin sesión,
   cualquier ruta privada bajo `/app` redirige a `/app/login`.
2. Alta de evento con imagen: la subida muestra progreso y la imagen aparece en
   la tarjeta.
3. Búsqueda por título o descripción, filtro por rango de fechas —con hora— y
   por etiqueta, con la semántica del prototipo para eventos sin fecha, con
   sólo inicio o con sólo fin.
4. Edición y borrado, este último con confirmación explícita.
5. Un usuario no puede leer ni modificar eventos de otro salvo que su dueño lo
   invite como lector o editor; verificado contra las reglas y no sólo por la
   UI. Un editor no puede ascenderse a sí mismo ni invitar, expulsar o borrar.
6. Un evento se exporta a `.ics` y se abre correctamente en Calendario de
   macOS y en Google Calendar, con horas cuando las tiene.
7. Los recorridos anteriores funcionan en cualquier navegador moderno, sin
   depender de la IA.
8. La generación desde imagen y desde texto pegado funciona en Chrome con IA
   integrada y también sin ella, vía Gemini en la nube cuando está habilitada.
9. Un visitante llega a `/`, entiende qué es planu sin registrarse y pasa a
   `/app` de un clic; la landing no envía una sola línea de JavaScript propio
   y carga con LCP < 1,5 s en 4G simulada. **Medido, no cumplido aún:**
   mediana de 5 pasadas de Lighthouse contra producción da 1,9 s (22/08/2026,
   ver Checkpoint F en `tasks/plan.md`); el resto del criterio sí se cumple.
10. Un usuario borra su cuenta y no queda rastro suyo en Firestore ni en
    Storage, imágenes y membresías en eventos ajenos incluidas.
11. Cero violaciones de axe en todos los e2e, landing y páginas legales
    incluidas.
12. `npm run build`, `npm test`, `npm run test:rules`, `npm run test:arch` y
    `npm run test:e2e` limpios, y `npm run setup` reconstruye el proyecto
    desde cero.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Coste de Gemini en la nube sin control | App Check obligatorio (sin configurar todavía); límite de tamaño de imagen; medir `contextUsage` antes de abrir a terceros |
| `wa-date-picker` es Pro | Se usa `wa-input` con `type="date"`/`type="time"` nativos del navegador, sin componente de calendario |
| Gemini Nano rinde peor que el Gemini de la nube | El resultado siempre pasa por el editor: el usuario revisa antes de guardar. Verificado con sesiones reales del autor (ver `tasks/todo.md`, T23) |
| Eventos de la fase 1 sin `memberIds` | Quedan ilegibles bajo las reglas de compartición hasta un backfill que sigue sin entregarse — bloquea el despliegue con datos reales, no el desarrollo (ver Checkpoint A en `tasks/plan.md`) |

## Preguntas abiertas

1. **Datos heredados en la base `planu` anteriores a esta reescritura.** Sin
   comprobar si existen documentos sin `userId`; bajo las reglas vigentes
   quedarían ilegibles para todo el mundo. Ligada a la siguiente: los eventos
   de la propia fase 1 de este proyecto, que sí tienen `userId` pero no
   `memberIds`, tienen el mismo problema, y su backfill sigue sin entregarse.
2. **App Check.** Requiere elegir proveedor de atestación y habilitar Blaze. Es
   requisito de bloqueo antes de poner `VITE_AI_CLOUD_FALLBACK=true` y, desde
   noviembre de 2026, antes de usar Firebase AI Logic en la nube en absoluto.
3. **Recuperación de contraseña.** Sigue sin `sendPasswordResetEmail`: quien
   olvide su clave se queda sin autoservicio.
4. **Confidencialidad real de las imágenes.** La URL de descarga sigue siendo
   un token portador: quien la tenga accede a la imagen sin sesión, y expulsar
   a alguien de un evento no revoca el acceso a su portada ya vista. Cerrarlo
   exigiría servirlas desde una Cloud Function.
5. **Zona horaria entre invitados.** Toda fecha se guarda y se muestra en la
   zona local de quien la escribe; con invitados en zonas distintas eso puede
   mostrar una hora equivocada. Registrado como pospuesto, no olvidado, en el
   [ADR 0010](docs/adr/0010-all-day-flag-y-zona-horaria.md).

El resto de preguntas abiertas específicas de cada tanda de funcionalidad
—dominio propio, cuánto se conservan las invitaciones ya decididas— están en
[`docs/spec-fase-2.md`](docs/spec-fase-2.md) y
[`docs/spec-invitation-activity.md`](docs/spec-invitation-activity.md). El
proveedor de analítica ya no es una pregunta abierta: lo resolvió el
[ADR 0009](docs/adr/0009-analitica-de-activacion.md).

## Fases siguientes

Este documento ya incorpora lo entregado en la fase 2, especificada aparte en
[`docs/spec-fase-2.md`](docs/spec-fase-2.md) —compartir con invitados, export a
calendario, vistas de calendario y agenda, etiquetas, generación desde texto,
sugerencia de etiquetas, landing pública, identidad visual, legales, borrado de
cuenta, onboarding y analítica— y en
[`docs/spec-horas-en-eventos.md`](docs/spec-horas-en-eventos.md) —hora
explícita por evento, además de la fecha—. Ambas amplían este documento, no lo
sustituyen; `docs/spec-fase-2.md` lleva su propia marca de estado con lo que
todavía falta.

Lo que queda fuera de este documento porque aún no se ha entregado:

- **Registro de invitaciones**, especificado en
  [`docs/spec-invitation-activity.md`](docs/spec-invitation-activity.md): hoy
  una invitación es un aviso efímero que se acepta o se rechaza y desaparece,
  sin dejar historial consultable.
- **Cierre de la arquitectura hexagonal**, especificado en
  [`docs/spec-arquitectura-hexagonal.md`](docs/spec-arquitectura-hexagonal.md):
  el puerto de sesión ya está entregado; los de repositorio de eventos y
  almacén de imágenes sólo migraron el editor, no el listado ni la tarjeta; y
  cerrar la frontera a `src/ui/` no se ha empezado.
- **Flujo único de creación de evento**, especificado en
  [`docs/spec-flujo-creacion-evento.md`](docs/spec-flujo-creacion-evento.md):
  el desplegable «Nuevo evento» (crear a mano / generar con IA) se sustituye
  por un único botón que abre siempre el mismo formulario, con la oferta de
  IA embebida al principio en vez de en un diálogo aparte.
</content>
