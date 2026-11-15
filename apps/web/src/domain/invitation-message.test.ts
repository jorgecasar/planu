import { expect, test } from "vitest";
import { buildInvitationMessage } from "./invitation-message.js";

const base = {
	eventTitle: "Cumpleaños de Olivia",
	link: "https://planu-app.web.app/app/login",
	role: "viewer" as const,
};

test("el asunto y el cuerpo nombran el evento y el enlace", () => {
	const m = buildInvitationMessage(base);
	expect(m.subject).toContain("Cumpleaños de Olivia");
	expect(m.body).toContain("Cumpleaños de Olivia");
	expect(m.body).toContain(base.link);
});

test("el rol cambia el texto", () => {
	const viewer = buildInvitationMessage(base).body;
	const editor = buildInvitationMessage({ ...base, role: "editor" }).body;
	expect(editor).not.toBe(viewer);
});

test("el mailto codifica asunto y cuerpo y rellena el destinatario", () => {
	const m = buildInvitationMessage({ ...base, to: "ana+plan@example.com" });
	expect(m.mailto.startsWith("mailto:ana%2Bplan%40example.com?subject=")).toBe(
		true,
	);
	const params = new URL(m.mailto).searchParams;
	expect(params.get("subject")).toBe(m.subject);
	expect(params.get("body")).toBe(m.body);
});

test("sin destinatario el mailto no lleva dirección", () => {
	expect(
		buildInvitationMessage(base).mailto.startsWith("mailto:?subject="),
	).toBe(true);
});

test("un título con saltos de línea no puede romper la cabecera", () => {
	const m = buildInvitationMessage({
		...base,
		eventTitle: "Fiesta\r\nBcc: otro@example.com",
	});
	expect(m.subject).not.toMatch(/[\r\n]/);
	expect(m.mailto).not.toMatch(/%0D%0ABcc/i);
});

test("el mensaje solo promete la invitación a quien ya tiene cuenta", () => {
	const body = buildInvitationMessage(base).body;
	expect(body).toContain(
		"If you already have an account, sign in with this email address to see it:",
	);
	expect(body).not.toMatch(/sign up|and accept/i);
});

test("el enlace va tal cual y el mensaje no incluye ningún email del invitado", () => {
	const m = buildInvitationMessage({ ...base, to: "ana@example.com" });
	expect(m.body).not.toContain("ana@example.com");
	expect(m.subject).not.toContain("ana@example.com");
});
