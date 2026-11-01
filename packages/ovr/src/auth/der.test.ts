import { DER } from "./der.js";
import { describe, expect, test } from "vitest";

describe("DER", () => {
	test("decodes short scalars and necessary sign padding", () => {
		const raw = DER.unwrap(Uint8Array.of(0x30, 7, 2, 2, 0, 0x80, 2, 1, 1));
		expect(raw).toHaveLength(64);
		expect(raw[31]).toBe(0x80);
		expect(raw[63]).toBe(1);
	});

	test.each([
		[],
		[0x31, 6, 2, 1, 1, 2, 1, 1],
		[0x30, 0x81, 6, 2, 1, 1, 2, 1, 1],
		[0x30, 6, 3, 1, 1, 2, 1, 1],
		[0x30, 6, 2, 1, 0x80, 2, 1, 1],
		[0x30, 7, 2, 2, 0, 1, 2, 1, 1],
		[0x30, 6, 2, 1, 0, 2, 1, 1],
		[0x30, 6, 2, 3, 1, 2, 1, 1],
		[0x30, 7, 2, 1, 1, 2, 1, 1, 0],
	])("rejects malformed or noncanonical signatures: %j", (...value) => {
		expect(() => DER.unwrap(Uint8Array.from(value))).toThrow("Invalid DER");
	});
});
