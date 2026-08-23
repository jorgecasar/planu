# Spec: flujo único de creación de evento

Amplía [`spec-fase-2.md`](spec-fase-2.md), que introdujo la generación por IA
como un modal aparte (`planu-ai-event-generator`) accesible desde un
desplegable «Nuevo evento». Este documento fusiona ambos caminos en uno.

## Objetivo

Hoy crear un evento empieza en un desplegable —«Crear manualmente» / «Generar
con IA»— que abre uno de dos diálogos distintos según la elección. Eso falla
en dos cosas:

1. **Una decisión antes de ver nada.** Quien no sabe si la IA le va a servir
   tiene que elegir a ciegas entre dos rutas antes de ver un solo campo del
   formulario.
2. **Dos diálogos que hacen lo mismo al final.** Los dos terminan en el mismo
   editor con los mismos campos; la única diferencia es quién los rellenó
   primero.

**Éxito** = pulsar «Nuevo evento» abre siempre el mismo formulario. Si la IA
está disponible, arriba del todo puede rellenarlo por ti a partir de una
imagen o de un texto; si no lo está, o si se prefiere no usarla, los campos
están ahí igual, vacíos y listos para escribir.

## Alcance

### Dentro

- Un único botón «Nuevo evento» en la barra de herramientas de
  `events-view.ts`: nunca un desplegable, haya o no IA disponible.
- El bloque «Rellenar con IA» (imagen / texto) pasa a vivir **dentro** del
  propio `event-editor.ts`, arriba del formulario, sólo al crear un evento
  nuevo (no al editar uno existente) y sólo mientras no haya nada generado
  o escrito todavía.
- Un enlace o acción explícita para descartar el bloque de IA y pasar al
  formulario vacío sin usarlo.
- El modal separado `planu-ai-event-generator` deja de abrirse como diálogo
  propio; su lógica de generación (sesión del modelo, extracción desde
  imagen y desde texto, subida de la portada) se reutiliza tal cual, sólo
  cambia dónde se monta.
- Actualizar `events-view.ts`: retirar `wa-dropdown`, `generatorOpen` y el
  cableado que hoy abre el generador como diálogo aparte.

### Fuera, y por qué

- **`empty-state.ts` (T33).** Sigue con sus tres botones —manual, IA,
  evento de ejemplo— sin cambios en su interfaz. Sólo cambia, dentro de
  `events-view.ts`, que sus dos primeros wiring (`planu-create-event` y
  `planu-open-generator`) abren ahora el mismo editor: es el propio editor
  quien decide si ofrece IA arriba, no quien lo abre. Es una consecuencia
  aceptada, no un objetivo de este documento; si algún día conviene que el
  botón de IA del estado vacío se comporte de otro modo, se replantea
  aparte.
- **Cambios en la lógica de generación en sí** (qué modelo, qué prompt, qué
  errores). Se traslada de sitio, no se toca.
- **El evento de ejemplo** (`sampleEventDraft()`), que sigue entrando por
  `draft`/`draftSource`/`isSample` exactamente como hoy.

## Decisiones tomadas

| Decisión | Elección |
| --- | --- |
| Punto de entrada | Un único botón, sin desplegable, siempre |
| Dónde vive la oferta de IA | Dentro de `event-editor.ts`, arriba del formulario, no en un diálogo aparte |
| Cuándo se muestra | Sólo al crear (no al editar) y sólo antes de que haya un borrador |
| Sin IA disponible | El formulario vacío directamente, sin ningún bloque de IA — igual que hoy cuando `aiAvailable` es `false` |
| Disponibilidad de IA | Se reutiliza el `aiAvailable` que `event-editor.ts` ya calcula en `willUpdate()`/`#refreshAiAvailability()` para las etiquetas sugeridas; no se duplica la comprobación |
| `empty-state.ts` | Sin cambios en su interfaz ni en su spec (T33) |

## Interfaz

**Barra de herramientas** (`events-view.ts`): `<wa-button variant="brand">`
con el texto «Nuevo evento», sin `wa-dropdown` ni `wa-dropdown-item`. Al
pulsarlo, abre `planu-event-editor` sin `event` ni `draft`.

**Editor, creando un evento nuevo, con IA disponible:** el diálogo se abre
mostrando arriba el bloque de IA (subir imagen / pegar texto) con un enlace
«Escribir a mano» debajo, y el formulario ya presente detrás. Al generar, el
bloque desaparece y los campos quedan rellenados para revisar — mismo
comportamiento que hoy tiene el modal aparte, sólo que sin cerrar un diálogo
para abrir otro. Al pulsar «Escribir a mano», el bloque desaparece sin haber
generado nada y el formulario queda vacío.

**Editor, creando un evento nuevo, sin IA disponible, o editando uno
existente:** el formulario aparece directamente, sin ningún bloque de IA
encima — igual que hoy.

**Al guardar:** sin cambios de comportamiento — `event-editor.ts` ya escribe
a través de `EventRepositoryPort` y `events-view.ts` ya escucha el snapshot
en vivo de Firestore (`eventsContext`), así que el evento nuevo aparece en el
listado sin recargar. Este documento no toca esa ruta; sólo hay que
confirmarlo con un e2e existente o nuevo, no asumirlo.

## Estrategia de tests

- **Unitarios de componente** (Vitest en Chromium real, como ya cubren
  `event-editor.test.ts` y `ai-event-generator.test.ts`):
  - El bloque de IA aparece al crear con `aiAvailable = true` y no aparece
    al editar, ni sin IA, ni tras generar o escribir algo.
  - «Escribir a mano» retira el bloque sin cerrar el diálogo ni perder el
    formulario.
  - Generar desde imagen y desde texto sigue rellenando los mismos campos
    que hoy prueba `ai-event-generator.test.ts`, ahora montado dentro del
    editor.
- **`events-view.test.ts`** (si no existe, se crea): el botón «Nuevo evento»
  nunca es un desplegable, ni con IA disponible ni sin ella; un evento
  guardado aparece en el listado sin recargar.
- **E2e** (`e2e/*.spec.ts`): el recorrido completo — abrir con el botón único,
  generar con IA o escribir a mano, guardar, verlo en el listado — y axe
  sobre el nuevo estado del diálogo.

## Criterios de éxito

1. La barra de herramientas nunca muestra un desplegable para crear un
   evento, con IA disponible o sin ella.
2. Con IA disponible, el formulario se abre ofreciendo imagen o texto arriba
   y permite ignorarlo y escribir a mano sin cerrar el diálogo.
3. Sin IA disponible, el formulario se abre vacío directamente, sin ningún
   rastro de la oferta de IA.
4. Generar desde imagen o desde texto sigue funcionando igual que hoy,
   dentro del editor.
5. Un evento recién creado aparece en el listado sin recargar la página.
6. Cero violaciones de axe en el diálogo, con y sin el bloque de IA.
7. `npm run lint`, `npm run typecheck`, `npm run lint:lit`, `npm test` y
   `npm run test:e2e` limpios.

## Riesgos

| Riesgo | Mitigación |
| --- | --- |
| `ai-event-generator.ts` está pensado como diálogo propio (`wa-dialog`, `open`, sus propios `willUpdate`/warm-up) y montarlo inline puede arrastrar supuestos de ese ciclo de vida | Revisar su `render()`/`willUpdate()` al moverlo; los tests de componente existentes son el oráculo de que la generación se sigue comportando igual |
| Al fusionar, `events-view.ts` deja de necesitar `generatorOpen`, pero `draft`/`draftSource`/`draftIsSample` los sigue necesitando para el evento de ejemplo — fácil dejar código muerto o un estado a medio migrar | El `code-reviewer` revisa explícitamente que no quede `generatorOpen` ni el `wa-dropdown` residual |
| El wiring de `empty-state.ts` (`planu-open-generator`) queda apuntando a algo que ya no abre un diálogo aparte | Verificado en la sección «Fuera, y por qué»: ambos caminos abren el mismo editor a propósito, no es un descuido |

## Preguntas abiertas

1. **¿El botón de IA de `empty-state.ts` deja de tener sentido como botón
   aparte** si termina abriendo exactamente lo mismo que «Crear tu primer
   evento»? Fuera de alcance aquí (ver «Fuera, y por qué»), pero conviene
   registrarlo para cuando se revise `empty-state.ts`.
2. **Nombre del componente que hoy es `ai-event-generator.ts`.** Deja de ser
   un «generador» con diálogo propio para ser un bloque embebido; renombrarlo
   no es necesario para que funcione, pero el nombre actual podría confundir
   en revisiones futuras. Resuelto en `/plan`: se mantiene el nombre — evita
   tocar la lista de excepciones de `biome.json` y los comentarios de
   `arch/boundary.test.ts` sin ningún beneficio funcional.
