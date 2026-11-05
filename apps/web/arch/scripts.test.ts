import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Watches the repo scripts that build the deploy bundle and start the
 * emulators. Reads the source only: no build, no emulators.
 */

const SCRIPTS = fileURLToPath(new URL("../../../scripts", import.meta.url));
const read = (name: string) => readFileSync(join(SCRIPTS, name), "utf8");
const scripts = readdirSync(SCRIPTS).filter((f) => f.endsWith(".js"));

describe("scripts", () => {
	test.each(scripts)("%s no lanza procesos con shell", (name) => {
		expect(read(name)).not.toMatch(/shell\s*:/);
	});
});
