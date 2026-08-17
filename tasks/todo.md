# Tareas — fase 2

Derivadas de [`plan.md`](plan.md). Orden por dependencia, no por importancia.
Las tareas de la fase 1, completadas, están en [`fase-1/todo.md`](fase-1/todo.md).

Numeración continuada: la fase 1 llegó hasta T10.

## Fase 5 — Precondiciones y decisiones

- [x] **T11 · Java, emuladores y hosting local** · XS · sin dependencias
  - Acepta: `java -version` responde; `npm run emulators` arranca auth,
    firestore, storage **y hosting**; `npm run test:rules` pasa con los tests
    que ya existen.
  - Verifica: `npm run test:rules` → **19/19 en verde**
  - Resultado: no hizo falta instalar nada. `openjdk` ya estaba en Homebrew,
    sólo es *keg-only* y le faltaba el PATH. `firebase.json` ya declara el
    emulador de hosting en el 5050 y `npm run emulators` los arranca todos.
    Pendiente **del usuario**, fuera del repo:
    `export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"` en `~/.zshrc`.

- [x] **T12 · ADR 0006 y 0005, y la decisión de «salir de un evento»** · S · sin dependencias
  - Acepta: ADR 0006 registra la compartición por invitados con rol y que
    supersede parcialmente al 0002; ADR 0007 registra por qué el directorio de
    usuarios vive en el cliente y no en Cloud Functions; **ambos dejan escrito
    si un usuario puede quitarse a sí mismo de `memberIds`**, porque T13 depende
    de ello.
  - Verifica: revisión humana; coherencia con `docs/spec-fase-2.md`
  - Ficheros: `docs/adr/0004-*.md`, `docs/adr/0005-*.md`, `docs/adr/0002-*.md`
  - Resultado: **decidido que sí** — un usuario puede quitarse a sí mismo y sólo
    a sí mismo; el dueño no puede irse del suyo. Antes de decidirlo se sondeó el
    emulador para confirmar que el lenguaje de reglas puede expresarlo:
    `List.removeAll()`, `Map.diff().affectedKeys()` y `hashing.sha256()`
    existen y funcionan. Eso cierra además dos preguntas abiertas del spec.

## Fase 6 — Modelo de datos y reglas

- [x] **T13 · Esquema y reglas de compartición** · M · depende de T11, T12
  - Acepta: el esquema Zod gana `memberIds`, `roles`, `tags` y `createdAt`; las
    reglas incorporan `isMember`, `isEditor` y `membershipUnchanged`, con **una
    única regla `allow` por operación** y un tope de invitados por evento.
  - Verifica: `npm run test:rules` con los casos que **deniegan** escritos
    antes que la regla — editor que se asciende, editor que se queda la
    propiedad, extraño que lee, usuario que se autoañade.
  - Ficheros: `firestore.rules`, `apps/web/rules/firestore.test.ts`,
    `apps/web/src/lib/types.ts`
  - **Corrección del registro (T18).** Esta entrada afirmaba que el esquema
    ganaba también `tags`, y no era cierto: no existía ni en `eventSchema()` ni
    en el `hasOnly` de `isValidEvent()`, así que un evento con etiquetas lo
    habrían rechazado las reglas. Lo entrega T18, que es donde tiene sentido:
    aquí no había nada que etiquetase. Se deja escrito en vez de reescribir la
    entrada porque la deriva entre esta lista y el código ya ha costado una vez.

- [x] **T14 · Membresía al crear y consulta por membresía** · M · depende de T13
  - Acepta: el editor crea con `memberIds: [uid]` y `roles: {}`; el listado pasa
    de `where('userId','==',uid)` a `array-contains`.
  - Verifica: **25/25 e2e en verde**, sin regresiones.
  - Ficheros: `src/events/event-editor.ts`, `src/events/events-view.ts`
  - Resultado y dos desviaciones del plan:
    1. **No hace falta índice compuesto.** La consulta no lleva `orderBy`, y
       `array-contains` a secas se resuelve con el índice automático de un solo
       campo. `firestore.indexes.json` se queda como está. Cuando T19 añada
       ordenación, ahí sí hará falta.
    2. **Al editar ya no se reenvía el `userId`.** Antes se fijaba siempre al
       uid de la sesión; con invitados eso le costaría el permiso a un editor,
       porque para las reglas equivale a transferirse la propiedad. Ahora sólo
       viaja el contenido, y la propiedad y la membresía sólo se fijan al crear.
  - **Backfill: no entregado, y es deliberado.** Requiere `firebase-admin`
    (dependencia nueva, cae en «preguntar primero») y, antes de eso, saber si la
    base `planu` tiene documentos heredados — la pregunta abierta nº 1 del
    `SPEC.md`, que sigue sin comprobarse. Sin ese dato no se puede decidir entre
    migrar o descartar. **Bloquea el despliegue, no el desarrollo.**

> **Checkpoint A** — la aplicación hace exactamente lo mismo que antes, con el
> modelo nuevo. Aburrido a propósito: es como se sabe que nada se rompió antes
> de construir encima. Revisión humana de `firestore.rules`.

## Fase 7 — Compartir

- [x] **T15 · Directorio de usuarios (F1)** · M · depende de T13
  - Acepta: `userDirectory/{sha256(email)}` con `uid`, `displayName` y
    `photoURL`; se escribe al autenticarse; las reglas permiten `get` pero **no
    `list`**, exigen `hasOnly` de esos tres campos y atan el documento al email
    del token.
  - Verifica: **lo primero, confirmar en el emulador que
    `hashing.sha256().toHexString()` existe en reglas de Firestore**; si no,
    aplicar el plan B del spec. Después, test de reglas del intento de escribir
    en el hash de otra persona, y unitario del hash.
  - Ficheros: `src/sharing/user-directory.ts` + test, `firestore.rules`,
    `apps/web/rules/firestore.test.ts`, `src/firebase/firebase-provider.ts`

- [x] **T16 · Diálogo de compartir (F2)** · M · depende de T15
  - Acepta: `roleFor`, `canEdit` y `canShare` como funciones puras; diálogo para
    invitar por email, cambiar rol y expulsar; mensaje claro y enlace de registro
    cuando el email no tiene cuenta.
  - Verifica: unitarios de permisos; e2e con dos sesiones contra el emulador
  - Ficheros: `src/sharing/permissions.ts` + test, `src/sharing/share-dialog.ts`,
    `src/events/event-card.ts`

- [x] **T17 · Bandeja «compartidos conmigo» (F3)** · M · depende de T16
  - Acepta: conmutador entre todos, míos y compartidos; cada tarjeta compartida
    dice de quién es y con qué rol; a un lector no se le ofrecen editar ni
    borrar.
  - Verifica: e2e con dos sesiones y axe
  - Ficheros: `src/events/events-view.ts`, `src/events/event-card.ts`,
    `src/events/event-filters.ts`

> **Checkpoint B** — dos usuarios reales con permisos distintos, verificados por
> las reglas y no por la interfaz.

## Fase 8 — Organización

- [x] **T18 · Etiquetas (F6)** · M · depende de T13
  - Acepta: de cero a diez etiquetas, normalizadas (recortadas, en minúsculas,
    sin duplicados, máximo 24 caracteres); autocompletado con las ya usadas;
    filtro que combina varias con **Y**; color estable derivado del nombre.
  - Verifica: unitarios de normalización y de filtrado combinado
  - Ficheros: `src/domain/tags.ts` + test, `src/domain/filter-events.ts`,
    `src/events/event-editor.ts` + test, `src/events/event-filters.ts` + test,
    `src/events/event-card.ts`, `src/events/events-view.ts`,
    `src/lib/types.ts` + test, `firestore.rules`,
    `apps/web/rules/firestore.test.ts`, `apps/web/e2e/events.spec.ts`
  - Resultado, y cuatro cosas que conviene saber:
    1. **`tags.ts` vive en `domain/`**, no en `events/` como decía esta lista:
       es la misma clase de módulo que `filter-events.ts`, y esta entrada se
       escribió antes de T35.
    2. **Hubo que tocar `firestore.rules`**, con persona delante. `tags` entra
       en el `hasOnly` de `isValidEvent()` pero **no** en el `hasAll`: todo
       evento anterior a F6 carece del campo y exigirlo lo dejaría ineditable.
    3. **El lenguaje de reglas no tiene bucles**, así que la longitud de cada
       etiqueta no se puede comprobar ahí: se acota el agregado, que es lo que
       de verdad acota el coste. Y `join` **no** falla ante un número, lo
       convierte — lo dio por bueno un comentario y lo desmintió un test. El
       tipo se comprueba con una ida y vuelta `join`/`split`.
    4. **Normalizar rechaza en vez de truncar** lo que pasa de 24 caracteres:
       truncar le deja al usuario una etiqueta que él no escribió.
  - Verificado: 128 unitarios y 135 de reglas en verde, con `lint`,
    `typecheck`, `lint:lit`, `test:arch` y `build` en 0 comprobado con `$?`.
    **15 mutaciones sobre `tags.ts`, 6 sobre `firestore.rules` y 3 sobre el
    filtrado, todas detectadas.** Una mutación destapó que el test de prioridad
    por prefijo no podía fallar —el orden alfabético daba ya el mismo
    resultado— y se reescribió.
  - **Corregido en revisión** (un revisor distinto del autor, cinco hallazgos):
    1. `?checked` **no controla** una `wa-checkbox`: su atributo mapea a
       `defaultChecked`, así que «Borrar filtros» desfiltraba el listado y
       dejaba las casillas pintadas como marcadas. Va `.checked` con `live()`,
       más `repeat()` con clave, porque `availableTags` se reordena sola al
       crear un evento y sin clave la casilla marcada de una etiqueta acababa
       rotulando otra.
    2. **Las tres capas medían «24 caracteres» en unidades distintas.** El
       `size()` de las reglas y el `maxlength` del campo cuentan unidades
       UTF-16; sólo `normalizeTag` contaba puntos de código, y diez etiquetas
       de 24 emojis —válidas para él— sumaban 489 y las reglas las denegaban
       con un error mudo. Ahora las tres miden lo mismo.
    3. **Fuera el atajo de la coma en el editor**: una etiqueta puede llevar
       coma —el dominio y las reglas la aceptan, y por eso el separador de la
       ida y vuelta es el salto de línea—, así que tratarla como separador
       prohibía en silencio un valor legítimo.
    4. El borrado que trae `wa-tag` sale con `tabindex="-1"`: **quien navega
       con teclado no podía quitar una etiqueta puesta por error**. Lleva
       control propio. Axe no lo habría detectado.
    5. Fuera el bloque `prefers-color-scheme`: era el único del repo y la
       aplicación no tiene tema oscuro, así que pintaba chips negros dentro de
       una tarjeta clara.
  - Contraste **medido**, no supuesto: recorriendo los 360 tonos, el peor caso
    es 8,03:1 en claro, muy por encima del 4,5:1 de AA. Es consecuencia de que
    el hash decida sólo el tono y nunca la luminosidad.
  - **Cerrado el hueco de e2e**, que esta entrada llegó a declarar pendiente:
    hay cinco e2e nuevos —normalización al guardar, filtro combinado con **Y**,
    que «Borrar filtros» deja las casillas desmarcadas, borrado de una etiqueta
    con teclado, y axe sobre el listado y sobre el campo del editor—. **39 e2e
    en verde.**
  - **Y encontraron una violación real de accesibilidad que ninguna revisión
    vio**: las etiquetas del editor se pintaban con el neutro por defecto de
    Web Awesome —4,42:1, por debajo del 4,5:1 de AA— porque los colores por
    tono vivían sólo en la tarjeta. Ahora el estilo se comparte en
    `src/events/tag-styles.ts`. Es el argumento entero a favor de no dar por
    cerrado lo que no tiene oráculo.
  - **Segunda ronda, tras `/ship`** (tres especialistas; GO con hallazgos).
    Nueve arreglos, y el patrón de los cuatro primeros es el mismo: un test que
    no podía fallar o un comentario que afirmaba lo que nadie había comprobado.
    1. **El autocompletado moría a partir de la undécima etiqueta conocida.**
       `suggestTags` saneaba el vocabulario del usuario con `normalizeTags`, que
       corta en `MAX_TAGS` porque es el saneador **de un evento**: con quince
       etiquetas conocidas, «viaje» dejaba de sugerirse aunque estuviese. Va
       `cleanTags`, que normaliza y deduplica sin acotar cardinalidad. Lo
       enmascaraban dos tests que pasaban veinte etiquetas y sólo miraban
       `toHaveLength`: diez supervivientes los satisfacían igual. Ahora afirman
       el contenido y la entrada va en orden inverso, así que un corte por
       delante cambia la respuesta.
    2. **`tags` no admitía la clave ausente**: en Zod 4 un `z.unknown()` pelado
       acepta `undefined` pero no que falte, justo lo que traen los eventos
       anteriores a F6. Funcionaba de rebote porque `toEvent` enumera la clave a
       mano. Va `.optional()`, y `src/lib/types.test.ts` estrena los tests del
       esquema, que no tenía ninguno.
    3. **Una etiqueta seleccionada que dejaba de existir seguía filtrando,
       invisible.** El filtro pintaba sólo `availableTags`, así que quitarle la
       etiqueta al último evento que la llevaba borraba la casilla del DOM con
       el filtro puesto: listado vacío para siempre y nada marcado que lo
       explicase. Se pinta la unión con lo seleccionado, en vez de podar y
       reemitir, porque podar ensancha el resultado sin que el usuario lo pida.
    4. **El comentario del e2e afirmaba un acotado que no estaba puesto.** Ya lo
       está: la cadena son cuatro saltos de shadow DOM y va **anidada**, porque
       con el array plano axe acota a nada y devuelve cero violaciones sobre
       cero elementos sin protestar (medido: 0 reglas aprobadas frente a 21).
       De ahí que el test afirme además `passes.length > 0`.
    5. **Identificadores en inglés.** `salida`, `entrada`, `puestas`,
       `porPrefijo`, `clase`, `etiqueta` y `contenido` eran los únicos en
       español de todo `src/**/*.ts`. Los comentarios se quedan en español.
    6. **`event-editor.ts` y `event-filters.ts` estrenan unitarios**: 192 líneas
       nuevas habían llegado con cero tests montados pese a que el `mount()` ya
       existía. Diez y siete tests respectivamente, todos sin emulador.
    7. **El comentario de la clave de `repeat()`** atribuía a la clave un fallo
       de rotulación que nadie pudo reproducir —`live()` y los *bindings* ya lo
       reaplican— y la mutación sobrevivía. Ahora afirma lo que sí se rompe sin
       ella, la retención del foco al reordenar, con su test.
    8. **Menores:** el contenido de `#renderTagList` se tipa con el
       `TemplateResult` de lit y no con `unknown`, que admitía una función
       `void`; añadir una etiqueta ya no borra un aviso ajeno como el de la
       portada; y `willUpdate` reacciona también a `event` y `draft` — hoy no
       hay ruta que lo provoque, pero cuesta nada y cierra la trampa.
    9. **Tres huecos de reglas que pedía el auditor**: el conjunto escribible
       por un editor queda fijado en `{title, description, location, startDate,
       endDate, imageUrl, tags}` **leyendo el `hasOnly` del propio fichero de
       reglas**, de modo que ampliarlo sin clasificar el campo nuevo pone la
       suite en rojo; `tags` no puede viajar montado en las dos rutas de
       consentimiento ni en una escritura de membresía, cada denegación con su
       control que pasa; y el tope agregado se prueba en el borde, 280 pasa y
       281 deniega. `isValidTags` **no se relajó**.
  - **Un hallazgo que sólo apareció mutando**: borrar
    `memberIds == memberIds` de `changesContentOnly()` dejaba los 88 tests de
    `firestore.test.ts` en verde, porque toda otra forma de tocar `memberIds`
    muere antes en `isValidMembership()` o en la cláusula de `roles`. La única
    escritura que llega a esa cláusula y a nada más es **reordenar** la lista, y
    es la que la fija ahora.
  - Verificado en esta ronda: **152 unitarios en 16 ficheros, 143 de reglas y
    40 e2e**, con `lint`, `typecheck`, `lint:lit` y `test:arch` en 0 leídos de
    `$?`. **14 mutaciones sobre el código de cliente, 9 sobre `firestore.rules`
    y 3 sobre el e2e**: las 26 mueren, y en el test que dicen fijar. El tope de
    23 ficheros acoplados no se movió.

- [x] **T19 · Orden y agrupación (F7)** · S · depende de T13
  - Acepta: orden por fecha de inicio, título o creación; separación entre
    próximos y pasados con los pasados plegados; los eventos sin fecha en su
    propio grupo, con la misma semántica que ya usa `filterEvents`; preferencia
    recordada.
  - Verifica: unitarios de ordenación con empates y eventos sin fecha
  - Ficheros: `src/events/sort-events.ts` + test, `src/lib/view-preferences.ts`,
    `src/events/events-view.ts`
  - Resultado: el módulo puro vive en **`src/domain/sort-events.ts`**, no en
    `src/events/`: es la misma clase de módulo que `filter-events.ts` y T35 ya
    fijó `domain/` como su sitio. Desempate por título y **siempre ascendente**,
    también en descendente. Lo que no tiene clave —sin `createdAt`, sin
    fechas— va al final en las dos direcciones. Grupos en orden fijo (próximos,
    sin fecha, pasados) y sólo lo pasado se pliega; la apertura del pliegue
    **no** se recuerda, sólo el criterio de orden.
  - Resultado (tras revisión): el pliegue de pasados **sí se abre** cuando es el
    único grupo con contenido o cuando el usuario ha buscado o filtrado por
    fechas; plegarlo siempre dejaba una búsqueda que sólo casa con pasados
    enseñando cero tarjetas y ningún mensaje. La decisión es la función pura
    `shouldRevealPast`. El pintado de los grupos se separó a
    **`src/events/event-groups.ts`**, sin Firebase, que es lo que le da oráculo
    automático a lo que antes no lo tenía: `events-view` no se puede montar en
    un test sin emuladores. Los `value` del selector salen de `sortOptions()` en
    el dominio y ya no hay literales `"startDate:asc"` en la plantilla; la
    preferencia guardada se valida contra lo que el selector sabe pintar.
    Encabezados: `h2` por grupo y `h3` por tarjeta (antes `h2`, que dejaba al
    evento hermano de su grupo), y el `h2` de pasados va fuera del `wa-details`
    porque su `<summary>` lleva `role="button"` y ARIA vuelve presentacionales a
    los hijos de un botón. `DEFAULT_SORT` es `as const satisfies` en vez de
    `Object.freeze`: el fallo se quiere en compilación.

  - **Corregido en revisión** (un revisor distinto del autor eligió sus propios
    mutantes y **sobrevivieron 7 de 13**, pese a los «16 de 16» que reportaba la
    primera entrega):
    1. **La noción de «consulta explícita» estaba duplicada y las dos copias
       discrepaban** justo en las etiquetas, que T18 acababa de aterrizar. Pulsar
       la etiqueta «música» y escribir «música» —misma intención, mismos
       resultados— abrían o no el pliegue de pasados según cuál usaras. Ahora es
       `isNarrowed()` en `domain/`, una sola definición y con tests.
    2. **Los tests del componente eran ciegos al pintado y al árbol de
       accesibilidad.** `querySelectorAll` encuentra un nodo aunque su contenedor
       esté en `display: none` y aunque lleve `aria-hidden`: dos mutantes que
       ocultaban la rejilla y sacaban los encabezados del árbol dejaban la suite
       verde. Ahora se comprueba `checkVisibility()` y se ignoran los
       `aria-hidden`.
    3. **`narrowed` se probaba por propiedad y producción lo pasa por
       atributo.** Sin `type: Boolean` el atributo vacío vale `""` —falsy— y el
       pliegue no se abría nunca; ningún test lo habría visto.
    4. **`as const` no sobrevive a los tipos de retorno.** `DEFAULT_SORT` estaba
       protegida como referencia directa, pero mutarla a través de
       `sortOptions()[0].preference` compilaba y cambiaba la preferencia por
       defecto de toda la aplicación. Va `Readonly` en todo lo que sale.
    5. «Show 1 past events» en el caso más común, y no es decoración: es el
       nombre accesible del `<summary role="button">`.
    6. Nadie llamaba a `readSortPreference()` **sin argumento**, que es como la
       llama la vista: borrar el respaldo a `localStorage` no rompía nada.
  - **Dos e2e nuevos, y el escenario importa.** El primero que escribí **no
    probaba lo que decía**: al buscar algo que sólo casaba con pasados, el
    pliegue se abría por *otra* regla —eran el único grupo con contenido— y el
    mutante sobrevivía a los 46 e2e. Con próximos **y** pasados con contenido, el
    mismo mutante mata dos tests. Las fechas son relativas a hoy: desde T19 la
    suite es sensible al reloj y una fecha fija cambia de grupo con el tiempo.
  - Verificado: **315 unitarios, 143 de reglas y 46 e2e**, con `lint`,
    `typecheck`, `lint:lit`, `test:arch` y `build` en 0 comprobado con `$?`.
    `test:arch` sigue en 7 aserciones y el tope de 23 ficheros acoplados no se
    movió — de hecho la rama **resta** superficie acoplada, al sacar el pintado
    de `events-view` a `event-groups`.
  - **Al fusionar con el exportador de T22**: `.events=${visible}` tiene que
    seguir atado al array **anterior** a agrupar. Alimentarlo con `groups` deja
    el `.ics` de la agenda con un solo grupo y **no lo detecta nada**.
- [x] **T20 · Rejilla mensual (F5, primera mitad)** · M · depende de T19
  - Acepta: reparto de eventos en las celdas del mes como función pura; rejilla
    con CSS grid e `Intl.DateTimeFormat`, **sin librería de calendario**; primer
    día de la semana y nombres de mes según el locale; navegable con teclado,
    con `role="grid"` y celdas etiquetadas con la fecha completa.
  - Verifica: unitarios del reparto, incluidos el evento que cruza varios días y
    el cambio de horario de verano; axe sobre la vista
  - Ficheros: `src/calendar/month-grid.ts` + test, `src/calendar/calendar-view.ts`
  - Resultado: `buildMonthGrid()` reparte por **clave de día local** (`20260629`)
    y avanza con `setDate()`, nunca sumando 86 400 000 ms; la fecha pública de
    cada celda va **al mediodía**, porque `setDate()` conserva la hora del cursor
    y un desfase heredado de un cambio de hora no se corregía solo. Un evento sin
    fechas **no ocupa celda** —una celda es una fecha— pero sale en `undated` y
    la vista dice cuántos son. Teclado según el patrón `grid` de las APG, con
    foco itinerante; las teclas con modificador no se tocan. `axe` corre en el
    unitario sobre el componente montado, con el tema de Web Awesome cargado y
    comprobando también `incomplete`: sin el tema, el contraste no se medía.
    `vite.config.ts` fija la zona horaria del navegador de test a Europe/Madrid
    —protege a toda la suite, no sólo a T20—: con la UTC de los runners, el
    mutante de los milisegundos sobrevivía. El primer día de la semana usa
    `getWeekInfo()` y, donde no exista, tablas por región **generadas desde ICU**
    y revalidadas por un test que recorre las 676; van atadas a la versión de
    ICU del navegador con el que probamos, y hoy Node y Chromium ya discrepan en
    Islandia. 45 tests, cada uno con al menos un mutante que lo mata.
    **Fuera:** el conmutador de vistas y el montaje en `events-view.ts` (T21);
    seleccionar un día no emite nada todavía; `Mayús`+`Re/Av Pág` para cambiar de
    año no está; el «+N más» cuando un día tiene muchos eventos, tampoco; y no se
    probó en una segunda zona horaria, porque el proveedor de Playwright se
    configura una vez para todo `browser` y haría falta un segundo proyecto de
    Vitest.

  - **Corregido tras revisión, y lo más importante que salió de ella:** el pin de
    zona horaria de `vite.config.ts` **es inerte**. `playwright({ contextOptions:
    { timezoneId } })` no llega al navegador: con `TZ=UTC` en el entorno reporta
    offset 0 pese a pedir otra zona. Manda la variable del proceso, así que vive
    en el script `test` de `package.json`. Y el test de horario de verano ya no
    codifica un mes ni una zona: **busca la transición que tenga la zona activa**,
    con una guarda que falla ruidosamente si no hay ninguna —que es lo que
    pasaría en los runners de GitHub, que son UTC—. Comprobado: el mutante que
    avanza el cursor sumando 86 400 000 ms muere en Madrid, Santiago y Auckland,
    y en UTC salta la guarda.
  - También: pinchar una celda de relleno separaba el foco real del itinerante
    —el anillo quedaba en un día y las flechas saltaban desde otro—; el test de
    axe medía sobre tokens sin resolver, así que decía «cero violaciones» cuando
    quería decir «no he podido mirar»; el respaldo del primer día de la semana
    confundía la extensión `-u-ca-` con la región y daba domingo en alemán; y no
    podía representar el sábado, que es lo que usan `ar` y `fa`.
  - **Seis de diez mutantes elegidos por el revisor sobrevivían** a la primera
    entrega, pese a los 41 de 41 que reportaba el autor. El peor: poner
    `display: none` al texto que da nombre accesible a cada celda dejaba la suite
    verde, porque el test miraba `textContent`, que es ciego al árbol de
    accesibilidad. Los siete están muertos ahora.
- [ ] **T21 · Agenda y conmutador de vista (F5, segunda mitad)** · M · depende de T20
  - Acepta: lista cronológica agrupada por día; conmutador entre rejilla,
    calendario y agenda; la vista elegida sobrevive a la recarga; los filtros se
    aplican en las tres.
  - Verifica: e2e con axe en cada una de las tres vistas
  - Ficheros: `src/calendar/agenda-view.ts`, `src/events/events-view.ts`,
    `src/lib/view-preferences.ts`

- [x] **T22 · Export a calendario (F4)** · M · depende de T13
  - Acepta: `.ics` por evento y de la agenda completa según los filtros activos;
    RFC 5545 en lo que importa (`UID` estable, `DTSTAMP`, escape de comas y
    saltos de línea, plegado a 75 octetos, `VALUE=DATE` para días completos);
    enlace a Google Calendar; un evento sin fechas avisa en vez de generar un
    fichero roto. Todo en cliente, sin dependencias.
  - Verifica: unitarios de `buildIcs` con título con comas, descripción
    multilínea, día completo y línea que obliga a plegar; e2e de la descarga
  - Ficheros: `src/calendar/build-ics.ts` + test,
    `src/calendar/google-calendar-url.ts`, `src/events/event-card.ts`
  - Resultado: los dos módulos puros van en `src/domain/` —no en `src/calendar/`,
    que se escribió antes de T35—, con la parte impura aislada en
    `src/lib/download-file.ts` y la interfaz en `src/events/calendar-export.ts`.
    El `UID` sale del id del documento.
  - **La zona horaria no se fija en `vite.config.ts`, aunque esta entrada llegó
    a decirlo.** `playwright({ contextOptions: { timezoneId } })` es **inerte**:
    con `TZ=UTC` en el entorno el navegador reporta offset 0 pese a pedir otra
    zona. Manda la variable del proceso, así que vive en el script `test` de
    `package.json`. Importa porque en UTC —la zona de los runners de GitHub— los
    tests de conversión a UTC **no pueden fallar**, y `America/Santiago` añade
    además días en los que la medianoche no existe, que era el caso que rompía
    el detector de día completo.
  - **Cerrado.** `e2e/calendar-export.spec.ts` llegó a quedarse sin ejecutar por
    puertos ocupados, y por eso la casilla estuvo sin marcar. Ya corre: sobre
    `main`, `npm test && npm run test:rules && npm run test:e2e` dentro de
    `firebase emulators:exec` sale **0**, con **315 unitarios, 143 de reglas y
    46 e2e**, y `calendar-export.spec.ts` entre ellos.

> **Checkpoint C** — sesenta eventos se navegan por mes, etiqueta y orden; un
> `.ics` real se abre en Calendario de macOS y en Google Calendar.

## Fase 9 — IA

- [ ] **T23 · Crear evento desde texto pegado (F8)** · M · depende de T13
  - Acepta: campo para pegar texto suelto junto al generador desde imagen;
    **reutiliza `ai-policy.ts` y el mismo `responseSchema`**, sin duplicar la
    decisión de nube; el resultado prerrellena el editor y el usuario confirma;
    tope de longitud del texto; un fallo nunca bloquea el alta manual.
  - Verifica: unitarios con el modelo simulado — éxito, error, IA no disponible,
    texto sin ningún evento
  - Ficheros: `src/events/generate-from-text.ts` + test,
    `src/events/ai-event-generator.ts`

- [ ] **T24 · Sugerencia de etiquetas (F9)** · S · depende de T18, T23
  - Acepta: hasta tres etiquetas propuestas al guardar un evento sin ellas,
    priorizando las que el usuario ya usa; aparecen desmarcadas y nunca se
    aplican solas; si la IA no está disponible, silencio y ningún error.
  - Verifica: unitarios con el modelo simulado, incluido que devuelva etiquetas
    que incumplen la normalización de T18
  - Ficheros: `src/events/suggest-tags.ts` + test, `src/events/event-editor.ts`

> **Checkpoint D** — las dos rutas nuevas de IA funcionan con el modelo simulado
> y su fallo no rompe nada.

## Fase 10 — Producto: cimientos

- [x] **T25 · Mudanza de la aplicación a `/app` (F10)** · M · sin dependencias
  - Acepta: `index.html` pasa a `app.html` y sigue siendo la única entrada de
    Vite; todas las rutas cuelgan de `/app`; `guardRedirect` apunta a
    `/app/login`; los rewrites dejan de mandar `**` a `/index.html` y pasan a
    `/app/**` → `/app.html`; redirecciones permanentes desde las rutas antiguas.
  - Verifica: **todos los e2e existentes pasan con las rutas nuevas**; rewrites
    y redirecciones probados contra el emulador de Hosting; despliegue a un canal
    de previsualización antes de tocar producción.
  - Ficheros: `apps/web/app.html`, `src/app-shell.ts`, `src/auth/guard.ts`,
    `firebase.json`, `apps/web/e2e/*.spec.ts`
  - Nota: **va sola y con su propio commit.** Toca enrutado, guarda de sesión y
    despliegue a la vez; mezclarla con otra cosa hace imposible saber qué rompió
    qué. Un error aquí deja la aplicación inaccesible.

> **Checkpoint E** — el más delicado de todo el plan. La aplicación vive en
> `/app` y se despliega sin romper nada.

## Fase 11 — Producto: la cara

- [ ] **T26 · Decidir la identidad visual (F12, decisión)** · S · sin dependencias
  - Acepta: ADR 0008 que resuelve si se adopta el indigo `#3F51B5` con Belleza y
    Alegreya del blueprint, se ajusta o se descarta. **Cualquiera de las tres es
    válida; seguir sin decidir no lo es.** Incluye la tabla de contraste AA
    verificada, no supuesta.
  - Verifica: revisión humana; contraste comprobado
  - Ficheros: `docs/adr/0008-*.md`, `docs/blueprint.md`

- [ ] **T27 · Tokens de tema y tipografías (F12, implementación)** · M · depende de T26
  - Acepta: la decisión traducida a tokens `--wa-*` en una hoja única compartida
    por landing y aplicación; sin colores sueltos en componentes; modo claro y
    oscuro con `prefers-color-scheme`; **tipografías servidas desde el propio
    dominio**, subconjunto latino y `font-display: swap`; logotipo, favicon y
    `og:image`.
  - Verifica: axe cubre el contraste en los e2e; la aplicación adopta el tema
    sin regresiones visuales
  - Ficheros: `src/styles/theme.css`, `public/fonts/`, `src/main.ts`,
    `apps/web/app.html`

- [ ] **T28 · Pipeline de prerender (F11, primera mitad)** · M · depende de T25
  - Acepta: `scripts/build-landing.mjs` renderiza plantillas `lit-html` con
    `@lit-labs/ssr` a `dist/localized/{locale}/index.html`, con los textos
    saliendo del mismo XLIFF que la aplicación; corre tras `vite build`; el CSS
    va minificado y en línea; **el build comprueba el presupuesto de bytes y
    falla si se pasa**.
  - Verifica: con una landing de «hola mundo» en los dos idiomas — barato de
    rehacer si algo del pipeline no encaja. **Aquí se confirma que la i18n de
    Hosting convive con los rewrites de T25.**
  - Ficheros: `scripts/build-landing.mjs`, `src/landing/landing.ts`,
    `apps/web/package.json`, `firebase.json`
  - Nota: separar el pipeline del contenido es deliberado. Si el prerender falla,
    falla con «hola mundo» y no con la landing entera escrita.

- [ ] **T29 · Contenido de la landing (F11, segunda mitad)** · M · depende de T27, T28
  - Acepta: qué es planu en una frase, tres o cuatro bloques de valor, una
    captura real y una llamada a la acción; **utilidades CSS de Web Awesome sí,
    componentes no**; componentes propios en **light DOM**, sin Declarative
    Shadow DOM; SEO completo con Open Graph, `hreflang`, JSON-LD, `robots.txt` y
    `sitemap.xml`; un solo `<h1>` y jerarquía correcta.
  - Verifica: el HTML no contiene ninguna etiqueta `<script>`; se ve y se navega
    con JavaScript desactivado; axe en los dos idiomas; Lighthouse con
    rendimiento y SEO en 100 (`/webperf`)
  - Ficheros: `src/landing/landing.ts`, `hero.ts`, `features.ts`, `footer.ts`,
    `src/landing/landing.css`, `public/robots.txt`, `public/sitemap.xml`
  - Nota: **nada de lo que promete puede ser falso.** Si T22 no está entregada,
    la landing no dice que se integra con tu calendario.

> **Checkpoint F** — landing en dos idiomas, cero JavaScript, LCP en objetivo.

## Fase 12 — Producto: cierre

- [ ] **T30 · Privacidad, términos y cookies (F13)** · M · depende de T29, T31
  - Acepta: política que describe el tratamiento **real**, incluida la
    diferencia entre generar en el dispositivo y generar en la nube; términos
    proporcionados a un producto sin plan de pago; aviso de cookies **sólo si**
    T31 acaba usando algo que las requiera; ambos en los dos idiomas, generados
    con el prerender de T28 y enlazados desde el pie y el perfil.
  - Verifica: revisión manual contra el modelo de datos real; enlaces
    comprobados por e2e
  - Ficheros: `src/landing/legal.ts`, `src/landing/privacy.ts`,
    `src/landing/terms.ts`, `src/profile/profile-view.ts`
  - Nota: son textos honestos, no asesoramiento legal, y así se dice.

- [ ] **T31 · Analítica de activación (F16)** · M · depende de T25
  - Acepta: ADR 0009 con el proveedor elegido y qué se mide; cinco eventos y no
    más — visita, registro, **primer evento creado**, evento compartido, uso de
    la IA; **nunca contenido del usuario**; carga diferida, errores tragados, y
    la aplicación funciona igual con la analítica bloqueada.
  - Verifica: unitarios del envoltorio, incluido que traga errores y que no
    filtra campos del evento; e2e con la analítica bloqueada
  - Ficheros: `docs/adr/0009-*.md`, `src/analytics/track.ts` + test,
    `src/main.ts`
  - Nota: **bloqueada por la decisión de proveedor**, que además determina si T30
    lleva banner.

- [ ] **T32 · Borrado de cuenta y de datos (F14)** · M · depende de T13, T15, T18
  - Acepta: confirmación escribiendo el email, no un «¿seguro?»; borra en orden
    los eventos propios, sus imágenes, la entrada del directorio, las membresías
    en eventos ajenos y por último la cuenta de Auth; maneja
    `auth/requires-recent-login` reautenticando y reanudando; si se interrumpe,
    se puede reintentar; avisa de que los eventos compartidos desaparecen para
    sus invitados.
  - Verifica: e2e completo contra los emuladores con un usuario que tiene
    eventos propios, imágenes y una membresía ajena; no queda nada suyo
  - Ficheros: `src/account/delete-account.ts` + test,
    `src/profile/profile-view.ts`, `firestore.rules`
  - Nota: es la única tarea de producto que es **código delicado** y no
    contenido. Depende de la decisión tomada en T12.

- [ ] **T33 · Onboarding y primera sesión (F15)** · S · depende de T23
  - Acepta: el estado vacío explica qué hacer, con acciones directas para crear
    el primer evento a mano, desde imagen o desde texto; ofrece crear un evento
    de ejemplo **sólo si se pide**; nada de tour modal; sigue distinguiendo «no
    tienes eventos» de «tu búsqueda no encuentra nada», y sólo el primero enseña.
  - Verifica: e2e de usuario recién registrado que crea su primer evento sin
    salir del estado vacío; axe
  - Ficheros: `src/events/events-view.ts`, `src/events/empty-state.ts`

- [ ] **T34 · Documentación y cierre** · S · depende de todas
  - Acepta: `AGENTS.md`, `SPEC.md` y `docs/backend.json` reflejan el modelo y las
    rutas nuevas; ADRs 0004 a 0009 escritos y enlazados; `docs/spec-fase-2.md`
    marcado como entregado.
  - Verifica: revisión de enlaces y coherencia; `npm run lint`
  - Ficheros: `AGENTS.md`, `SPEC.md`, `docs/backend.json`, `docs/adr/README.md`

> **Checkpoint G** — los dieciséis criterios de éxito del spec, con `build`,
> `test`, `test:e2e`, `test:rules` y `lint` limpios.


---

## Fase 13 — Registro de invitaciones

Especificado en [`docs/spec-invitation-activity.md`](../docs/spec-invitation-activity.md).
Amplía F2: hoy una invitación es un aviso efímero que desaparece al decidirla.

- [ ] **T40 · Estado e historial de la invitación** · M · depende de T16
  - Acepta: `eventInvites` gana `status` (`pending` | `accepted` | `declined`),
    `createdAt` y `decidedAt`, y deja de borrarse al decidirla. La rama
    `acceptsInvite()` exige **`status == 'pending'`**, de modo que una
    invitación ya usada no sirve para volver a entrar: sin eso, conservar el
    registro haría que expulsar a alguien no significase nada.
  - Verifica: tests de reglas de cada transición permitida y, sobre todo, de las
    prohibidas — aceptar una ya aceptada, cambiar el rol al decidir, readmitirse
    uno mismo tras ser expulsado, borrar una decidida.
  - Ficheros: `firestore.rules`, `apps/web/rules/event-invites.test.ts`,
    `src/sharing/invitations.ts`

- [ ] **T41 · Página de invitaciones** · M · depende de T40, T25
  - Acepta: `/app/invitations` con pendientes arriba y decididas debajo, cada
    una con título, quién invita, rol, fecha de invitación y, si la hay, fecha y
    sentido de la decisión. Sobre una rechazada se puede reconsiderar. La
    sección del listado se queda sólo con las pendientes y enlaza aquí a partir
    de tres.
  - Verifica: e2e con dos sesiones del ciclo completo —invitar, rechazar,
    comprobar que queda registrado, reconsiderar y aceptar—; axe en la página.
  - Ficheros: `src/sharing/invitations-page.ts`,
    `src/sharing/invitations-inbox.ts`, `src/app-shell.ts`

**Pendiente de decidir** (en el spec): cuánto se conservan las decididas. Son
datos personales que crecen sin límite, y sin backend no hay quien las borre
solas. Entra en F13 (privacidad) y F14 (borrado de cuenta).

## Arquitectura hexagonal

De [`docs/spec-arquitectura-hexagonal.md`](../docs/spec-arquitectura-hexagonal.md)
y del plan en [`plan.md`](plan.md). **Todas dependen de T14**: la rama de
compartición toca `event-editor.ts` y `events-view.ts`, y migrarlos antes
garantiza conflictos.

- [x] **T35 · Sembrar las capas y levantar la frontera** · S · depende de T14
  - Acepta: **`domain/` existe** —las otras tres capas las crean T36, T37 y T38,
    cada una con su puerto, para no dejar carpetas vacías— y los seis módulos
    que no tocan Firebase —`filter-events`, `ai-availability`, `pick-locale`,
    `startup-buffer`, `format-dates`, `ai-policy`— y sus tests viven en ella;
    `biome.json` prohíbe `firebase/**` en **todo `apps/web/src/**`** mediante
    `style/noRestrictedImports` con `patterns`, y exime por nombre a los
    ficheros heredados en una lista que sólo puede encoger.
    La regla es un trinquete y no una lista de directorios protegidos: vigilar
    sólo `domain/` no impediría que naciera código nuevo acoplado.
  - Verifica: `npm run lint` sale **0**; se añade a mano un
    `import { doc } from "firebase/firestore"` a un fichero de `domain/`,
    `npm run lint` sale **1** con el diagnóstico, y se revierte. **Sin esa
    segunda mitad la regla no está probada.**
  - Ficheros: `biome.json`, movimientos con `git mv` bajo `src/domain/`

- [ ] **T36 · Puerto de sesión** · M · depende de T35
  - Acepta: `SessionPort` con `signIn`, `signUp`, `signInWithGoogle` y
    `signOut`; adaptador de Firebase en `infrastructure/`; `app-shell.ts`,
    `login-view.ts` y `profile-view.ts` no importan de `firebase/auth`;
    `auth-errors.ts` deja de importar `FirebaseError` y el adaptador traduce a
    un error de dominio, conservando los mensajes que ya valida su test.
  - Verifica: `npx vitest run application/` **sin emuladores levantados**; e2e
    de acceso; **comprobación manual del acceso con Google**, que no tiene e2e
    y cambia de camino en esta tarea
  - Ficheros: `src/application/ports/session.ts`, `src/application/sign-in.ts`
    y hermanos, `src/infrastructure/firebase/session-adapter.ts`, los tres
    componentes, `src/domain/auth-errors.ts`

- [ ] **T37 · Puerto de repositorio de eventos** · M · depende de T35, T14
  - Acepta: `EventRepository` con `save`, `delete` y `listFor`; el mapeo
    `Timestamp` ↔ `Date` y `PlanuEventDocument` se mudan a `infrastructure/`;
    `lib/types.ts` no importa de `firebase/firestore`; `events-view.ts`,
    `event-card.ts` y `event-editor.ts` tampoco.
  - Verifica: `npx vitest run application/` sin emuladores, con un repositorio
    en memoria; los 33 tests de reglas y los e2e de eventos siguen verdes. **Los
    tests de reglas no se tocan.**
  - Ficheros: `src/application/ports/event-repository.ts`, casos de uso,
    `src/infrastructure/firebase/event-repository.ts`, los tres componentes,
    `src/domain/event.ts`

- [ ] **T38 · Puerto de almacén de imágenes** · S · depende de T37
  - Acepta: `ImageStore.upload` con progreso; `firebase/storage.ts` pasa a ser
    el adaptador; ni `event-editor.ts` ni `ai-event-generator.ts` importan de
    `firebase/storage`; el progreso sigue llegando a `wa-progress-bar`.
  - Verifica: e2e de alta con imagen contra el emulador; unitario del caso de
    uso con un almacén en memoria
  - Ficheros: `src/application/ports/image-store.ts`,
    `src/infrastructure/firebase/image-store.ts`, los dos componentes

- [ ] **T39 · Cerrar la frontera** · S · depende de T36, T37, T38
  - Acepta: el `override` de Biome se extiende a `ui/**`; el andamiaje de
    contexto sin uso desaparece; `firebase/*` sólo aparece bajo
    `infrastructure/`.
  - Verifica: `grep -rl 'from "firebase/' src/ui/` **vacío**, más los 132 tests,
    `lint`, `typecheck`, `lint:lit` y `build` en código 0 comprobado con `$?`
  - Ficheros: `biome.json`, `src/infrastructure/firebase/context.ts`

> **Checkpoint H** — tras T35: la frontera es comprobable por comando y no ha
> cambiado ni una línea de comportamiento. Es el momento barato de abandonar.
> Tras T36, persona delante por el acceso con Google. Tras T39, suite completa
> y `grep` vacío.

---

## Deuda transversal

- [ ] **T43 · El diálogo se queda translúcido al reabrirlo** · S · sin dependencias
  - Síntoma: abrir el editor de eventos, cerrarlo y volver a abrirlo deja el
    contenido del `wa-dialog` a opacidad parcial. Axe mide entonces contrastes
    de entre **1,3:1 y 4,4:1** sobre el propio título del diálogo y sobre la
    etiqueta «Cover image» —elementos que en la primera apertura salen
    limpios—, y el ratio varía en cada pasada.
  - **Preexistente y reproducido en `main`**, sin una línea de la rama que lo
    encontró (T18). La primera apertura da 0 violaciones; la segunda, 1.
    Esperar a que `document.getAnimations()` se vacíe **no** lo arregla, y
    apagar las animaciones por CSS tampoco: Web Awesome anima con la Web
    Animations API, así que `animation-duration: 0s` no la toca. Eso apunta a
    estado que sobrevive al cierre, no a una carrera.
  - Acepta: reabrir el editor deja el diálogo completamente opaco; un e2e con
    axe sobre la **segunda** apertura pasa.
  - Verifica: el e2e de arriba, escrito para que falle hoy antes de arreglar
    nada.
  - Ficheros: `src/events/event-editor.ts`, `apps/web/e2e/events.spec.ts`
  - Nota: lo encontró un test, no una revisión ni una mirada. Ninguna de las
    dos lo habría visto: la diferencia de opacidad es sutil y el defecto sólo
    aparece a la segunda.

- [ ] **T42 · Traducir los comentarios de código al inglés** · M · sin dependencias
  - Acepta: los comentarios de `apps/web/src/**` están en inglés; `AGENTS.md`
    recoge la convención nueva y aclara si documentación y ADRs siguen en
    español o cambian también —hoy están en la misma frase que el código y hay
    que separarlos.
  - Verifica: `grep -rlE '//.*[áéíóúñ¿¡]|\*.*[áéíóúñ¿¡]' apps/web/src --include=*.ts`
    no devuelve nada; `npm run lint`, `typecheck` y la suite en 0
  - Ficheros: **37** ficheros `.ts` medidos el 16/08/2026, más `AGENTS.md`
  - Nota: va **sola y en su propio commit**, sin mezclar con cambios de
    comportamiento. Es un diff grande y sin valor propio; mezclarlo haría
    ilegible cualquier revisión.
