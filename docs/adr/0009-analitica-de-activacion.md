# ADR 0009: Analítica de activación — Firebase Analytics (GA4)

## Contexto

T31 exige medir activación —visita, registro, primer evento creado, evento
compartido, uso de la IA— sin filtrar nunca contenido del usuario, y con la
aplicación funcionando igual si un bloqueador impide la analítica. La tarea
estaba **bloqueada por la decisión de proveedor**, que además determina si T30
necesita aviso de cookies.

Se evaluaron cuatro opciones antes de decidir:

| Proveedor | Cookies | Coste | Infraestructura |
|---|---|---|---|
| Firebase Analytics (GA4) | Sí | Gratis | Ninguna — ya en `firebase/*` |
| Umami Cloud | No | Gratis (100k eventos/mes) | Ninguna, pero un origen nuevo |
| Plausible | No | Desde $9/mes, sin capa gratis | Ninguna |
| Umami autohospedado | No | Gratis | Un servicio nuevo que mantener |

Umami Cloud cumplía el criterio "sin cookies" sin coste, pero **se decide
Firebase Analytics**, elección explícita del propietario del producto por
encima de esa alternativa.

## Decisión

**Firebase Analytics (Google Analytics 4)**, integrado con el SDK de Firebase
que el proyecto ya usa (`firebase@^12`, paquete `firebase/analytics`).

### Los cinco eventos, y no más

| Evento GA4 | Cuándo |
|---|---|
| `page_view` | Automático del SDK, en cada navegación de vista |
| `sign_up` | Al completar el registro (email o Google) |
| `first_event_created` | Al primer `addDoc` en `events` de esa cuenta — evento personalizado, no el genérico `create_event` de GA4, que en su taxonomía es para calendarios |
| `share` | Al enviar una invitación desde el diálogo de compartir |
| `ai_used` | Al generar un evento desde imagen o texto pegado |

**Nunca título, descripción, ubicación ni ninguna cadena que el usuario haya
escrito.** Los parámetros de cada evento son enteros o booleanos —cuántos
eventos tiene la cuenta, si la invitación fue por edición o solo lectura—,
nunca el contenido en sí.

### Consecuencia para T30: hace falta aviso de cookies

Firebase Analytics usa `localStorage`/cookies para el ID de cliente que
distingue visitas. Con Umami o Plausible no habría sido necesario; con esta
elección, **T30 sí lleva el aviso** que su nota dejaba condicional.

### CSP

`connect-src`, `img-src` y `script-src` necesitan los orígenes de
Google Tag Manager y Google Analytics, que hoy no están en `firebase.json`.
Sin Google Signals —no hace falta con cinco eventos sin datos de usuario—, no
se añade `doubleclick.net` ni `*.google.<tld>`.

```
script-src:  https://*.googletagmanager.com
img-src:     https://*.google-analytics.com https://*.googletagmanager.com
connect-src: https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com
```

### Degradación con bloqueadores

`firebase/analytics` expone `isSupported()`, que resuelve `false` cuando el
navegador o un bloqueador impiden Analytics. `src/analytics/track.ts` la
comprueba antes de inicializar, y cualquier fallo posterior se traga: la
aplicación debe funcionar exactamente igual con la analítica bloqueada, y así
lo comprueba el e2e de T31.

### Carga diferida, mismo patrón que Sentry y Firebase Performance

Sigue exactamente el hueco que `src/observability/index.ts` ya abrió para
Sentry: after-main-paint, sin ejecutar en `DEV`, y detrás de una variable de
entorno (`VITE_FIREBASE_MEASUREMENT_ID`) para que el repo funcione sin cuenta
de Analytics configurada.

## Consecuencias

**Positivas:**
- Cero dependencias nuevas y cero infraestructura que mantener: el SDK ya
  está en el bundle de Firebase.
- Mismo patrón de carga diferida que el resto de observabilidad — sin
  competir por el primer paint.

**Negativas:**
- T30 lleva aviso de cookies, que con Umami o Plausible no habría hecho falta.
- Añade tres directivas de CSP a un dominio de terceros que hoy no está.
- GA4 no es "sin cookies" ni cumple estrictamente la lectura más estricta del
  criterio de T31 sobre privacidad; se documenta la contrapartida en lugar de
  ocultarla.

## Alternativas consideradas

1. **Umami Cloud**: cumplía "sin cookies" sin coste. Descartada por decisión
   explícita del propietario del producto, no por ningún defecto técnico.
2. **Plausible**: sin capa gratuita ($9/mes desde el primer día); descartada
   por coste antes de llegar a comparar funcionalidad.
3. **Umami autohospedado**: gratis, pero exige levantar y mantener un
   servicio nuevo — contradice la preferencia de este proyecto por
   infraestructura mínima.

## Verificación

- Unitarios de `src/analytics/track.ts`: traga errores, no filtra campos de
  evento, no envía nada si `isSupported()` resuelve `false`.
- E2E con la analítica bloqueada: la aplicación funciona igual.

## Enlaces

- Tarea: T31 (`tasks/todo.md`)
- Depende de: T30, que ahora incorpora el aviso de cookies
- CSP: `firebase.json`
