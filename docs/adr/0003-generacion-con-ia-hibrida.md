# 0003 · Generación desde imagen con IA híbrida

- **Fecha:** 2026-08-15
- **Estado:** aceptado, pendiente de habilitar el backend en la nube

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
