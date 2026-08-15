# 0004 · Despliegue continuo desde `main`, con source maps subidos en el build

- **Estado:** aceptado
- **Fecha:** 2026-08-15
- **Supersede:** nada

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

**8. Preview por pull request**, con canal de 7 días. Cubre el hueco conocido de
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

**Workload Identity Federation**, que evitaría la clave de larga duración. Es lo
correcto y queda pendiente: montarlo exige `gcloud`, que no está instalado en la
máquina donde se configuró esto.

## Consecuencias

- Un push a `main` es un despliegue. Deja de haber «lo probé y luego lo subo».
- Existe una clave de cuenta de servicio de larga duración en los secretos de
  GitHub. Es el punto débil de esta decisión y lo que WIF vendría a cerrar.
- Un despliegue manual desde una máquina **no** sube source maps. Es
  deliberado: sólo se suben los del bundle que CI publica.
- El primer despliegue cambia `planu-app.web.app` de 404 a la aplicación.
