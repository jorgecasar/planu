import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

/**
 * Web Awesome 3 warns on `size="small"|"medium"|"large"` and will drop them
 * in its next major. The runtime check only sees what a test renders; this
 * one reads every template, including branches no test mounts.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const sources = readdirSync(SRC, { recursive: true, withFileTypes: true })
	.filter(
		(entry) =>
			entry.isFile() &&
			entry.name.endsWith(".ts") &&
			!entry.name.endsWith(".test.ts"),
	)
	.map((entry) => join(entry.parentPath, entry.name));

test("ninguna plantilla usa los tamaños largos obsoletos", () => {
	const offenders = sources.filter((file) =>
		/\bsize=["']?(small|medium|large)\b/.test(readFileSync(file, "utf8")),
	);
	expect(offenders).toEqual([]);
});
