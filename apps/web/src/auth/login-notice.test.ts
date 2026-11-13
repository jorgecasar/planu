import { expect, test } from "vitest";
import { loginNoticeState, takeLoginNotice } from "./login-notice.js";

/** In-memory `History`: `replaceState` overwrites the state, like the real one. */
function historyWith(state: unknown) {
	return {
		state,
		replaceState(next: unknown) {
			this.state = next;
		},
	};
}

test("el aviso se lee una sola vez: una recarga ya no lo encuentra", () => {
	const history = historyWith(loginNoticeState("account-deleted"));

	expect(takeLoginNotice(history)).toBe("account-deleted");
	expect(takeLoginNotice(history)).toBeUndefined();
});

test("al leerlo conserva el resto del estado de la entrada", () => {
	const history = historyWith({
		...loginNoticeState("deletion-interrupted"),
		other: 1,
	});

	expect(takeLoginNotice(history)).toBe("deletion-interrupted");
	expect(history.state).toEqual({ other: 1 });
});

test("sin aviso, o con uno desconocido, no hay nada que mostrar ni que tocar", () => {
	for (const state of [null, {}, "x", { planuLoginNotice: "hacked" }]) {
		const history = historyWith(state);
		expect(takeLoginNotice(history)).toBeUndefined();
		expect(history.state).toBe(state);
	}
});

test("sin aviso, el estado no lleva nada", () => {
	expect(loginNoticeState(undefined)).toEqual({});
});
