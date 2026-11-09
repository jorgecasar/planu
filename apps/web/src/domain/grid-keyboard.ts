/**
 * Keyboard navigation of the month grid, as pure date arithmetic.
 *
 * It follows the APG `grid` pattern: arrows to move by days and weeks,
 * `Home` and `End` for the ends of the week, `Page Up` and `Page Down` to
 * change month. Deciding where the focus lands lives here, without mounting
 * anything; moving it and announcing the month stays in the component.
 */

/** First day of the month of a date, which is how a month is identified here. */
export function startOfMonth(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function sameMonth(date: Date, month: Date): boolean {
	return (
		date.getFullYear() === month.getFullYear() &&
		date.getMonth() === month.getMonth()
	);
}

/**
 * Moves forward or backward by days.
 *
 * With `setDate()`, never by adding milliseconds: a day doesn't always
 * last 24 hours, and the day of the time change would leave the focus on
 * the neighboring cell.
 */
export function addDays(date: Date, days: number): Date {
	const target = new Date(date.getTime());
	target.setDate(target.getDate() + days);
	return target;
}

/**
 * Changes month while keeping the day.
 *
 * It's clamped to the destination month's last day: from January 31,
 * `Page Down` leads to February 28. Without clamping, `Date`'s overflow
 * would skip past February entirely and land in March.
 */
export function shiftMonth(focused: Date, month: Date, delta: number): Date {
	const target = new Date(month.getFullYear(), month.getMonth() + delta, 1);
	const length = new Date(
		target.getFullYear(),
		target.getMonth() + 1,
		0,
	).getDate();

	return new Date(
		target.getFullYear(),
		target.getMonth(),
		Math.min(focused.getDate(), length),
	);
}

/** What a keydown carries that matters here; a `KeyboardEvent` fits it. */
export type GridKey = Pick<
	KeyboardEvent,
	"key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

const STEPS: Readonly<Record<string, number>> = {
	ArrowRight: 1,
	ArrowLeft: -1,
	ArrowDown: 7,
	ArrowUp: -7,
};

/**
 * The day a key moves the focus to, or `undefined` if the key isn't ours.
 *
 * `firstDay` uses `Date.prototype.getDay()`'s numbering (0 = Sunday), and
 * is what `Home` and `End` take as the ends of the week.
 *
 * With a modifier it isn't our key. `Ctrl+Home` means "go to the start of
 * the document" and `Shift`+arrow means selection: going through the `Home`
 * or arrow branch would swallow them with `preventDefault()`. The APG also
 * reserve `Shift`+`Page Up/Down` for changing year, which isn't here: better
 * to do nothing than to do something else.
 */
export function keyTarget(
	event: GridKey,
	focused: Date,
	month: Date,
	firstDay: number,
): Date | undefined {
	if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
		return undefined;
	}

	const offsetInWeek = (focused.getDay() - firstDay + 7) % 7;
	const step = STEPS[event.key];
	if (step !== undefined) return addDays(focused, step);

	switch (event.key) {
		case "Home":
			return addDays(focused, -offsetInWeek);
		case "End":
			return addDays(focused, 6 - offsetInWeek);
		case "PageUp":
			return shiftMonth(focused, month, -1);
		case "PageDown":
			return shiftMonth(focused, month, 1);
		default:
			return undefined;
	}
}
