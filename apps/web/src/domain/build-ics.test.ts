import { expect, test } from "vitest";
import {
	buildIcs,
	type CalendarEvent,
	escapeText,
	foldLine,
	icsFileName,
	isExportable,
} from "./build-ics.js";

/** Inyectado: con `Date.now()` implícito el test probaría el reloj. */
const NOW = new Date(Date.UTC(2026, 7, 16, 10, 30, 0));

/** Medianoche local, que es lo que produce un `<input type="date">`. */
const day = (year: number, month: number, date: number) =>
	new Date(year, month - 1, date);

/**
 * Una hora que no es medianoche en ninguna zona horaria: todos los desfases son
 * múltiplos de quince minutos, así que con el minuto 37 nunca cae en :00 y el
 * test no depende de la zona de la máquina.
 */
const at = (hourUtc: number) => new Date(Date.UTC(2026, 5, 12, hourUtc, 37, 0));

const event = (extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
	id: "abc123",
	title: "Feria del libro",
	startDate: day(2026, 6, 12),
	...extra,
});

const bytes = (value: string) => new TextEncoder().encode(value).length;
const lines = (ics: string) => ics.split("\r\n").filter((line) => line !== "");
/** Deshace el plegado, que es como lo lee un cliente de calendario. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

const ics = (events: CalendarEvent[]) => buildIcs(events, { now: NOW });

// ── La zona horaria de la suite ──────────────────────────────────────────────

test("la suite corre donde los fallos de zona horaria se ven", () => {
	// Sin esto, media docena de tests de aquí abajo no pueden fallar. En UTC la
	// hora local y la UTC coinciden, así que «esto sale en UTC» se cumple solo
	// aunque el código use los getters locales — y los runners de GitHub son
	// UTC. La zona la fija `vite.config.ts`; esta comprobación es la que avisa
	// si alguien la quita.
	expect(new Date(2026, 5, 12).getTimezoneOffset()).not.toBe(0);

	// Y que siga siendo una zona donde la medianoche a veces no existe: es el
	// caso que se le atragantaba al detector de día completo. Si el tzdata del
	// navegador cambiase las reglas de Chile, esto lo dice en vez de dejar el
	// test de más abajo pasando por la razón equivocada.
	expect(new Date(2026, 8, 6).getHours()).not.toBe(0);
});

// ── Estructura ───────────────────────────────────────────────────────────────

test("envuelve los eventos en un VCALENDAR con versión y PRODID", () => {
	const salida = lines(ics([event()]));

	expect(salida[0]).toBe("BEGIN:VCALENDAR");
	expect(salida).toContain("VERSION:2.0");
	expect(salida.some((line) => line.startsWith("PRODID:"))).toBe(true);
	expect(salida.at(-1)).toBe("END:VCALENDAR");
});

test("separa las líneas con CRLF, nunca con un salto suelto", () => {
	// Un cliente estricto rechaza el fichero entero si encuentra un LF solo.
	const salida = ics([event({ description: "Dos\nlíneas" })]);

	expect(salida.endsWith("\r\n")).toBe(true);
	expect(/(?<!\r)\n/.test(salida)).toBe(false);
});

test("exporta varios eventos en un solo fichero", () => {
	const salida = ics([event(), event({ id: "def456", title: "Concierto" })]);

	expect(salida.match(/BEGIN:VEVENT/g)).toHaveLength(2);
	expect(salida.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
});

// ── UID y DTSTAMP ────────────────────────────────────────────────────────────

test("el UID sale del identificador del evento y no cambia entre exportaciones", () => {
	const uno = ics([event()]);
	const otro = ics([event()]);

	expect(lines(uno)).toContain("UID:abc123@planu.app");
	// Estable: si cambiase, el calendario duplicaría el evento en vez de
	// actualizarlo.
	expect(lines(otro)).toContain("UID:abc123@planu.app");
});

test("dos eventos distintos no comparten UID", () => {
	const salida = ics([event(), event({ id: "def456" })]);
	const uids = lines(salida).filter((line) => line.startsWith("UID:"));

	expect(new Set(uids).size).toBe(2);
});

test("un evento sin identificador para la exportación en vez de colisionar", () => {
	// Sin id, el UID sería `@planu.app` o `undefined@planu.app` para todos: el
	// calendario los trataría como versiones de un mismo evento y se quedaría
	// con uno. Vale más un error ruidoso que una agenda de un solo evento.
	expect(() => ics([event({ id: "" })])).toThrow(TypeError);
	expect(() => ics([event({ id: undefined as unknown as string })])).toThrow(
		TypeError,
	);
});

test("el DTSTAMP es el momento inyectado, en UTC", () => {
	expect(lines(ics([event()]))).toContain("DTSTAMP:20260816T103000Z");
});

// ── Fechas ───────────────────────────────────────────────────────────────────

test("un evento de día completo usa VALUE=DATE y fin exclusivo", () => {
	const salida = lines(
		ics([event({ startDate: day(2026, 6, 12), endDate: day(2026, 6, 14) })]),
	);

	expect(salida).toContain("DTSTART;VALUE=DATE:20260612");
	// El 15 y no el 14: en RFC 5545 el DTEND de un día completo es exclusivo,
	// así que con el 14 el último día se perdería.
	expect(salida).toContain("DTEND;VALUE=DATE:20260615");
	expect(salida.some((line) => line.startsWith("DTSTART:"))).toBe(false);
});

test("un día completo sin fin dura un día", () => {
	const salida = lines(ics([event({ startDate: day(2026, 6, 12) })]));

	expect(salida).toContain("DTSTART;VALUE=DATE:20260612");
	expect(salida).toContain("DTEND;VALUE=DATE:20260613");
});

test("un evento con hora sale en UTC y sin VALUE=DATE", () => {
	const salida = lines(ics([event({ startDate: at(9), endDate: at(11) })]));

	expect(salida).toContain("DTSTART:20260612T093700Z");
	expect(salida).toContain("DTEND:20260612T113700Z");
	expect(salida.some((line) => line.includes("VALUE=DATE"))).toBe(false);
});

test("la hora se convierte a UTC, aunque cambie el día", () => {
	// A las 02:37 UTC del 12 de junio en Santiago son las 22:37 del 11. Si la
	// conversión se hiciera con los getters locales saldría `20260611T223700Z`:
	// el evento aparecería el día anterior y cuatro horas antes en la agenda de
	// cualquiera que lo importe.
	const salida = lines(
		ics([event({ startDate: new Date(Date.UTC(2026, 5, 12, 2, 37, 0)) })]),
	);

	expect(salida).toContain("DTSTART:20260612T023700Z");
});

test("un evento con hora y sin fin no emite DTEND", () => {
	const salida = lines(ics([event({ startDate: at(9) })]));

	expect(salida).toContain("DTSTART:20260612T093700Z");
	expect(salida.some((line) => line.startsWith("DTEND"))).toBe(false);
});

test("sigue siendo de día completo el día en que la medianoche no existe", () => {
	// El 6 de septiembre de 2026 Chile adelanta el reloj a las 00:00, así que
	// ese día empieza a la 01:00 y `getHours()` no vale para detectar el día
	// completo. Con el detector ingenuo esto salía como una cita puntual, sin
	// DTEND y con hora: el usuario había elegido un día entero en el editor.
	const salida = lines(ics([event({ startDate: day(2026, 9, 6) })]));

	expect(salida).toContain("DTSTART;VALUE=DATE:20260906");
	expect(salida).toContain("DTEND;VALUE=DATE:20260907");
});

test("un rango de dos días es el mismo con y sin salto de horario", () => {
	// El 5 y el 6 de septiembre en Santiago: el segundo día empieza a la 01:00.
	// La semántica no puede depender de eso.
	const salida = lines(
		ics([event({ startDate: day(2026, 9, 5), endDate: day(2026, 9, 6) })]),
	);

	expect(salida).toContain("DTSTART;VALUE=DATE:20260905");
	expect(salida).toContain("DTEND;VALUE=DATE:20260907");
});

test("no emite DTEND si no es posterior al inicio", () => {
	// RFC 5545 §3.8.2.2 lo exige posterior, y el esquema permite inicio igual a
	// fin. Sin DTEND el evento tiene duración cero, que es lo que se pidió.
	const salida = lines(ics([event({ startDate: at(9), endDate: at(9) })]));

	expect(salida).toContain("DTSTART:20260612T093700Z");
	expect(salida.some((line) => line.startsWith("DTEND"))).toBe(false);
});

test("con sólo fecha de fin, esa fecha hace de DTSTART", () => {
	// RFC 5545 exige DTSTART en todo VEVENT sin METHOD: un VEVENT sin él es
	// justo el fichero roto que esta tarea evita.
	const salida = lines(
		ics([event({ startDate: null, endDate: day(2026, 6, 14) })]),
	);

	expect(salida).toContain("DTSTART;VALUE=DATE:20260614");
});

test("un evento sin fechas no se exporta", () => {
	const sinFechas = event({ startDate: null, endDate: null });

	expect(isExportable(sinFechas)).toBe(false);
	expect(ics([sinFechas])).not.toContain("BEGIN:VEVENT");
});

test("un evento sin fechas no arrastra a los que sí las tienen", () => {
	const salida = ics([event({ startDate: null }), event({ id: "def456" })]);

	expect(salida.match(/BEGIN:VEVENT/g)).toHaveLength(1);
	expect(lines(salida)).toContain("UID:def456@planu.app");
});

// ── Escape ───────────────────────────────────────────────────────────────────

test("escapa las comas del título", () => {
	const salida = unfold(ics([event({ title: "Cena, baile y sorteo" })]));

	expect(salida).toContain("SUMMARY:Cena\\, baile y sorteo");
});

test("escapa el punto y coma y la barra invertida", () => {
	const salida = unfold(
		ics([event({ location: "Sala B; planta 2", description: "C:\\ruta" })]),
	);

	expect(salida).toContain("LOCATION:Sala B\\; planta 2");
	expect(salida).toContain("DESCRIPTION:C:\\\\ruta");
});

test("la descripción multilínea viaja como \\n y no parte la propiedad", () => {
	const salida = ics([event({ description: "Primera\nSegunda\r\nTercera" })]);

	expect(unfold(salida)).toContain("DESCRIPTION:Primera\\nSegunda\\nTercera");
	// Ninguna línea del fichero puede empezar por el texto de la segunda: eso
	// significaría un salto real dentro de la propiedad.
	expect(lines(salida).some((line) => line.startsWith("Segunda"))).toBe(false);
});

test("tira los caracteres de control, que RFC 5545 no admite", () => {
	// Un control pegado desde otro programa hace que varios lectores rechacen el
	// fichero entero, no la propiedad. El tabulador sí es válido y se queda.
	const ctrl = (code: number) => String.fromCharCode(code);
	const sucio = `Feria${ctrl(0x07)} del libro${ctrl(0x09)}infantil${ctrl(0x7f)}`;
	const salida = ics([event({ description: sucio })]);

	expect(unfold(salida)).toContain(
		`DESCRIPTION:Feria del libro${ctrl(0x09)}infantil`,
	);

	// Y que no quede ninguno en todo el fichero. CR y LF sí, que son las líneas.
	const controles = [...salida].filter((char) => {
		const code = char.codePointAt(0) ?? 0;
		if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
		return code < 0x20 || code === 0x7f;
	});
	expect(controles).toEqual([]);
});

test("la barra invertida se escapa antes que el resto", () => {
	// Al revés, `\,` se convertiría en `\\,` y el calendario mostraría la barra.
	expect(escapeText("a\\,b")).toBe("a\\\\\\,b");
});

// ── Plegado ──────────────────────────────────────────────────────────────────

test("pliega las líneas largas a 75 octetos con continuación indentada", () => {
	const largo =
		"Feria del libro de primavera con firma de autores y talleres en el parque central";
	const salida = ics([event({ title: largo, description: largo })]);
	const partidas = lines(salida);
	const summary = partidas.findIndex((line) => line.startsWith("SUMMARY:"));

	for (const line of partidas) expect(bytes(line)).toBeLessThanOrEqual(75);
	// La línea siguiente a SUMMARY es su continuación, indentada con un espacio.
	expect(partidas[summary + 1]?.startsWith(" ")).toBe(true);
	// Desplegado vuelve a ser el texto original.
	expect(unfold(salida)).toContain(`SUMMARY:${largo}`);
});

test("cuenta octetos y no caracteres al plegar texto acentuado", () => {
	// Cada «á» ocupa dos octetos: plegar por caracteres daría líneas de hasta
	// 150 octetos y un fichero inválido que aun así parecería correcto.
	const title = "á".repeat(50);
	const plegada = foldLine(`SUMMARY:${title}`);

	for (const line of plegada.split("\r\n")) {
		expect(bytes(line)).toBeLessThanOrEqual(75);
	}
	expect(plegada.split("\r\n").length).toBeGreaterThan(1);
	expect(plegada.replace(/\r\n /g, "")).toBe(`SUMMARY:${title}`);
});

test("no parte un carácter multiocteto por la mitad", () => {
	// Un suplente suelto: la señal de que el corte cayó dentro de un carácter.
	const suelto =
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

	// Con varios desplazamientos, porque dónde cae el corte depende de cuántos
	// octetos lo preceden: con uno solo el límite puede caer justo entre dos
	// caracteres por casualidad y el test no probaría nada.
	for (const relleno of ["", "A", "AB", "ABC"]) {
		const title = `${relleno}${"🎪".repeat(40)}`;
		const plegada = foldLine(`SUMMARY:${title}`);

		for (const line of plegada.split("\r\n")) {
			expect(suelto.test(line)).toBe(false);
			expect(bytes(line)).toBeLessThanOrEqual(75);
		}
		expect(plegada.replace(/\r\n /g, "")).toBe(`SUMMARY:${title}`);
	}
});

test("una línea que cabe justo no se pliega", () => {
	const linea = "X".repeat(75);

	expect(foldLine(linea)).toBe(linea);
	expect(foldLine(`${linea}Y`)).toBe(`${linea}\r\n Y`);
});

test("a partir del segundo tramo el espacio de continuación descuenta", () => {
	// Con tres tramos se ve el presupuesto de las continuaciones: 75 octetos el
	// primero y 74 los demás, porque el espacio que los abre cuenta. Con dos
	// tramos nada lo fija, y un 75 en lugar del 74 pasa desapercibido dejando
	// líneas de 76 octetos.
	const plegada = foldLine("X".repeat(200));
	const tramos = plegada.split("\r\n");

	expect(tramos).toEqual([
		"X".repeat(75),
		` ${"X".repeat(74)}`,
		` ${"X".repeat(51)}`,
	]);
	for (const tramo of tramos) expect(bytes(tramo)).toBeLessThanOrEqual(75);
});

// ── Nombre de fichero ────────────────────────────────────────────────────────

test("el nombre del fichero sale del título, sin acentos ni signos", () => {
	expect(icsFileName("Feria del libro, 2026")).toBe("feria-del-libro-2026.ics");
});

test("un título sin caracteres utilizables cae a un nombre genérico", () => {
	expect(icsFileName("日本")).toBe("event.ics");
});

test("el título no puede sacar el fichero de su carpeta", () => {
	// El nombre lo elige quien escribe el título y acaba en una cabecera de
	// descarga: ni barras, ni puntos, ni nada que se lea como una ruta.
	const nombre = icsFileName("../../etc/passwd");

	expect(nombre).toBe("etc-passwd.ics");
	expect(nombre).not.toContain("/");
	expect(nombre).not.toContain("..");
});
