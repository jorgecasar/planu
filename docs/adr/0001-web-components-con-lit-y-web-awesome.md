# 0001 · Web components con Lit y Web Awesome

- **Fecha:** 2026-08-15
- **Estado:** aceptado

## Contexto

El prototipo de planu se generó con Firebase Studio en julio de 2025: Next.js 15,
React 18, shadcn/ui sobre Radix y Genkit. Un día de trabajo, sin tests, con el
README y el nombre de paquete por defecto (`nextn`).

Trece meses después había que decidir si retomarlo tal cual, modernizarlo o
reescribirlo. De sus ~2.000 líneas, 33 ficheros eran componentes de shadcn/ui
regenerables con un comando y el resto dependía de React.

## Decisión

Reescribir la interfaz con **web components (Lit 3) y Web Awesome 3**, sobre
Vite 7 y TypeScript 5.9, conservando Firebase como backend.

Del prototipo se conservan el concepto, el modelo de datos, las reglas de
seguridad —reescritas, ver [0002](0002-eventos-privados-por-usuario.md)— y el
proyecto `planu-app`.

## Motivos

- Es el stack habitual de este autor: Lit, Vite, Vitest en navegador, Playwright
  con axe y Biome ya están en uso en otros proyectos, con criterios asentados.
- El código del prototipo no tenía deuda que mereciera conservarse: era un
  andamiaje generado, sin tests y con dos fallos de seguridad reales.
- Los web components no atan la aplicación a un framework, lo que importa en un
  proyecto pensado para durar.

## Consecuencias

- No hay SSR. La aplicación es una SPA y se despliega en Firebase Hosting
  clásico, no en App Hosting.
- No hay Server Actions, lo que obligó a replantear la generación con IA. Ver
  [0003](0003-generacion-con-ia-hibrida.md).
- Hay que traducir cada patrón de React: los hooks de Firestore pasan a
  reactive controllers, `react-hook-form` a formulario nativo con Zod, y
  `useRouter` a `@lit-labs/router`.
- **Decoradores legacy, no estándar.** esbuild, que es quien transpila
  TypeScript dentro de Vite, no implementa los decoradores de TC39; con
  `useDefineForClassFields: true` el bundle falla con `SyntaxError` al importar
  cualquier componente. Revertirlo exigiría añadir `vite-plugin-babel`.
