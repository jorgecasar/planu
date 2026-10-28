# Runbook: backfill de `memberIds` en eventos de la fase 1

Los eventos creados antes de la compartición (T13/T14) tienen `userId` pero no
`memberIds`. `firestore.rules` lee la membresía de ese campo, así que esos
eventos **no los puede leer nadie, ni su dueño** (lo fija el test «not even its
owner can read it: only the backfill fixes that» en
`apps/web/rules/firestore.test.ts`). Bloquea el despliegue con datos reales; ver
T14 en `tasks/todo.md` y la pregunta abierta nº 1 de `SPEC.md`.

El script es `scripts/backfill-member-ids.js`. A cada evento sin `memberIds` le
pone `memberIds: [userId]` y `roles: {}`, lo mismo que escribe hoy el editor al
crear. No toca nada más.

## Qué decide y qué deja para una persona

| Estado del documento | Qué hace |
| --- | --- |
| Tiene `memberIds` | Nada |
| Sin `memberIds`, con `userId` y sin `roles` (o vacío) | Lo completa |
| Sin `userId` | Lo lista como «revisar» y no lo toca |
| Sin `memberIds` pero con `roles` no vacío | Lo lista como «revisar» y no lo toca |

Los dos casos de «revisar» son datos que esta reescritura no produce nunca. Qué
hacer con ellos —migrarlos a mano o borrarlos— lo decide una persona. Si aparece
alguno, el script sale con código 2.

## Antes de ejecutarlo

Es una escritura en producción con `firebase-admin`, que **se salta las
reglas**. Cae en «luces encendidas» y en «preguntar primero» (ver `AGENTS.md`):
no lo ejecuta un agente por su cuenta.

1. Credenciales: `gcloud auth application-default login` con una cuenta con
   permiso de escritura en Firestore sobre `planu-app`.
2. Exportación de seguridad de la base `planu` antes de escribir:

   ```bash
   gcloud firestore export gs://<bucket>/backfill-$(date +%F) \
     --project planu-app --database planu
   ```

## Ejecución

```bash
# 1. Simulación. Es lo que hace sin --apply: lee y lista, no escribe.
node scripts/backfill-member-ids.js

# 2. Si la lista es la esperada, escribir.
node scripts/backfill-member-ids.js --apply

# 3. Repetir la simulación: debe dar «completar: 0».
node scripts/backfill-member-ids.js
```

Si la simulación da `completar: 0` y `revisar: 0` desde el principio, no hay
nada que migrar: la pregunta abierta queda respondida y el script no hace falta.

Es idempotente: un evento ya completado se cuenta como «ok» en la siguiente
pasada. Cada escritura lleva como precondición el `updateTime` leído, así que si
alguien edita el evento entre la lectura y la escritura, el lote falla en vez de
pisar el cambio; basta con volver a ejecutarlo.

Para probarlo contra los emuladores:

```bash
FIRESTORE_EMULATOR_HOST=localhost:8181 node scripts/backfill-member-ids.js
```

## Después

- Marcar en `tasks/todo.md` (T14) y en el Checkpoint A de `tasks/plan.md` con
  la evidencia: la salida de la simulación final y su código de salida.
- Responder la pregunta abierta nº 1 de `SPEC.md` con lo que haya encontrado la
  simulación.
