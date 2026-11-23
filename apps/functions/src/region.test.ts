import { describe, expect, it } from "vitest";
import { onAccountDeleted } from "./index.js";
import { FUNCTIONS_REGION } from "./region.js";

describe("functions region", () => {
	it("is explicit and pinned to the EU, not the implicit us-central1", () => {
		expect(FUNCTIONS_REGION).toBe("europe-west1");
	});

	it("deploys onAccountDeleted to the explicit region", () => {
		expect(onAccountDeleted.__endpoint.region).toEqual([FUNCTIONS_REGION]);
	});
});
