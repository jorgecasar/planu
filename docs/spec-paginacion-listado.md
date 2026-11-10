# Spec: cuándo y cómo paginar el listado de eventos

Origen: #93. La auditoría del 2 de noviembre pedía poner `orderBy` y `limit()` a
las consultas del listado. Una de ellas, `listFor`, no la usaba nadie y se
borró en #137. La otra no admite un límite sin romper funcionalidad, y este
documento explica por qué. También fija el umbral a partir del cual sí
compensará paginar y cómo hacerlo llegado ese momento.

## Lo que hay hoy

`events-controller.ts` mantiene una suscripción `onSnapshot` a
`events where memberIds array-contains uid`, sin orden ni límite. El cliente
recibe todos los eventos de los que el usuario es miembro, propios y
compartidos, y los mantiene al día en vivo.

Sobre esa lista completa trabajan, en el cliente:

| Pieza | Para qué necesita todos los eventos |
| --- | --- |
| `domain/filter-events.ts` | Búsqueda por texto y filtros por etiqueta, fecha y propiedad, en memoria |
| `domain/sort-events.ts` | Ordenación elegida por el usuario |
| `domain/listing-state.ts` | Distinguir «no tienes eventos» de «no hay compartidos», «no hay tuyos» y «nada coincide» |
| `calendar/calendar-view.ts` | Pintar meses enteros, incluidos los pasados |
| `events/calendar-export.ts` | Exportar a `.ics` lo que se ve |
| `events-view.ts` → editor | La señal `first_event_created`, que desde #94 se decide según la lista esté vacía o no |

Con un `limit(n)` en la suscripción, la búsqueda no encontraría los eventos que
quedan fuera de la página. Los estados vacíos mentirían, el calendario
mostraría meses a medias y la señal de primer evento se dispararía a quien ya
tiene eventos más allá de la página.

## Por qué no se pagina todavía

- **No hay usuarios reales.** Lo dice el [ADR 0005](adr/0005-sin-entornos-de-preview.md),
  y es la misma pregunta que tumbó los entornos de preview: ¿qué protege esto
  hoy? Nada medido.
- **El coste por usuario es pequeño y lineal.** Una suscripción cobra una
  lectura por documento al abrirse y otra por cada cambio. Con un historial de
  cientos de eventos, abrir el listado cuesta cientos de lecturas por sesión.
  Es poco frente a la cuota gratuita diaria, mientras no haya volumen.
- **Paginar bien no es un parche, es un rediseño.** Exige llevar la búsqueda y
  los filtros al servidor (ver abajo). Hacerlo sin el dato que lo justifique es
  el error caro que AGENTS.md cuenta del verano.

## Cuándo sí

Se pagina cuando se cumpla cualquiera de estas condiciones, medidas y no
supuestas:

1. **Volumen:** el percentil 95 de eventos por usuario supera los **500**. Es
   el orden de magnitud en el que la primera carga del listado empieza a
   notarse en móvil: unos cientos de KiB de documentos antes de pintar.
2. **Coste:** las lecturas de `events` superan de forma sostenida el **50 %**
   de la cuota gratuita diaria de Firestore.
3. **Rendimiento:** el LCP o el INP del listado salen del umbral «bueno» de
   Core Web Vitals por el tamaño de la lista. Se mide con la mediana de al
   menos 5 pasadas, como pide AGENTS.md, y no con una sola.

Para saber cuándo se cumplen hacen falta dos medidas que hoy no existen:

- el número de eventos por usuario, como un evento de analítica agregado y sin
  identificadores;
- las lecturas de Firestore por día, que salen de la consola de facturación de
  GCP. Es una configuración en GCP, no código.

## Cómo, llegado el momento

En este orden, cada paso en su propia PR:

1. **Separar «próximos» de «pasados» en el servidor.** La vista principal se
   suscribe solo a los eventos con `endDate >= ahora`, con
   `orderBy("startDate")`. Es lo que la mayoría mira, y su tamaño está acotado
   por definición. Los pasados se cargan bajo demanda, con `getDocs` y paginación por cursor
   (`startAfter`) de `orderBy("startDate", "desc")` y `limit(50)`. Necesita
   un índice compuesto `memberIds` (array-contains) + `endDate` /
   `startDate` en `firestore.indexes.json`.
2. **Llevar la búsqueda y los filtros al servidor para los pasados.** Los
   filtros por etiqueta y fecha se traducen a `where`. La búsqueda por texto
   libre no la resuelve Firestore: o se limita a lo cargado, diciéndolo en la
   interfaz, o se indexa en un servicio aparte. Eso es una decisión con ADR
   propio, no parte de este documento.
3. **Ajustar a la vez lo que hoy asume la lista completa:**
   - `listing-state.ts`: «no tienes eventos» debe salir de una consulta de
     conteo o de un campo agregado, no del tamaño de la página.
   - La señal de primer evento: igual. Una opción es un contador por usuario
     que mantengan las reglas o una función.
   - `calendar-view.ts`: pide el rango del mes visible y no depende de la lista
     global.
   - `.ics`: exporta lo que se ve, como hoy. Hay que decir en la interfaz que es
     lo cargado.

## Fuera de alcance

- Paginar las invitaciones, el buzón y el directorio: tienen otros volúmenes y
  otras consultas.
- Cachés offline más allá de la persistencia que ya trae el SDK de Firestore.

## Criterios para cerrar #93

- [x] `listFor` eliminado del puerto y del adaptador (#137).
- [x] El motivo de la suscripción sin límite, anotado junto a ella
  (`events-controller.ts`, #137).
- [ ] Esta especificación, revisada y aceptada.
