import { describe, expect, test } from "vitest";
import { DER } from "./der.js";

/**
 * Concatenate byte arrays.
 *
 * @param parts Byte chunks
 * @returns Combined bytes
 */
const bytes = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;

	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}

	return out;
};

describe("DER", () => {
	test("unwrap returns input when signature is not DER sequence", () => {
		const raw = new Uint8Array(64).fill(9);
		raw[0] = 0x31;

		expect(DER.unwrap(raw)).toBe(raw);
	});

	test("unwrap decodes short-form DER sequence", () => {
		const r = Uint8Array.from({ length: 32 }, (_v, i) => i + 1);
		const s = Uint8Array.from({ length: 32 }, (_v, i) => i + 33);
		const der = bytes(
			Uint8Array.of(0x30, 0x44, 0x02, 0x20),
			r,
			Uint8Array.of(0x02, 0x20),
			s,
		);

		expect(DER.unwrap(der)).toEqual(bytes(r, s));
	});

	test("unwrap decodes long-form DER sequence length", () => {
		const r = new Uint8Array(32).fill(1);
		const s = new Uint8Array(32).fill(2);
		const der = bytes(
			Uint8Array.of(0x30, 0x81, 0x44, 0x02, 0x20),
			r,
			Uint8Array.of(0x02, 0x20),
			s,
		);

		expect(DER.unwrap(der)).toEqual(bytes(r, s));
	});

	test("unwrap trims leading zeros and left-pads short coordinates", () => {
		const r = new Uint8Array(32).fill(0x11);
		const s = new Uint8Array(31).fill(0x22);
		const der = bytes(
			Uint8Array.of(0x30, 0x44, 0x02, 0x21, 0x00),
			r,
			Uint8Array.of(0x02, 0x1f),
			s,
		);
		const raw = DER.unwrap(der);

		expect(raw.length).toBe(64);
		expect(raw.slice(0, 32)).toEqual(new Uint8Array(32).fill(0x11));
		expect(raw[32]).toBe(0x00);
		expect(raw.slice(33)).toEqual(new Uint8Array(31).fill(0x22));
	});
});
