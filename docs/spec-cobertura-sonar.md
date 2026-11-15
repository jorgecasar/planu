# Spec · Cobertura de tests importada en Sonar

> Cubre GH-244. No sustituye a [`SPEC.md`](../SPEC.md). Es una especificación:
> no cambia código, configuración ni umbrales. Las medidas salen de una copia de
> `origin/main` (commit `db5e95a`), no de suposiciones.

## Objetivo

Que Sonar sepa qué código prueban los tests unitarios, para que el quality gate
deje de fallar por `new_coverage` 0 % frente a 80 % **sin bajar el umbral y sin
excluir ficheros para pasarlo**. El 0 no dice que el código no esté probado, dice
que `sonar-project.properties` no apunta a ningún informe.

Fuera de alcance: ejecutar Sonar en CI (`.github/workflows/ci.yml` no lo ejecuta
y esta spec no lo cambia), subir la cobertura, cubrir `scripts/`.

## Estado actual, medido

Todos los comandos con `TZ=America/Santiago` (lo pone el script `test`), sin
arrancar emuladores ni servidores.

| Medida | Resultado |
| --- | --- |
| `vite.config.ts` ya declara `test.coverage` | proveedor `v8`, reporters `text` y `html`, `include: src/**/*.ts` |
| `@vitest/coverage-v8` | ya es devDependency de `apps/web` (`^4.0.15`), vitest 4.1.10 |
| `@vitest/coverage-istanbul` | **no está** en `node_modules` |
| `npm --prefix apps/web test` | exit 0, 78 ficheros, 941 tests, 8,8 s (9,4 s la primera vez) |
| Mismo comando con `--coverage --coverage.provider=v8 --coverage.reporter=lcov` | exit 0, 941 tests, 15,3 s en caliente; 34 a 41 s la primera vez (caché de dependencias en frío) |
| Con `--coverage.provider=istanbul` | exit 1: `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-istanbul'`. No se probó instalándolo |

**El supuesto del issue es falso: v8 sí funciona en modo browser con Playwright
aquí.** Genera `apps/web/coverage/lcov.info` (`coverage/` ya está en
`.gitignore`, línea 12). Lo único que lo rompió fue un artefacto de mi copia:
con `node_modules` como enlace simbólico fuera de la raíz, Vite no servía
`@vitest/coverage-v8/browser` (`Failed to fetch dynamically imported module`,
exit 1, 4 de 78 ficheros). Con `node_modules` real, en el carril, exit 0.

### Cobertura de líneas, v8

97 ficheros en el informe, **2093 de 2346 líneas: 89,2 %**. Ramas 86,1 %
(1254/1457), funciones 86,6 %. Líneas más ramas, que es lo que combina Sonar:
(2093 + 1254) / (2346 + 1457) = 88,0 %.

| Carpeta (`src/`) | Ficheros | Líneas | % |
| --- | --- | --- | --- |
| `domain` | 19 | 341/343 | 99,4 |
| `application` | 15 | 56/56 | 100 |
| `calendar` | 4 | 192/194 | 99,0 |
| `lib` | 3 | 27/27 | 100 |
| `auth` | 5 | 124/132 | 93,9 |
| `profile` | 3 | 162/174 | 93,1 |
| `sharing` | 7 | 199/223 | 89,2 |
| `events` | 19 | 656/745 | 88,1 |
| `infrastructure` | 15 | 256/370 | **69,2** |
| resto (`app-shell`, `i18n`, `styles`, `landing`, `generated`) | 10 | 80/81 | 98,8 |

Casos peores: `infrastructure/firebase/firebase-provider.ts` 14/74 (19 %);
`ai-model-adapter.ts` 0/5 y `observability.ts` 0/6.

Fuera del informe: `src/main.ts` (55 líneas, excluido en `vite.config.ts`),
`src/generated/locales/es.js` (291) y todo `scripts/` (9 ficheros, 1325 líneas
físicas, sin tests de Vitest).

### Rutas del lcov

El lcov por defecto trae rutas relativas a `apps/web`: `SF:src/app-shell.ts`.
Con `sonar.sources=apps/web/src,scripts` y la base en la raíz del repo, Sonar
buscaría `<raíz>/src/app-shell.ts`, que no existe, y descartaría el informe
(es el modo de fallo silencioso: el gate seguiría en 0). Se resuelve en origen,
sin post-proceso: el reporter `lcovonly` de istanbul-reports acepta
`projectRoot`. Medido con `["lcovonly", { projectRoot: <raíz del repo> }]`:
`SF:apps/web/src/app-shell.ts`, 97 ficheros, mismas 2093/2346 líneas, exit 0.
`vite.config.ts` ya calcula esa raíz (`envDir`).

El `lcov` generado incluye `src/generated/locales/locale-codes.ts`, que
`sonar.exclusions` ya excluye: Sonar lo ignora, no hay que tocar nada.

## Lo que no pude determinar

- **Cómo está definido el código nuevo en Sonar** (versión anterior, número de
  días, rama de referencia) y qué líneas cuenta hoy como nuevas. Hace falta
  leerlo del servidor con el token de kj, que no me corresponde buscar.
  Sin eso no se puede calcular `new_coverage` de hoy: es la cobertura sólo de
  las líneas nuevas respecto de esa referencia, no el 88 % global.
- Si Sonar cuenta como no cubiertas las líneas de ficheros que el informe no
  menciona (`main.ts`, `scripts/`). Es el comportamiento documentado del sensor
  de JS/TS, pero no lo comprobé contra este servidor.
- Si `kj scan`/`kj review` tienen un gancho previo donde ejecutar la cobertura.
- Un fichero de `scripts/` aún sin cubrir arrastra a la baja `new_coverage`
  sólo cuando un PR lo modifica. Cota inferior global si todo `scripts/` contara
  como no cubierto: 2093 / (2346 + 1325 + 55) = 56 % por líneas, una cota
  pesimista porque 1325 son líneas físicas, no ejecutables.

## Opciones

| | Qué | A favor | En contra |
| --- | --- | --- | --- |
| A | v8, `lcovonly` con `projectRoot`, script `test:coverage` local | Cero dependencias nuevas; ya funciona; rutas correctas sin script | +6,5 s sobre la tanda normal; el informe lo genera quien lo ejecute |
| B | istanbul, como pedía el issue | Instrumentación por AST, el más estable en browser mode en general | Dependencia nueva, instrumenta el bundle (más lento), y no resuelve nada que v8 no resuelva aquí |
| C | Generar el lcov en CI y subirlo | Siempre fresco | CI no ejecuta Sonar: nadie lo consume. Añade tiempo a la tanda con emuladores. Hay que tocar `ci.yml`, fuera de esta tarea |
| D | A, más un post-proceso que reescribe `SF:` | Ninguna | `projectRoot` ya lo evita; un script más que mantener |

## Recomendación: A

1. `vite.config.ts`: `reporter: ["text", "html", ["lcovonly", { projectRoot: envDir }]]`
   y excluir `src/generated/**` igual que ya lo hace Sonar. No se excluye ningún
   fichero de producción.
2. `apps/web/package.json`: `"test:coverage": "TZ=America/Santiago vitest run --coverage"`.
   Raíz: `"test:coverage": "npm run test:coverage --workspace @planu/web"`.
   El proveedor sigue siendo `v8`; no se instala nada.
3. `sonar-project.properties`, una línea:
   `sonar.javascript.lcov.reportPaths=apps/web/coverage/lcov.info`
   (la propiedad vale también para TypeScript).
4. `.gitignore`: `coverage/` ya está; no hay que tocarlo.

### Quién lo genera, y el riesgo del informe rancio

`kj review` no ejecuta tests, así que el lcov lo genera una persona (o el agente
que va a lanzar el análisis) con `npm run test:coverage` justo antes de `kj scan`.
Un lcov viejo es peor que no tener ninguno: Sonar lo cruza con líneas que ya
cambiaron y da un porcentaje falso, en cualquiera de los dos sentidos. Mitigación:
`scripts/check-coverage-fresh.js`, sin dependencias, sale con 1 si
`apps/web/coverage/lcov.info` no existe o es más antiguo que el último cambio de
`apps/web/src/**` (mtime) y dice qué ejecutar. Se encadena como
`npm run test:coverage && kj scan`, o, si kj lo permite, como gancho previo
(ver preguntas). No se commitea el lcov.

## El umbral del 80 %

Sobre las cifras medidas, **sí es alcanzable en conjunto**: 88 % líneas más
ramas. Pero `new_coverage` se mide sobre las líneas que cambia cada PR, y eso
varía mucho por zona: `domain/` y `application/` están al 99 a 100 %, mientras
que `infrastructure/` está al 69 % y `firebase-provider.ts` al 19 %. Un PR que
toque ese adaptador sin añadir tests caerá por debajo de 80 %, y con razón.
Cualquier PR que modifique `scripts/` o `main.ts` parte de 0 % en esas líneas.

Recomiendo **mantener el 80 %** (el issue prohíbe bajarlo). No lo puedo verificar
contra el periodo de código nuevo real: ver «Lo que no pude determinar» arriba.
El primer lcov importado dará el número exacto; si el gate sigue en rojo, el
paso siguiente son tests para las líneas nuevas, no tocar el umbral.

## Tareas (PR de ≤ 200 líneas cada una)

1. **Configurar y medir** (~25 líneas): reporter `lcovonly` con `projectRoot`,
   exclusión de `generated`, los dos scripts `test:coverage`, la línea de
   `sonar-project.properties`. Verificación: `npm run test:coverage` exit 0;
   `grep -c '^SF:apps/web/src/' apps/web/coverage/lcov.info` = 96 (97 menos `generated`); un
   `kj scan` posterior muestra cobertura distinta de 0 en `domain/`.
2. **Guarda de frescura** (~60 líneas): `scripts/check-coverage-fresh.js` y su
   test (rompe a propósito: tocar un fichero de `src/` tras generar y comprobar
   exit 1).
3. **Documentar** (~30 líneas): `AGENTS.md`, sección «Comandos»: `test:coverage`,
   orden con `kj scan`, por qué no se commitea y qué hacer si Sonar sigue en 0
   (comprobar `SF:` y el aviso de rutas sin resolver del scanner).
4. **Según el primer resultado** (cada una ≤ 200 líneas, una por adaptador):
   tests para `firebase-provider.ts`, `ai-model-adapter.ts` y `observability.ts`
   si el gate sigue en rojo por líneas nuevas ahí.

## Riesgos

- Informe rancio: ver arriba; la guarda lo cubre sólo si se usa.
- `projectRoot` incorrecto o `reportPaths` mal escrito: Sonar no falla, importa
  0 y el gate sigue igual. Se detecta con el `grep` de la tarea 1.
- Dependencia de la TZ: `test:coverage` debe llevar el `TZ=` igual que `test`.
- Tiempo: +6,5 s en caliente (+74 %); en frío 34 a 41 s. No entra en CI.
- `scripts/` sin cobertura, ver preguntas.
- Optimización de dependencias de Vite (AGENTS.md, «paso de emuladores
  colgado»): si el job se cuelga, reintentar, no depurar.

## Preguntas abiertas

1. **¿Dónde se ejecuta?** Recomiendo sólo en local (A), antes de `kj scan`: CI
   no ejecuta Sonar, y generarla allí no la consume nadie.
2. **¿Qué hacer con `scripts/`?** Recomiendo dejarlo en `sonar.sources`, sin
   excluir (así el gate es honesto) y asumir que un PR que lo toque necesita
   tests propios. Alternativa: extraer lógica de los scripts a módulos con tests
   de Vitest cuando se modifiquen. Quitarlo de `sonar.sources` sería excluir
   ficheros para pasar el gate.
3. **¿Se acepta el 80 % sobre código nuevo?** Recomiendo sí, mantenerlo.
4. **¿Puede `kj` ejecutar `npm run test:coverage` antes de `kj scan`?** Si sí,
   se elimina el riesgo de informe rancio; si no, la guarda de frescura lo
   cubre. Necesito que lo confirmes.
5. **¿Cómo está definido el código nuevo en Sonar?** Necesito ese dato (ver
   «Lo que no pude determinar») para predecir el primer `new_coverage`.

## Decisiones del responsable (2026-11-15)

Respuestas del responsable a las preguntas 1 a 3, que sustituyen a mis recomendaciones donde difieren:

1. **¿Dónde se genera el informe?** «También en el CI». No es la recomendación A (solo local). Pasa a **A + C**: `npm run test:coverage` se ejecuta en local antes de `kj scan` **y** el CI genera el lcov.
   - Consecuencia que esta decisión no resuelve: el CI no ejecuta Sonar y el SonarQube del proyecto corre en local (Docker), así que un lcov generado en CI no llega solo a Sonar. Hay que decidir cómo se consume, y es una decisión nueva:
     - (i) subirlo como artefacto del job, solo para verlo o descargarlo (no lo lee Sonar);
     - (ii) añadir un paso de Sonar al CI, lo que exige un servidor alcanzable desde GitHub (SonarCloud o un servidor propio con runner autoalojado), el secreto `SONAR_TOKEN` y un cambio en `ci.yml`;
     - (iii) usar el lcov del CI solo como umbral propio de cobertura en el job, sin Sonar.
   - Hasta que el responsable elija, la tarea 1 (configurar y medir en local) puede hacerse sin tocar `ci.yml`, y el cambio de CI queda como tarea aparte.
2. **`scripts/`:** se queda en `sonar.sources`, sin excluir. Cuando una PR modifique un script, se extrae su lógica a un módulo con tests de Vitest en esa misma PR. No se hace una limpieza masiva.
3. **Umbral:** se mantiene el 80 % sobre código nuevo.

Las preguntas 4 y 5 (si `kj` puede ejecutar `test:coverage` antes de `kj scan`, y cómo se define el código nuevo en Sonar) son técnicas y no necesitan al responsable: las resuelve quien implemente la tarea 1 con la configuración de `kj` y del servidor.
