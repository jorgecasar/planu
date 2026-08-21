import { expect, test } from "vitest";
import {
	buildIcs,
	type CalendarEvent,
	escapeText,
	foldLine,
	icsFileName,
	isExportable,
} from "./build-ics.js";

/** Injected: with an implicit `Date.now()` the test would be testing the clock. */
const NOW = new Date(Date.UTC(2026, 7, 16, 10, 30, 0));

/** Local midnight, which is what an `<input type="date">` produces. */
const day = (year: number, month: number, date: number) =>
	new Date(year, month - 1, date);

/**
 * An hour that is not midnight in any time zone: every offset is a multiple
 * of fifteen minutes, so with minute 37 it never lands on :00, and the test
 * does not depend on the machine's zone.
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
/** Undoes the folding, which is how a calendar client reads it. */
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

const ics = (events: CalendarEvent[]) => buildIcs(events, { now: NOW });

// ── The suite's time zone ─────────────────────────────────────────────────────

test("la suite corre donde los fallos de zona horaria se ven", () => {
	// Without this, half a dozen tests below cannot fail. In UTC the local
	// and UTC hours coincide, so "this comes out in UTC" holds on its own
	// even if the code uses the local getters — and GitHub's runners are
	// UTC. The zone is fixed in `vite.config.ts`; this check is what warns
	// if someone removes it.
	expect(new Date(2026, 5, 12).getTimezoneOffset()).not.toBe(0);

	// And that it is still a zone where midnight sometimes does not exist:
	// that is the case that used to choke the all-day detector. If the
	// browser's tzdata changed Chile's rules, this says so instead of
	// leaving the test further down passing for the wrong reason.
	expect(new Date(2026, 8, 6).getHours()).not.toBe(0);
});

// ── Structure ──────────────────────────────────────────────────────────────

test("envuelve los eventos en un VCALENDAR con versión y PRODID", () => {
	const salida = lines(ics([event()]));

	expect(salida[0]).toBe("BEGIN:VCALENDAR");
	expect(salida).toContain("VERSION:2.0");
	expect(salida.some((line) => line.startsWith("PRODID:"))).toBe(true);
	expect(salida.at(-1)).toBe("END:VCALENDAR");
});

test("separa las líneas con CRLF, nunca con un salto suelto", () => {
	// A strict client rejects the whole file if it finds a lone LF.
	const salida = ics([event({ description: "Dos\nlíneas" })]);

	expect(salida.endsWith("\r\n")).toBe(true);
	expect(/(?<!\r)\n/.test(salida)).toBe(false);
});

test("exporta varios eventos en un solo fichero", () => {
	const salida = ics([event(), event({ id: "def456", title: "Concierto" })]);

	expect(salida.match(/BEGIN:VEVENT/g)).toHaveLength(2);
	expect(salida.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
});

// ── UID and DTSTAMP ────────────────────────────────────────────────────────────

test("el UID sale del identificador del evento y no cambia entre exportaciones", () => {
	const uno = ics([event()]);
	const otro = ics([event()]);

	expect(lines(uno)).toContain("UID:abc123@planu.app");
	// Stable: if it changed, the calendar would duplicate the event instead
	// of updating it.
	expect(lines(otro)).toContain("UID:abc123@planu.app");
});

test("dos eventos distintos no comparten UID", () => {
	const salida = ics([event(), event({ id: "def456" })]);
	const uids = lines(salida).filter((line) => line.startsWith("UID:"));

	expect(new Set(uids).size).toBe(2);
});

test("un evento sin identificador para la exportación en vez de colisionar", () => {
	// With no id, the UID would be `@planu.app` or `undefined@planu.app` for
	// everyone: the calendar would treat them as versions of the same event
	// and keep just one. A loud error is worth more than a calendar with a
	// single event left in it.
	expect(() => ics([event({ id: "" })])).toThrow(TypeError);
	expect(() => ics([event({ id: undefined as unknown as string })])).toThrow(
		TypeError,
	);
});

test("el DTSTAMP es el momento inyectado, en UTC", () => {
	expect(lines(ics([event()]))).toContain("DTSTAMP:20260816T103000Z");
});

// ── Dates ──────────────────────────────────────────────────────────────────────

test("un evento de día completo usa VALUE=DATE y fin exclusivo", () => {
	const salida = lines(
		ics([event({ startDate: day(2026, 6, 12), endDate: day(2026, 6, 14) })]),
	);

	expect(salida).toContain("DTSTART;VALUE=DATE:20260612");
	// The 15th and not the 14th: in RFC 5545 an all-day event's DTEND is
	// exclusive, so with the 14th the last day would be lost.
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
	// 02:37 UTC on the 12th of June is 22:37 on the 11th in Santiago. If the
	// conversion were done with the local getters it would come out as
	// `20260611T223700Z`: the event would show up on the previous day and
	// four hours earlier on the calendar of anyone who imports it.
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
	// On 6 September 2026 Chile moves the clock forward from 00:00, so that
	// day starts at 01:00 and `getHours()` is useless for detecting an
	// all-day event. With the naive detector this used to come out as a
	// point-in-time appointment, with no DTEND and with a time: the user had
	// picked a whole day in the editor.
	const salida = lines(ics([event({ startDate: day(2026, 9, 6) })]));

	expect(salida).toContain("DTSTART;VALUE=DATE:20260906");
	expect(salida).toContain("DTEND;VALUE=DATE:20260907");
});

test("un rango de dos días es el mismo con y sin salto de horario", () => {
	// The 5th and 6th of September in Santiago: the second day starts at
	// 01:00. The semantics cannot depend on that.
	const salida = lines(
		ics([event({ startDate: day(2026, 9, 5), endDate: day(2026, 9, 6) })]),
	);

	expect(salida).toContain("DTSTART;VALUE=DATE:20260905");
	expect(salida).toContain("DTEND;VALUE=DATE:20260907");
});

test("no emite DTEND si no es posterior al inicio", () => {
	// RFC 5545 §3.8.2.2 requires it to be later, and the schema allows start
	// equal to end. With no DTEND the event has zero duration, which is what
	// was asked for.
	const salida = lines(ics([event({ startDate: at(9), endDate: at(9) })]));

	expect(salida).toContain("DTSTART:20260612T093700Z");
	expect(salida.some((line) => line.startsWith("DTEND"))).toBe(false);
});

test("con sólo fecha de fin, esa fecha hace de DTSTART", () => {
	// RFC 5545 requires DTSTART in every VEVENT with no METHOD: a VEVENT
	// without it is exactly the broken file this task avoids.
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

// ── Escaping ───────────────────────────────────────────────────────────────────

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
	// No line in the file can start with the second line's text: that would
	// mean a real line break inside the property.
	expect(lines(salida).some((line) => line.startsWith("Segunda"))).toBe(false);
});

test("tira los caracteres de control, que RFC 5545 no admite", () => {
	// A control character pasted from another program makes several readers
	// reject the whole file, not just the property. The tab is valid and
	// stays.
	const ctrl = (code: number) => String.fromCharCode(code);
	const sucio = `Feria${ctrl(0x07)} del libro${ctrl(0x09)}infantil${ctrl(0x7f)}`;
	const salida = ics([event({ description: sucio })]);

	expect(unfold(salida)).toContain(
		`DESCRIPTION:Feria del libro${ctrl(0x09)}infantil`,
	);

	// And that none is left anywhere in the whole file. CR and LF are fine,
	// those are the lines.
	const controles = [...salida].filter((char) => {
		const code = char.codePointAt(0) ?? 0;
		if (code === 0x09 || code === 0x0a || code === 0x0d) return false;
		return code < 0x20 || code === 0x7f;
	});
	expect(controles).toEqual([]);
});

test("la barra invertida se escapa antes que el resto", () => {
	// The other way around, `\,` would become `\\,` and the calendar would
	// show the backslash.
	expect(escapeText("a\\,b")).toBe("a\\\\\\,b");
});

// ── Folding ────────────────────────────────────────────────────────────────────

test("pliega las líneas largas a 75 octetos con continuación indentada", () => {
	const largo =
		"Feria del libro de primavera con firma de autores y talleres en el parque central";
	const salida = ics([event({ title: largo, description: largo })]);
	const partidas = lines(salida);
	const summary = partidas.findIndex((line) => line.startsWith("SUMMARY:"));

	for (const line of partidas) expect(bytes(line)).toBeLessThanOrEqual(75);
	// The line after SUMMARY is its continuation, indented with a space.
	expect(partidas[summary + 1]?.startsWith(" ")).toBe(true);
	// Unfolded, it is the original text again.
	expect(unfold(salida)).toContain(`SUMMARY:${largo}`);
});

test("cuenta octetos y no caracteres al plegar texto acentuado", () => {
	// Each accented character takes up two octets: folding by character
	// would give lines of up to 150 octets and an invalid file that would
	// still look correct.
	const title = "á".repeat(50);
	const plegada = foldLine(`SUMMARY:${title}`);

	for (const line of plegada.split("\r\n")) {
		expect(bytes(line)).toBeLessThanOrEqual(75);
	}
	expect(plegada.split("\r\n").length).toBeGreaterThan(1);
	expect(plegada.replace(/\r\n /g, "")).toBe(`SUMMARY:${title}`);
});

test("no parte un carácter multiocteto por la mitad", () => {
	// A lone surrogate: the sign that the cut landed inside a character.
	const suelto =
		/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

	// With several offsets, because where the cut lands depends on how many
	// octets precede it: with just one, the limit could land right between
	// two characters by chance, and the test would not prove anything.
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
	// With three segments the continuation budget is visible: 75 octets for
	// the first and 74 for the rest, because the space that opens them
	// counts. With two segments nothing pins it down, and a 75 instead of
	// 74 slips through unnoticed, leaving 76-octet lines.
	const plegada = foldLine("X".repeat(200));
	const tramos = plegada.split("\r\n");

	expect(tramos).toEqual([
		"X".repeat(75),
		` ${"X".repeat(74)}`,
		` ${"X".repeat(51)}`,
	]);
	for (const tramo of tramos) expect(bytes(tramo)).toBeLessThanOrEqual(75);
});

// ── File name ────────────────────────────────────────────────────────────────

test("el nombre del fichero sale del título, sin acentos ni signos", () => {
	expect(icsFileName("Feria del libro, 2026")).toBe("feria-del-libro-2026.ics");
});

test("un título sin caracteres utilizables cae a un nombre genérico", () => {
	expect(icsFileName("日本")).toBe("event.ics");
});

test("el título no puede sacar el fichero de su carpeta", () => {
	// The name is chosen by whoever writes the title and ends up in a
	// download header: no slashes, no dots, nothing that reads as a path.
	const nombre = icsFileName("../../etc/passwd");

	expect(nombre).toBe("etc-passwd.ics");
	expect(nombre).not.toContain("/");
	expect(nombre).not.toContain("..");
});
