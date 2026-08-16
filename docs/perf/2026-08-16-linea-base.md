# Línea base de rendimiento · 16 de agosto de 2026

Primera medida contra **producción** (`https://planu-app.web.app`), móvil,
Lighthouse 13.4.0. Todo lo anterior se había medido contra el emulador de
hosting en `localhost` y **no es comparable**.

## Los números

«Antes» es una sola pasada previa a los cambios de rendimiento. «Después» es la
mediana de cinco.

| Métrica | Antes (n=1) | Después (mediana de 5) | Rango |
| --- | --- | --- | --- |
| Performance | 92 | 97 | 93 – 98 |
| LCP | 3,2 s | 1,6 s | 1,4 s – 3,2 s |
| Speed Index | 3,3 s | 3,9 s | 1,7 s – 4,2 s |
| TBT | 11 ms | 0 ms | 0 ms – 25 ms |
| CLS | 0 | 0 | 0 – 0 |

**Los rangos importan más que las medianas.** Con n=1 este proyecto da entre 93
y 98, el LCP oscila entre 1,4 y 3,2 s —el máximo iguala la medida «antes»— y el
Speed Index entre 1,7 y 4,2. **Una sola pasada puede demostrar cualquier cosa.**
Compara siempre medianas de al menos cinco.

## Lo que sí es determinista

Recuentos, no tiempos. Son la evidencia sólida de la mejora:

| | Antes | Después |
| --- | --- | --- |
| Peso total de la página | 390 KiB | **156 KiB** |
| JavaScript sin usar | 130 KiB | **26 KiB** |
| Chunk de Sentry, en crudo | 455 KB | **293 KB** |
| Referencias a Replay / rrweb | 164 / 13 | **0 / 0** |
| `apis.google.com` al arrancar | sí | **no** |

## Qué se cambió

1. **El gate de la observabilidad**, de `requestIdleCallback` a doble
   `requestAnimationFrame`. El primero dispara antes del pintado: los chunks de
   Sentry y Firebase Performance bajaban entre 1142 y 1251 ms con el LCP en
   1481 ms.
2. **Tree-shaking de Sentry.** Las banderas `define` solo bajaron a 433 KB; el
   recorte vino de desestructurar el import — con `import * as Sentry`, Rollup
   conserva el módulo entero.
3. **Resolver de OAuth diferido.** `getAuth()` instalaba el
   `browserPopupRedirectResolver`, que traía gapi y el iframe de autenticación
   —137 KiB de dos orígenes ajenos— en todas las visitas.

No hizo falta el hallazgo de más impacto según la auditoría —un candidato a LCP
estático en el HTML—, que era también el de más riesgo para el CLS.

## Cómo reproducirlo

```bash
npx lighthouse https://planu-app.web.app --output=json \
  --output-path=./informe.json --chrome-flags="--headless=new --no-sandbox" \
  --only-categories=performance --quiet
```

Cinco veces, y compara medianas. Los JSON crudos de esta tanda no se versionan:
1,6 MB para unos números que caben en las tablas de arriba.

Y dos comprobaciones que no son Lighthouse y valen más:

```bash
node scripts/check-startup-cost.js   # orígenes contactados y peso al arrancar
node scripts/verify-sentry.js        # que un error llega con debug IDs
```

## Lo que esta medida no cubre

**Lighthouse mide la pantalla de acceso**, no la aplicación. Los eventos son
privados, así que sin sesión no hay listado. El LCP de un usuario autenticado
—que espera a Auth, a `events-view` y al chunk de Firestore de 561 KiB— **no
está medido**.

Ojo al comparar con medidas posteriores: estas se tomaron cuando la aplicación
vivía en la raíz y Lighthouse acababa en `/login`. Desde T25 la raíz responde
**302 hacia `/app`**, así que el destino real es `/app/login`. Lighthouse sigue
la redirección, pero el salto añade una ida y vuelta que la línea base no
tenía.

**El INP tampoco**: no hay interacción en una pasada de Lighthouse. Lo dirá
Firebase Performance con datos de campo, que se recogen desde el primer
despliegue.
