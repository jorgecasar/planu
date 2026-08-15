# 0004 · Despliegue continuo desde `main`, con source maps subidos en el build

- **Estado:** aceptado, parcialmente superseído
- **Fecha:** 2026-08-15
- **Supersede:** nada
- **Superseído en parte por** [ADR 0005](0005-sin-entornos-de-preview.md): los
  puntos **8 bis** y **9** —canales de preview por pull request y autorización
  dinámica de sus dominios— ya no aplican. El resto sigue vigente.

## Contexto

Hasta ahora el despliegue era manual y, de hecho, **nunca llegó a ocurrir**:
`planu-app.web.app` devolvía 404 mientras las reglas sí estaban en producción.
Las medidas de rendimiento que dábamos por buenas se habían tomado contra el
emulador de hosting, no contra el sitio real.

En paralelo, la observabilidad estaba escrita pero inerte: sin DSN no enviaba
nada, y aun con DSN cada traza habría apuntado a un bundle minificado.

Hay tres sitios donde corre `npm run build` —tu máquina, CI en cada push y PR,
y el `predeploy` de `firebase deploy`— y sólo el último llega a usuarios.

## Decisión

**1. Desplegar al subir a `main`, tras la verificación.** El job `deploy`
depende de `verify`, así que nada se publica sin lint, typecheck, 74 unitarios,
33 de reglas y 25 e2e en verde.

**2. Las reglas se despliegan con el hosting**, no a mano. Es el cambio más
peligroso del proyecto, y por eso mismo el que peor tolera la deriva silenciosa
entre repo y producción. Lo que lo hace aceptable es que sus 33 tests acaban de
pasar en el job anterior; sin esa red, esta decisión no se sostendría.

**3. Los source maps se suben dentro del build, no en un paso posterior.**
Sentry empareja bundle y map por **debug ID**, un identificador que el plugin
inyecta en ambos mientras Rollup los emite. Subirlos después con `sentry-cli`
exigiría reescribir el bundle ya construido para inyectárselo, y entonces lo
que se despliega deja de ser lo que produjo el build.

**4. El interruptor de la subida es `SENTRY_UPLOAD`, no la presencia del
token.** Con el gate por token, exportar `SENTRY_AUTH_TOKEN` una vez en el
`.zshrc` convertiría cada build local en una release de Sentry, y no habría
forma de notarlo. Con una variable explícita que sólo pone el job de
producción, `npm run build` sigue funcionando sin red y sin credenciales en
todas partes.

**5. No hay script `build:release`.** `firebase.json` conserva
`predeploy: ["npm run build"]`. Si el despliegue construyera por su cuenta y
luego `firebase deploy` volviera a construir por el predeploy, se publicaría un
bundle **distinto** de aquel cuyos debug IDs se subieron: los maps quedarían
huérfanos y las trazas minificadas, sin ningún error visible. Una variable de
entorno sobre un único build cierra esa puerta.

**6. Si falta cualquier variable, el build para.** Subir maps sin release es el
fallo silencioso clásico: Sentry acepta los ficheros, el despliegue se da por
bueno y las trazas siguen ilegibles. Preferimos romper el build y leer el
motivo.

**7. El job de despliegue tiene su propio grupo de concurrencia, sin
`cancel-in-progress`.** El grupo general cancela la ejecución anterior en cada
push, que es correcto para verificar y pésimo a mitad de un `firebase deploy`.

**8. GitHub se autentica con Workload Identity Federation, sin clave.** El
runner presenta su token OIDC y Google devuelve credenciales que caducan con el
job. **No existe ninguna clave**, ni en los secretos de GitHub ni en disco: no
hay nada que robar ni que rotar.

La cuenta `github-actions-deploy` acabó con estos cuatro roles, cada uno
descubierto por el 403 que provocaba su ausencia:

| Rol | Para qué |
| --- | --- |
| `firebasehosting.admin` | publicar el sitio |
| `firebaserules.admin` | desplegar las reglas de Firestore y Storage |
| `serviceusage.serviceUsageConsumer` | comprobar si una API está habilitada |
| `datastore.indexAdmin` | desplegar los índices de Firestore |
| `previewAuthDomains` (a medida) | autorizar el dominio de cada preview para OAuth |

**Ninguno concede lectura de datos.** Merece la pena decir qué se descartó y
por qué: `roles/firebase.viewer` resolvía de un plumazo dos de los cuatro
403, pero incluye `datastore.entities.*` — la cuenta que despliega podría leer
los eventos privados de cualquier usuario. Las reglas de Firestore no protegen
frente a una cuenta de servicio con permiso a nivel de proyecto, así que
concederlo habría vaciado de contenido el ADR 0002 y sus 33 tests.
`datastore.indexAdmin` es lo contrario: 11 permisos, ninguno sobre entidades.

Lo que sostiene esto es la condición del proveedor:

```
assertion.repository == 'jorgecasar/planu'
```

Sin ella, cualquier repositorio de GitHub —de cualquier persona— podría pedir
un token contra este proyecto, porque el emisor `token.actions.githubusercontent.com`
es común a todo GitHub. Es la línea que **no** hay que relajar.

**8 bis. El dominio de cada preview se autoriza solo para OAuth.** Firebase Auth
sólo permite operaciones OAuth desde los dominios de su lista y **no admite
comodines**; cada canal recibe un `planu-app--<canal>-<hash>.web.app` nuevo. Sin
esto, el preview avisa por consola de que el dominio no está autorizado y
«Continuar con Google» no abre el popup, mientras el acceso con correo sigue
funcionando — que es lo que hace fácil no darse cuenta.

El hash **no es estable**: borrar y recrear el mismo canal da otro distinto
(comprobado). Por eso no basta con autorizar una vez por PR y **la poda es
obligatoria**, o la lista crece sin fin. La lógica está en
`scripts/sync-auth-domains.js`.

Tres decisiones alrededor:

- **Rol a medida `previewAuthDomains`, con dos permisos.** El camino evidente
  era `roles/firebaseauth.admin`, pero trae 16, entre ellos
  `firebaseauth.users.createSession` —emitir una sesión de cualquier cuenta— y
  `configs.getSecret`. Para reescribir una lista de dominios basta con
  `configs.get` y `configs.update`.
- **Job aparte con grupo de concurrencia compartido.** La API no tiene endpoint
  de «añadir», así que escribir es un read-modify-write de la lista entera y dos
  PR simultáneos se pisarían. Se serializa sólo la mutación, no los despliegues
  de preview, que siguen en paralelo.
- **No es fatal.** Un preview con OAuth roto sigue sirviendo para revisar la
  interfaz y las cabeceras; tumbar el job escondería un despliegue correcto tras
  un check en rojo. Falla con `::warning::`.

**Los previews no mandan errores a Sentry.** No se les pasa `VITE_SENTRY_DSN`:
gastarían cuota de eventos y, como sus source maps no se suben, llegarían
minificados y atribuidos a una release inexistente.

**9. Preview por pull request**, con canal de 7 días. Cubre el hueco conocido de
los e2e, que corren contra `npm run dev` y por tanto nunca ejercitan la CSP ni
las cabeceras de caché. La CSP ya rompió los iconos de Web Awesome una vez y
sólo se detectó probando a mano contra el emulador de hosting.

## Alternativas descartadas

**`FirebaseExtended/action-hosting-deploy`.** Resuelve bien el preview y su
comentario en el PR, pero sólo despliega hosting. Habría hecho falta un segundo
mecanismo para las reglas, y con él dos formas distintas de autenticarse.

**Clave de `firebase-adminsdk`.** Es la que ofrece la consola de Firebase con un
clic, y lleva permisos de edición sobre todo el proyecto. Se usa en su lugar una
cuenta de servicio dedicada con `firebasehosting.admin` y `firebaserules.admin`.

**Clave JSON de cuenta de servicio.** Era el plan inicial y se descartó al
instalar `gcloud`, que es lo único que faltaba para poder montar WIF. Habría
dejado una credencial de larga duración en los secretos de GitHub que nadie
rotaría.

## Consecuencias

- Un push a `main` es un despliegue. Deja de haber «lo probé y luego lo subo».
- No hay ninguna credencial de Google en los secretos del repositorio. El único
  secreto que queda es `SENTRY_AUTH_TOKEN`, y su alcance es `org:ci`: subir
  source maps y crear releases, nada más.
- El permiso vive en la condición del proveedor OIDC, que está en GCP y no en
  el repositorio. Quien clone el repo no se lleva nada aprovechable, y quien
  cambie esa condición no deja rastro en la historia de git. Es el precio de no
  tener claves.
- Un despliegue manual desde una máquina **no** sube source maps. Es
  deliberado: sólo se suben los del bundle que CI publica.
- El primer despliegue cambia `planu-app.web.app` de 404 a la aplicación.
