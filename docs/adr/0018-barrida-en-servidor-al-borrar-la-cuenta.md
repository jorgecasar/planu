# 0018 · Barrida en servidor al borrar la cuenta: ¿se reabre «sin Cloud Functions»?

- **Fecha:** 2026-11-15 · **Estado:** propuesta; la decide el responsable del producto
- **Supersede parcialmente (si se elige A o B):** [0007](0007-client-side-user-directory.md), sólo la línea «no hay Cloud Functions, y el plan Blaze queda fuera de alcance». El 0007 no se reescribe. · **Afecta también a:** [0012](0012-invitaciones-pendientes-por-email.md), que repite esa restricción · **Issue:** GH-315 (T1 de GH-154)

## Contexto

El borrado de cuenta lo hace el cliente ([0013](0013-borrado-de-invitaciones-con-la-cuenta.md)):
lista los eventos y las imágenes del usuario, los borra y al final llama a
`deleteUser()`. Eso deja un hueco que el cliente no puede cerrar: si el
usuario crea un evento o sube una portada **después** de esa lectura, desde
otra pestaña o tras volver atrás, el dato sobrevive a `deleteUser()` y
pertenece a un uid que ya no existe. Nadie puede borrarlo sin acceso de
administración. Es el criterio 1 de GH-154; los otros cuatro ya están
cumplidos en `main`.

La restricción vigente es «sin servidor, sin Cloud Functions, sin plan Blaze,
por coste recurrente» (0007, `Context`; 0012). Ninguna PR puede cumplir el
criterio sin que el responsable la reabra, y esta propuesta sólo lo pide **para
esta barrida**: no reabre la resolución de emails del 0007 ni nada más. Si
algún día hubiera Functions por otro motivo, el propio 0007 ya dice que su
decisión merecería revisarse; aquí no se hace.

## Lo que se verificó en la documentación oficial

La premisa del plan era que el disparador de borrado de Auth sólo existía en
la primera generación. **Es falsa** o, como mínimo, ha dejado de serlo.

| Afirmación | Resultado | Fuente |
| --- | --- | --- |
| La segunda generación tiene disparador de borrado de usuario | Sí: `onUserDeleted`, de `firebase-functions/v2/identity`. La referencia lo marca **BETA**; una búsqueda atribuye a `firebase-functions@7.4.0` su paso a disponibilidad general, pero **no se confirmó en una fuente primaria** | [Guía de disparadores de Auth](https://firebase.google.com/docs/functions/auth-events), [referencia 2.ª gen](https://firebase.google.com/docs/reference/functions/2nd-gen/node/firebase-functions.identity) |
| La primera generación sigue existiendo (`auth.user().onDelete`, `firebase-functions/v1`) | Hay documentación 1.ª gen de los disparadores de Auth; **su ruta de importación no se comprobó** | [Disparadores de Auth, 1.ª gen](https://docs.cloud.google.com/functions/1stgendocs/calling/firebase-auth) |
| El borrado masivo no dispara el evento | Cierto: `deleteUsers()` del SDK Admin no lo emite, hay que borrar de uno en uno. El borrado desde el cliente es de uno en uno | Guía de disparadores de Auth |
| La entrega es al menos una vez | La función debe ser idempotente, como ya lo es el caso de uso del cliente | Guía de disparadores de Auth |
| El emulador cubre los disparadores v2 de Auth | Había un fallo (los descartaba sin avisar); el issue está cerrado, pero **no se comprobó en qué versión de `firebase-tools` quedó corregido** | [firebase-tools #11094](https://github.com/firebase/firebase-tools/issues/11094) |
| Desplegar Functions exige Blaze | Sí: «to deploy functions, your project must be on the Blaze pricing plan». Emular no lo exige | [Primeros pasos con Functions](https://firebase.google.com/docs/functions/get-started) |
| La extensión admite una base con nombre | Sí: `FIRESTORE_DATABASE_ID`, `(default)` o el id de la base | [Extensión en extensions.dev](https://extensions.dev/extensions/firebase/delete-user-data), [PREINSTALL](https://github.com/firebase/extensions/blob/next/delete-user-data/PREINSTALL.md) |
| Instalar una extensión exige Blaze | Sí, y usa Firestore, Storage, Pub/Sub y Functions | PREINSTALL |

La página de configuración de la extensión
([docs](https://firebase.google.com/docs/extensions/official/delete-user-data))
no menciona `FIRESTORE_DATABASE_ID`; la mencionan las otras dos. Se toma como
cierta por ser lo que dice el README de la extensión, pero queda **sin
verificar contra una instalación real**.

**Precios: sin verificar y no se citan.** El coste de Blaze y de cada llamada
depende de la tarifa vigente; antes de decidir hay que mirar la
[tarifa de Cloud Functions](https://firebase.google.com/pricing) y la cuota
sin coste que cubra el uso previsto.

## Opciones

### A · Función propia con el disparador de borrado de Auth

`onUserDeleted` (2.ª gen) en un workspace nuevo, con el SDK Admin y
`getFirestore(app, "planu")`. Borra los eventos con `userId == uid`, lo que
haya bajo `events/{uid}/` en Storage, las invitaciones y el perfil, y quita el
uid de las membresías de eventos ajenos.

- **Ventajas:** cubre todo, incluidas membresías y lápidas; se prueba con
  emuladores; el código vive en el repo y pasa por el mismo ciclo que el resto.
- **Costes:** exige Blaze; un workspace nuevo con su build y su CI; es la
  primera pieza con privilegios de administración del proyecto.
- **Riesgos:** corre saltándose `firestore.rules`, así que un fallo borra de
  más y nadie lo frena; el disparador es BETA en la referencia; si la función
  falla, el residual vuelve y nadie se entera salvo con alertas.

### B · Extensión oficial «Delete User Data»

Se configura con rutas con `{UID}` (por ejemplo `{DEFAULT}/events/{UID}` en
Storage), `FIRESTORE_DATABASE_ID=planu` y, si se quiere, el descubrimiento
automático por campos (profundidad 3 por defecto).

- **Ventajas:** nada que mantener ni que desplegar como código propio.
- **Costes:** también exige Blaze; cada borrado de cuenta paga las lecturas del
  descubrimiento automático, que la propia página avisa de que pueden ser
  muchas.
- **Riesgos:** sólo borra lo que se le configura y **no parece poder editar
  documentos ajenos**: quitar el uid de `memberIds` y `roles` en eventos de
  otros no entra (inferencia de la descripción, sin verificar). Que el
  descubrimiento automático encuentre `events` por `userId` en una base con
  nombre **no se comprobó**. Tampoco se probaría con los emuladores del repo.

### C · No hacerlo y aceptar el residual por escrito

- **Ventajas:** cero coste, cero código, la restricción de 0007 y 0012 sigue
  intacta.
- **Costes:** un dato huérfano queda para siempre bajo un uid muerto.
- **Riesgos:** es una carrera acotada (escribir en otra pestaña mientras se
  borra), pero el derecho de supresión del RGPD (art. 17) no tiene excepción
  por «es difícil». El cliente ya reduce la ventana con la guarda del borrado
  (GH-154, criterios 2 a 5), no la cierra.

Si sale C, aquí debe quedar quién acepta el residual y con qué fecha. **Este
documento no lo acepta en nombre de nadie.**

## Qué cambia en el repositorio si se elige A o B

- **Facturación.** El proyecto `planu-app` pasa a Blaze. Eso es una decisión
  de cuenta, no de código, y sólo la puede tomar el responsable.
- **Cuenta de servicio de CI.** El despliegue entra con
  `github-actions-deploy@planu-app.iam.gserviceaccount.com`
  (`.github/workflows/ci.yml:197`). Qué roles añadir para desplegar Functions
  o extensiones **no se verificó**; hay que sacarlo de la documentación de
  despliegue antes de T5 y concederlo con el mínimo privilegio.
- **`ci.yml` está sellado** (#88). Añadir `functions` (A) o `extensions` (B) al
  `--only` de la línea 206 no lo puede hacer un agente; lo hace una persona,
  en su propia PR. Hasta entonces, la función existiría en el repo sin
  desplegarse.
- **La base se llama `planu`**, no `(default)`. En A, `getFirestore(app,
  "planu")`; en B, `FIRESTORE_DATABASE_ID=planu`. Olvidarlo borra de una base
  vacía y el test no se entera salvo que siembre en la correcta.
- **Frontera hexagonal.** `biome.json` prohíbe `firebase/` en `apps/web/src/`.
  Un workspace nuevo queda fuera de esa regla y de `npm run test:arch`
  (hay que confirmarlo en T2).

## Tareas que siguen

| Opción | Tareas de GH-154 | Tamaño |
| --- | --- | --- |
| A | T2 andamiaje (~150 líneas), T3 eventos e imágenes (~150-200), T4 membresías, invitaciones y perfil (~200), T5 despliegue (~20, manual, sólo una persona) | ~4 PR |
| B | Se sustituyen T2-T4 por una configuración en `firebase.json` y su documentación (~40 líneas, sin verificar); T5 igual. Las membresías ajenas quedarían sin cubrir | ~2 PR |
| C | Ninguna. Se cierra GH-154 con este ADR como registro | 0 |

T4 incluye decidir qué hacer con las lápidas del
[0015](0015-lapida-al-salir-de-un-evento.md): hoy el cliente las deja con el uid
muerto a propósito.

## Preguntas para el responsable

1. **¿Se pasa a Blaze para esta barrida?** Recomiendo que sí, siempre que la
   tarifa y la cuota sin coste de Functions cubran el uso previsto —un borrado
   de cuenta es raro—, y se fije un presupuesto con alerta en el proyecto.
   Si la respuesta es no, la opción es C.
2. **¿A o B?** Recomiendo A: es la única que cubre las membresías ajenas y se
   prueba con los emuladores del repo. B sólo gana si se acepta no tocar las
   membresías y se comprueba antes el descubrimiento automático sobre `planu`.
3. **¿Quién abre la PR de `ci.yml` y concede los permisos a la cuenta de
   servicio?** Recomiendo el propio responsable, después de T3 y T4 y no antes.
4. **Si C, ¿quién acepta el residual y cuándo se revisa?** Sin recomendación:
   es una aceptación de riesgo legal y solo la puede dar el responsable. Se
   sugiere revisarla al
   lanzar con usuarios reales (ver [0005](0005-sin-entornos-de-preview.md)).
5. **¿Qué se hace con las lápidas al borrar la cuenta?** Recomiendo que la
   función las borre sólo si el evento ya no existe; es una decisión de
   privacidad y la toma el responsable.

## Consecuencias

- La restricción de 0007 y 0012 sólo se levanta, si se levanta, para esta
  barrida. Cualquier otro uso de Functions necesita su propia decisión.
- Si se elige A o B, `docs/adr/README.md` pasa este ADR a «aceptado» y el 0007
  queda marcado como superado en parte.
- Este documento no cambia código, reglas ni workflows.
