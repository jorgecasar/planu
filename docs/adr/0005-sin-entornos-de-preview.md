# 0005 · Sin entornos de preview: todo va a producción

- **Estado:** aceptado
- **Fecha:** 2026-08-16
- **Supersede:** los puntos 8 bis y 9 del [ADR 0004](0004-despliegue-continuo.md)
  —canales de preview por pull request y autorización dinámica de sus dominios
  para OAuth—. El resto del 0004 sigue vigente.

## Contexto

El ADR 0004 montó un canal de preview por pull request. Aquello arrastró más
cosas de las que parecía:

- Los previews usaban Firestore y Storage **de producción**, así que probar un
  alta creaba usuarios y eventos reales.
- Firebase Auth sólo permite OAuth desde dominios de una lista y **no admite
  comodines**. Cada canal recibe un dominio nuevo, y el hash **no es estable**:
  borrar y recrear el mismo canal da otro distinto (comprobado). Hizo falta un
  job que autorizara el dominio en cada despliegue y podara los muertos, con su
  rol de IAM, su read-modify-write y un grupo de concurrencia para que dos PR
  no se pisaran.

Al buscar el aislamiento de datos apareció el muro: la
[guía de entornos de Firebase](https://firebase.google.com/docs/projects/dev-workflows/overview-environments)
recomienda **un proyecto por entorno**, y dentro de un solo proyecto **Auth no
se puede separar** —usuarios, proveedores y dominios autorizados son únicos—.
Se puede separar Firestore por bases con nombre, pero **el emulador no soporta
varias**: con dos declaradas avisa y sirve una, de modo que los tests locales
nunca ejercitarían la de preview.

## Decisión

**No hay entornos. Todo va a producción.**

El motivo es que **no hay usuarios reales**: la aplicación no está lanzada, así
que no existe el dato que los entornos vienen a proteger. Montarlos ahora sería
infraestructura para un problema que todavía no tenemos, y de la que habría que
acordarse en cada cambio.

Se elimina, por tanto:

- El job `preview` y el job `authorize-preview-domain` de `.github/workflows/ci.yml`.
- `scripts/sync-auth-domains.js`.
- El rol a medida `previewAuthDomains` y su concesión a la cuenta de despliegue.
- Los canales `pr-1` y `pr-2`, y sus dominios de la lista de autorizados.
- La base `preview` y el bucket `planu-app-preview`, creados y nunca usados.

La cuenta de despliegue vuelve a cuatro roles, ninguno con acceso a datos.

## Consecuencias

**Lo que se pierde.** Los previews eran el único sitio donde se comprobaban la
CSP y las cabeceras de caché reales: los e2e corren contra `npm run dev` y nunca
ven la configuración de hosting. Ese hueco vuelve a estar abierto, y con él la
clase de fallo que ya nos mordió una vez —la CSP bloqueando los iconos de Web
Awesome— y que sólo se detectó probando a mano.

Mitigación: `scripts/check-startup-cost.js` y `scripts/verify-sentry.js` siguen
existiendo y se pueden lanzar contra producción después de desplegar.

**Cuándo hay que revisar esto.** El día que haya usuarios reales. A partir de
ahí, desplegar a producción sin un paso intermedio deja de ser aceptable y toca
volver a la guía de Firebase: un proyecto por entorno, con Auth propio.

## Alternativas descartadas

**Proyecto `planu-preview` aparte**, que es lo que Google recomienda. Es la
solución correcta y la que habrá que adoptar al lanzar. Hoy exige pasos
manuales en consola —Auth, proveedor de Google con pantalla de consentimiento,
posiblemente Blaze para Storage— para proteger unos datos que no existen.

**Mismo proyecto con base y bucket aparte**, compartiendo Auth. Llegó a estar
montado y se deshizo: aísla los datos pero el emulador sólo sirve una base, así
que la de preview nunca se probaría en local. Se pelea con las herramientas a
cambio de medio aislamiento.
