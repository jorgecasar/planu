# Spec: planu

## Objetivo

Planificador de eventos personales. Cada usuario crea, consulta, busca, filtra,
edita y borra sus propios eventos, con título, descripción, ubicación, fechas de
inicio y fin, e imagen de portada. Los eventos son **privados**: nadie más los ve.

Como atajo, el usuario puede subir la foto de un cartel o folleto y dejar que la
IA extraiga los campos del evento, que luego revisa y confirma antes de guardar.

**Usuario objetivo:** producto público en potencia, no herramienta interna. Eso
fija tres exigencias que no serían negociables en un proyecto personal:
accesibilidad verificada de forma automática, textos preparados para traducirse,
y control del coste de la IA en la nube.

**Éxito** = un usuario nuevo se registra, crea su primer evento con imagen, lo
encuentra buscando por texto o filtrando por fechas, lo edita y lo borra, sin que
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
npm run setup       # instala dependencias y restaura las skills del agente
npm run dev         # servidor de desarrollo en http://localhost:3000
npm run build       # tsc --noEmit && vite build → apps/web/dist
npm test            # Vitest en Chromium real
npm run test:e2e    # Playwright + axe
npm run lint        # Biome
npm run lint:lit    # lit-analyzer sobre las plantillas
npm run typecheck   # tsc --noEmit
npm run emulators   # emuladores: auth 9099, firestore 8080, storage 9199
```

`npm test` y `npm run test:e2e` requieren `npx playwright install chromium`.

## Estructura

```
apps/web/src/
  main.ts                    Punto de entrada: estilos y tema de Web Awesome
  app-shell.ts               Router, cabecera y guarda de sesión
  firebase/                  config, contextos, provider, controllers, storage
  auth/                      login-view
  events/                    events-view, event-card, event-filters,
                             event-editor, ai-event-generator, filter-events
  profile/                   profile-view
  lib/                       types (esquema Zod), utilidades
apps/web/e2e/                Tests end to end
packages/                    Paquetes compartidos (vacío)
docs/                        Documentación; docs/adr/ decisiones
tasks/                       plan.md y todo.md
```

Reglas de seguridad en la raíz: `firestore.rules`, `storage.rules`.

## Estilo de código

Biome con tabulaciones. Comentarios en español; identificadores en inglés.
Elementos personalizados con prefijo `planu-`.

```ts
import "@awesome.me/webawesome/dist/components/card/card.js";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Event } from "../lib/types.js";

/** Tarjeta de un evento en el listado. */
@customElement("planu-event-card")
export class PlanuEventCard extends LitElement {
	static override styles = css`
		:host {
			display: block;
		}
	`;

	// Sin `accessor`: eso es de decoradores estándar y aquí son legacy.
	@property({ attribute: false }) event!: Event;

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

Tres niveles, cada uno con su responsabilidad:

- **Unitarios de lógica pura** (`src/**/*.test.ts`): el filtrado de eventos, el
  parseo de la respuesta de la IA, la validación del formulario. Sin DOM ni red.
  Aquí es donde se cubren los casos límite.
- **Unitarios de componentes** (Vitest en Chromium real, no jsdom): render,
  slots, eventos emitidos. Web Awesome depende de shadow DOM y de custom
  elements, que jsdom no reproduce con fidelidad.
- **End to end** (`e2e/*.spec.ts`): los recorridos completos contra los
  emuladores. **Cada e2e comprueba accesibilidad con axe y falla si hay
  violaciones.** No es opcional ni un test aparte.

La IA no se prueba contra el modelo real: se simula. Determinismo por encima de
realismo, y así los tests corren sin credenciales ni cuota.

Sin umbral numérico de cobertura. La regla es: toda lógica con ramas tiene test
unitario, y todo recorrido de usuario tiene e2e.

## Fronteras

**Siempre:**
- Ejecutar `npm run lint`, `npm run typecheck`, `npm run lint:lit`, `npm test` y
  `npm run test:e2e` antes de dar por terminado un incremento.
- Una única regla `allow` por operación en Firestore: se combinan con OR y
  separarlas anula los controles en lugar de sumarlos.
- Fijar `userId` al `uid` de quien escribe, nunca aceptarlo del cliente.
- Detectar disponibilidad antes de usar cualquier API no Baseline.
- Documentar en `docs/adr/` toda decisión con alternativas reales.

**Preguntar primero:**
- Añadir dependencias.
- Cambiar el modelo de datos o las reglas de seguridad.
- Desplegar a `planu-app`: es un proyecto vivo compartido con el prototipo.
- Habilitar facturación Blaze o cualquier cosa con coste recurrente.
- Tocar el repo remoto `planu`.

**Nunca:**
- Versionar `.env.local` ni credenciales.
- Escribir la clave de la IA en el cliente sin App Check.
- Editar `.agents/skills/` o `.claude/skills/` a mano: se regeneran del lock.
- Borrar o silenciar un test que falla para que pase la build.
- Reintroducir `allow read: if true` en `events`.

## Criterios de éxito

1. Registro y acceso con email y contraseña y con Google; sin sesión, cualquier
   ruta privada redirige a `/login`.
2. Alta de evento con imagen: la subida muestra progreso y la imagen aparece en
   la tarjeta.
3. Búsqueda por título o descripción y filtro por rango de fechas, con la
   semántica del prototipo para eventos sin fecha, con sólo inicio o con sólo fin.
4. Edición y borrado, este último con confirmación explícita.
5. Un usuario no puede leer ni modificar eventos de otro, verificado contra las
   reglas y no sólo por la UI.
6. Los recorridos anteriores funcionan en cualquier navegador moderno, sin
   depender de la IA.
7. La generación desde imagen funciona en Chrome con IA integrada y también sin
   ella, vía Gemini en la nube.
8. Cero violaciones de axe en todos los e2e.
9. `npm run build` limpio y `npm run setup` reconstruye el proyecto desde cero.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Coste de Gemini en la nube sin control | App Check obligatorio; límite de tamaño de imagen; medir `contextUsage` antes de abrir a terceros |
| `wa-date-picker` es Pro | Se usa `wa-known-date`, que es libre; el filtro por rango pasa de calendario a dos campos |
| Gemini Nano rinde peor que el Gemini de la nube | El resultado siempre pasa por el editor: el usuario revisa antes de guardar |
| Documentos heredados sin `userId` | Quedan ilegibles bajo las reglas nuevas; hay que decidir si migrarlos o descartarlos |

## Preguntas abiertas

1. **Datos heredados en la base `planu`.** Sin comprobar si hay documentos y si
   tienen `userId`.
2. **Datos heredados en la base `planu`.** Sin comprobar si hay documentos y si
   tienen `userId`.
4. **App Check.** Requiere elegir proveedor de atestación y habilitar Blaze.
