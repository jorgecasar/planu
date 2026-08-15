# **App Name**: Eventide Planner

> **Documento histórico.** Es la especificación del prototipo de julio de 2025,
> conservada tal cual. No describe la implementación actual y hay partes
> superadas:
>
> - El listado **no es público**: los eventos son privados por usuario. Ver
>   [`adr/0002-eventos-privados-por-usuario.md`](adr/0002-eventos-privados-por-usuario.md).
> - Las guías de estilo (indigo #3F51B5, tipografías Belleza y Alegreya) **no se
>   han aplicado**: la interfaz usa el tema por defecto de Web Awesome. Están sin
>   traducir a tokens y sin decidir si se conservan.
> - El stack cambió por completo. Ver
>   [`adr/0001-web-components-con-lit-y-web-awesome.md`](adr/0001-web-components-con-lit-y-web-awesome.md).
>
> La especificación vigente es [`../SPEC.md`](../SPEC.md).

## Core Features:

- Event Listing: Display a list of saved events with key details: title, description, location, date, and image.
- Text Search: Enable searching events by text in title or description.
- Date Range Filter: Implement date range filtering to display events falling within specified start and end dates, with inclusive criteria for events without date bounds.
- Event Editor: Form for creating and editing events with fields for title, description, location, start date, end date and image.
- Event Storage: Store event data including title, description, location, dates and image URLs in Firestore.

## Style Guidelines:

- Primary color: Deep indigo (#3F51B5) to evoke a sense of organization and purpose.
- Background color: Very light grey (#F5F6FA), nearly white.
- Accent color: Muted violet (#9575CD) for interactive elements.
- Font pairing: 'Belleza' (sans-serif) for headlines and short chunks of text, 'Alegreya' (serif) for body text.
- Simple, clear icons representing event types (e.g., a calendar for meetings, a map marker for locations).
- Clean, card-based layout for event listings with consistent spacing and alignment.
- Subtle transitions for event details and search results.