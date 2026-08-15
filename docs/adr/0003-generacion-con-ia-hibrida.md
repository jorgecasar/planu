# 0003 · Generación desde imagen con IA híbrida

- **Fecha:** 2026-08-15
- **Estado:** aceptado; la nube queda **deshabilitada** de momento (2026-08-15)

## Contexto

El prototipo extraía los datos de un evento a partir de la foto de un cartel con
un flow de Genkit y Gemini, invocado desde React mediante una Server Action de
Next. Sin Next no hay Server Actions, así que la función necesitaba otra casa.

Se valoraron cuatro caminos:

1. **Cloud Function con Genkit.** Conserva el flow casi intacto, pero exige plan
   Blaze, una API key y mantener un servicio aparte.
2. **`@google/genai` en el cliente.** Simple, pero expone la clave en el bundle.
3. **Prompt API del navegador** (`LanguageModel`, Gemini Nano). Gratis, privada y
   sin red, pero sólo en Chrome 148+ de escritorio y con 22 GB de disco, 16 GB de
   RAM y 4 GB de VRAM. Deja fuera Safari, Firefox y todo el móvil.
4. **Polyfill de la Prompt API.** Multimodal y con salida estructurada, pero
   experimental y con backends de Gemini u OpenAI que vuelven al problema de la
   clave. La propia documentación de Chrome recomienda no usarlo en producción.

## Decisión

**Firebase AI Logic en modo híbrido**, con
`getGenerativeModel(ai, { mode: InferenceMode.PREFER_ON_DEVICE })`.

Usa la IA integrada del navegador cuando existe y cae a Gemini en la nube cuando
no. Es lo que Chrome recomienda para producción y reutiliza el Firebase que el
proyecto ya tiene, sin Cloud Functions ni clave en el cliente.

## Motivos

- Cobertura total sin renunciar a lo bueno de la ejecución local: cuando hay
  Gemini Nano, la imagen no sale del dispositivo, no hay coste y funciona sin red.
- Una sola ruta de código: el modo lo resuelve el SDK, no un `if` nuestro.
- Sin infraestructura propia que mantener.

## Estado actual: sólo en el dispositivo

La nube está desactivada. El modo es `ONLY_ON_DEVICE` y hay un candado en
`ai-policy.ts` (`CLOUD_LOCKED`) que lo fuerza por encima de cualquier
configuración.

**Corrección de una versión anterior de este ADR:** decía que bastaba con no
configurar `inCloudParams`. Es falso, y lo demostró una auditoría leyendo el
SDK: si no se pasan, `@firebase/ai` los rellena solo con
`gemini-2.5-flash-lite`. Omitirlos no cierra nada. Lo que cierra es la
constante, porque obliga a un diff revisable en lugar de a cambiar una variable
de entorno en el pipeline.

Consecuencias buscadas:

- Coste cero y ninguna imagen sale del dispositivo.
- App Check deja de ser un bloqueante inmediato. Seguirá siéndolo el día que se
  reabra la nube, y Firebase lo exige para AI Logic desde noviembre de 2026.
- `ONLY_ON_DEVICE` **espera** a que el modelo termine de descargarse en vez de
  resolver por otro camino, y ante un problema lanza la causa real. Con
  `PREFER_ON_DEVICE` y sin nube, el primer uso habría fallado en silencio
  mientras la descarga seguía en segundo plano.

### Experiencia de uso

Siguiendo las recomendaciones de Chrome para IA integrada:

- El modelo se prepara **al abrir el diálogo**, no al pulsar generar: la
  descarga ocurre mientras el usuario elige la foto.
- Si hace falta descargar, se avisa **antes** y con barra de progreso. Puede
  tardar minutos, y una espera sin explicación parece un cuelgue.
- Si el navegador no puede dar la función, la opción **no se ofrece**.
- La salida se pide con `responseConstraint` y sin topes de caracteres, que
  empujan al modelo a comprimir con emojis o cambiando de idioma.
- Lo generado nunca se guarda solo: prerrellena el editor y el usuario decide.

### Límites del modelo local

Sólo texto de un turno, imágenes JPEG o PNG en línea, y un tope de 9216 tokens.
Cualquier cosa fuera de ahí lanza en vez de resolverse por otra vía.

## Control del gasto

La ejecución en el dispositivo es gratis; la de la nube factura por token. Por
eso el modo no está fijado en el código: lo resuelve `src/events/ai-policy.ts`
a partir de dos condiciones que deben cumplirse **ambas**.

1. `VITE_AI_CLOUD_FALLBACK=true`, un interruptor global de despliegue.
2. El claim `premium` en el token del usuario.

Sin las dos, el modo es `only_on_device`: la función existe si el navegador
trae IA integrada y, si no, se informa de que no está disponible. Es
deliberado — **es preferible decir que algo no se puede hacer a generar una
factura a espaldas del usuario**.

El derecho viaja en un claim del token y no en Firestore para que lo conceda el
servidor: un cliente no puede otorgárselo a sí mismo.

Dónde acabó ejecutándose no se deduce del modo, que sólo expresa una
preferencia: lo informa el SDK en `response.inferenceSource`
(`on_device` o `in_cloud`). Se muestra al usuario en el editor y es la señal a
vigilar cuando se abra la nube.

## Consecuencias

- **App Check es obligatorio** antes de abrir esto a terceros: sin él, cualquiera
  puede gastar la cuota del proyecto. Está sin configurar.
- El backend en la nube exige plan Blaze. Hasta que se habilite, la función sólo
  opera en dispositivos con IA integrada; en el resto muestra un aviso y remite
  al alta manual, que es la ruta principal.
- Gemini Nano rinde bastante peor que el modelo de nube, sobre todo extrayendo
  fechas. Por eso **lo generado nunca se guarda directamente**: prerrellena el
  editor y el usuario confirma.
- El parseo es defensivo pese a pedir salida estructurada, porque un modelo
  pequeño devuelve JSON inválido con más frecuencia de la deseable.
- La lógica de extracción no conoce al SDK: recibe una función
  `(parts) => Promise<string>`. El adaptador vive en el componente, de modo que
  cambiar de proveedor no toca la lógica ni sus tests.
