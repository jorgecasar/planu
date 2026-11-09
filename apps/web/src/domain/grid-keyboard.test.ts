import { describe, expect, test } from "vitest";
import {
	addDays,
	type GridKey,
	keyTarget,
	sameMonth,
	shiftMonth,
	startOfMonth,
} from "./grid-keyboard.js";

function key(name: string, modifiers: Partial<GridKey> = {}): GridKey {
	const off = { ctrlKey: false, metaKey: false, altKey: false };
	return { ...off, shiftKey: false, key: name, ...modifiers };
}

/** Local `YYYY-MM-DD`, so assertions read as days and not as instants. */
function ymd(date: Date | undefined): string | undefined {
	if (!date) return undefined;
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

const MONDAY = 1;
const SUNDAY = 0;
const focused = new Date(2026, 5, 17); // A Wednesday.
const june = new Date(2026, 5, 1);

describe("month helpers", () => {
	test("startOfMonth and sameMonth identify a month by its first day", () => {
		expect(ymd(startOfMonth(new Date(2026, 5, 30, 23)))).toBe("2026-06-01");
		expect(sameMonth(new Date(2026, 5, 30), june)).toBe(true);
		expect(sameMonth(new Date(2025, 5, 30), june)).toBe(false);
	});

	test("addDays moves by calendar days across the time change", () => {
		// The `test` script pins America/Santiago, where September 6, 2026
		// lasts 23 hours: going back 24 hours from the 7th lands on the 5th.
		expect(ymd(addDays(new Date(2026, 8, 7), -1))).toBe("2026-09-06");
		expect(ymd(addDays(new Date(2026, 8, 5), 1))).toBe("2026-09-06");
	});

	test("shiftMonth clamps to the last day of the target month", () => {
		const jan31 = new Date(2026, 0, 31);
		expect(ymd(shiftMonth(jan31, startOfMonth(jan31), 1))).toBe("2026-02-28");
		expect(ymd(shiftMonth(focused, june, -1))).toBe("2026-05-17");
	});
});

describe("keyTarget", () => {
	// Home and End follow the locale's first day of the week.
	test.each([
		["ArrowRight", MONDAY, "2026-06-18"],
		["ArrowLeft", MONDAY, "2026-06-16"],
		["ArrowDown", MONDAY, "2026-06-24"],
		["ArrowUp", MONDAY, "2026-06-10"],
		["PageUp", MONDAY, "2026-05-17"],
		["PageDown", MONDAY, "2026-07-17"],
		["Home", MONDAY, "2026-06-15"],
		["End", MONDAY, "2026-06-21"],
		["Home", SUNDAY, "2026-06-14"],
		["End", SUNDAY, "2026-06-20"],
	])("%s with week starting on %i moves to %s", (name, first, expected) => {
		expect(ymd(keyTarget(key(name), focused, june, first))).toBe(expected);
	});

	test.each(["ctrlKey", "metaKey", "altKey", "shiftKey"] as const)(
		"a key with %s is not ours",
		(modifier) => {
			const event = key("Home", { [modifier]: true });
			expect(keyTarget(event, focused, june, MONDAY)).toBeUndefined();
		},
	);

	test("an unrelated key is not ours", () => {
		expect(keyTarget(key("Enter"), focused, june, MONDAY)).toBeUndefined();
	});
});
