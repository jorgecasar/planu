# 0002 · Los eventos son privados por usuario

- **Fecha:** 2026-08-15
- **Estado:** aceptado
- **Supera a:** la descripción de listado público de [`../blueprint.md`](../blueprint.md)

## Contexto

El prototipo se contradecía a sí mismo. Su interfaz consultaba
`where('userId', '==', user.uid)` y redirigía a `/login` sin sesión, es decir,
se comportaba como una aplicación privada. Sus reglas, en cambio, decían:

```
allow read: if true;
```

Cualquiera podía leer los eventos de cualquiera consultando Firestore
directamente, saltándose la interfaz. Y había dos fallos más:

1. **Las reglas se combinan con OR.** La validación de campos estaba en su
   propio `allow create, update`, sin exigir autenticación, lo que **anulaba**
   el control de propiedad de la regla anterior en lugar de sumarse a él:
   cualquiera podía modificar cualquier evento sin estar autenticado.
2. **El control de propiedad comparaba contra `resource.data.userId`**, un campo
   que el modelo de datos de `backend.json` no definía. Nunca pudo funcionar.

## Decisión

Los eventos son **privados**: sólo su creador los lee y los modifica.

```
allow read: if isOwner();
```

Con tres reglas de acompañamiento: **una única regla `allow` por operación**,
`userId` obligatorio y fijado al `uid` de quien crea, y prohibición de
transferir la propiedad en un `update`.

## Motivos

- Es lo que la interfaz ya hacía; la regla sólo cierra el agujero.
- Un planificador de eventos personales no necesita lectura pública, y abrirla
  después es fácil; cerrarla tras una filtración, no.

## Consecuencias

- Los documentos heredados en la base `planu` que no tengan `userId` quedan
  ilegibles e inmodificables para todo el mundo. Hay que decidir si migrarlos o
  descartarlos; está sin comprobar si existen.
- Compartir un evento con otra persona requerirá un cambio de modelo, como un
  campo de visibilidad o una colección de invitados. No está previsto.
- Storage sigue la misma lógica: las imágenes cuelgan de `events/{uid}/` y sólo
  su dueño escribe y lee. El prototipo subía a esa ruta pero sus reglas sólo
  permitían `event-images/{imageId}`, así que la subida nunca funcionó.
