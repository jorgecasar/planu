# Plan de implementación — port de planu a web components

Deriva de [`SPEC.md`](../SPEC.md). El detalle de por qué se toma cada decisión
está allí; aquí está el orden y las dependencias.

## Grafo de dependencias

```
T1 Config y contextos ──┬──→ T2 Provider y emuladores ──┬──→ T4 Auth y login ──→ T5 Perfil y cabecera
                        │                               │
                        └──→ T3 Controllers Firestore ──┴──→ T6 Listado ──→ T7 Filtros
                                                                  │
                             T0 Reglas de seguridad ──────────────┤
                                                                  ▼
                                                            T8 Editor y subida
                                                                  │
                                                                  ▼
                                                            T9 Generación con IA
                                                                  │
                                                                  ▼
                                                            T10 ADRs y docs
```

**Ruta crítica:** T1 → T2 → T4 → T6 → T8. Todo lo demás cuelga de ahí.

**Paralelizable:** T0 (reglas) es independiente del código y puede ir primero;
conviene, porque T3 y T6 se validan contra ellas.

## Orden y puntos de verificación

| Fase | Tareas | Checkpoint |
| --- | --- | --- |
| 1 | T0, T1, T2, T3 | Un componente de prueba lee una colección del emulador y se desuscribe al desmontarse |
| 2 | T4, T5 | Registro, acceso y cierre de sesión reales contra el emulador de Auth |
| 3 | T6, T7 | Listado con datos sembrados; filtros cubiertos por unitarios |
| 4 | T8, T9, T10 | Alta de evento con imagen de punta a punta; IA simulada en tests |

No se avanza de fase con la anterior en rojo.

## Riesgos y mitigación

- **Los controllers de Firestore son la pieza con más superficie de error.** Se
  atacan pronto (T3) y con tests contra el emulador, no con mocks: las fugas de
  suscripción sólo aparecen con un backend real.
- **La subida a Storage nunca funcionó en el prototipo.** T0 arregla las reglas
  antes de que T8 dependa de ellas, para no depurar dos cosas a la vez.
- **La IA es la parte más incierta y la menos crítica.** Va la última a
  propósito: si se complica, la aplicación ya está completa sin ella.
- **App Check y Blaze tienen coste y requieren decisión.** T9 se implementa
  primero contra la IA integrada del navegador, que no requiere ninguna de las
  dos; el backend en la nube se enchufa después, cuando se apruebe.

## Bloqueos abiertos

Ninguno detiene la implementación; sí limitan la verificación.

- **Java no está instalado.** Los emuladores de Firestore y Storage lo exigen; el
  de Auth no, porque es Node. Consecuencia: la fase 2 se verifica de verdad, pero
  los e2e de las fases 3 y 4 con datos sembrados necesitan
  `brew install openjdk` antes. Mientras tanto, los controllers se cubren con el
  módulo de Firestore simulado, que es donde viven sus fallos reales.
- **Firebase Storage no está dado de alta en `planu-app`.** El prototipo subía
  imágenes a un bucket que nunca se aprovisionó. Requiere habilitarlo desde la
  consola, y en proyectos nuevos Firebase exige plan Blaze para ello.

## Fuera de alcance

- Reemplazar el repo remoto `planu`, pendiente de decidir sobre sus 5 commits.
- `@lit/localize`: se aborda al terminar el port, antes de añadir pantallas.
- Migrar los documentos heredados de la base `planu`.
