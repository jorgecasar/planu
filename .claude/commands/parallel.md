Ejecuta en paralelo todo el trabajo del repo que se pueda verificar
automáticamente, siguiendo el ciclo de vida y la disciplina de loops que
`AGENTS.md` marca como obligatorios.

## Reparto

**En paralelo, uno por worktree, sin supervisión** — su oráculo son funciones
puras con tests unitarios y NO necesitan emuladores:

- T18 · normalización de etiquetas
- T19 · orden y agrupación
- T22 · export `.ics`
- T20 · rejilla mensual — sólo cuando T19 esté fusionada

**En serie y con persona delante** — no los arranques sin pedirlo:

- T36, T37, T38, T39 · migración a puertos. Cambian comportamiento.
- Cualquier cosa que toque `firestore.rules` o `storage.rules`.

## La restricción que de verdad limita el paralelismo

Los emuladores usan los puertos **9099, 8181 y 9199**, fijados en
`firebase.json`. **Un worktree separa ficheros, no puertos.** Dos agentes
ejecutando `test:rules` o `test:e2e` a la vez se bloquean entre sí; ha pasado
dos veces.

Por eso el reparto de arriba: esas cuatro tareas son paralelizables
*precisamente* porque se verifican con `lint`, `typecheck`, `test:arch`,
`build` y unitarios de navegador, sin emuladores. Antes de fusionar,
**serializa** una única pasada completa con emuladores.

Si un puerto está ocupado, espera. No cambies los puertos: están replicados en
`src/infrastructure/firebase/config.ts`.

## Verificación, y esto no es negociable

1. **Comprueba el código de salida, no la salida.**
   `cmd >/dev/null 2>&1 || exit 1`. Leer «tests passed» en un texto no es
   verificar.
2. **Rompe cada test a propósito y comprueba que falla.** Un test que no puede
   fallar es peor que ninguno.
3. **Nunca `biome check --write` a ciegas**: hay autofixes marcados como seguros
   que borran código en uso.
4. El tope de ficheros acoplados que asserta `apps/web/arch/boundary.test.ts`
   **sólo puede bajar**.

## Maker ≠ checker

Al terminar cada tarea, y antes de abrir la PR, lanza un subagente
`code-reviewer` distinto sobre el diff. Dile qué sospechas tú del cambio.
Aplica lo crítico e importante; discute lo demás en la PR.

Quien escribe no juzga. En la sesión que originó este comando, el checker
encontró cuatro huecos que el autor no vio, incluido un vigilante que quedaba
en verde al borrar la regla que vigilaba.

## Entrega

- Una rama por tarea, desde `main`.
- **Un solo commit por PR**, aplastado antes de abrirla. Conventional Commits
  en inglés; el cuerpo explica el *porqué*, no el *qué*.
- Marca la casilla en `tasks/todo.md` en el mismo commit.
- No fusiones: eso lo hace una persona.

## Estado

`tasks/todo.md` es la memoria compartida y **ya ha derivado una vez**: una
fusión borró cinco tareas sin que nadie lo notara. Antes de coger nada,
comprueba contra el código que lo marcado como hecho lo está, y que no faltan
identificadores en la secuencia.

Lee primero `AGENTS.md`, `docs/spec-fase-2.md` y
`docs/spec-arquitectura-hexagonal.md`.

## Para y pregunta si

- Una tarea resulta necesitar decisiones de diseño o de interfaz.
- Hay que tocar reglas de seguridad, facturación o borrado de datos.
- El oráculo no es binario: si no puedes demostrar que está bien, no lo cierres.

---

**Sobre el techo real.** El límite no son los agentes sino el tiempo de
revisión: lanzar agentes es barato, leer sus PR no se paraleliza. Con cuatro
tareas automatizables, un loop secuencial las cubre todas sin saturar a nadie.
