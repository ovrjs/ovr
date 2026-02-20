import { describe, expect, test } from "vitest";
import { CBOR, COSE } from "./cbor.js";

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

/**
 * Encode an ASCII string into bytes.
 *
 * @param value ASCII text
 * @returns Encoded bytes
 */
const ascii = (value: string) =>
	Uint8Array.from(value, (char) => char.charCodeAt(0));

describe("CBOR", () => {
	test("decodeAttestation returns authData for fmt none", () => {
		const authData = Uint8Array.of(1, 2, 3, 4);
		const encoded = bytes(
			Uint8Array.of(0xa2),
			Uint8Array.of(0x63),
			ascii("fmt"),
			Uint8Array.of(0x64),
			ascii("none"),
			Uint8Array.of(0x68),
			ascii("authData"),
			Uint8Array.of(0x44),
			authData,
		);

		expect(new CBOR(encoded).decodeAttestation()).toEqual(authData);
	});

	test("decodeAttestation rejects unsupported fmt", () => {
		const encoded = bytes(
			Uint8Array.of(0xa2),
			Uint8Array.of(0x63),
			ascii("fmt"),
			Uint8Array.of(0x66),
			ascii("packed"),
			Uint8Array.of(0x68),
			ascii("authData"),
			Uint8Array.of(0x41, 0x00),
		);

		expect(() => new CBOR(encoded).decodeAttestation()).toThrow(
			"Invalid credential",
		);
	});

	test("decodeCOSEKey parses integer labels and byte values", () => {
		const x = new Uint8Array(32).fill(0xaa);
		const y = new Uint8Array(32).fill(0xbb);
		const encoded = bytes(
			Uint8Array.from([0xa4, 0x01, 0x02, 0x20, 0x01, 0x21, 0x58, 0x20]),
			x,
			Uint8Array.from([0x22, 0x58, 0x20]),
			y,
		);

		const key = new CBOR(encoded).decodeCOSEKey();

		expect(key.get(1)).toBe(2);
		expect(key.get(-1)).toBe(1);
		expect(key.get(-2)).toEqual(x);
		expect(key.get(-3)).toEqual(y);
	});

	test("decodeCOSEKey rejects non-integer labels", () => {
		const encoded = bytes(
			Uint8Array.of(0xa1),
			Uint8Array.of(0x61),
			ascii("a"),
			Uint8Array.of(0x01),
		);

		expect(() => new CBOR(encoded).decodeCOSEKey()).toThrow(
			"Invalid COSE labels",
		);
	});

	test("decodeCOSEKey rejects unsupported value types", () => {
		const encoded = Uint8Array.of(0xa1, 0x01, 0xa0);

		expect(() => new CBOR(encoded).decodeCOSEKey()).toThrow(
			"Invalid COSE value",
		);
	});

	test("decodeCOSEKey rejects truncated streams", () => {
		const encoded = Uint8Array.of(0xa1, 0x01, 0x58, 0x02, 0x01);

		expect(() => new CBOR(encoded).decodeCOSEKey()).toThrow(
			"Invalid CBOR stream",
		);
	});
});

describe("COSE", () => {
	test("toSPKI encodes EC2 P-256 coordinates into SPKI bytes", () => {
		const x = Uint8Array.from({ length: 32 }, (_v, i) => i + 1);
		const y = Uint8Array.from({ length: 32 }, (_v, i) => 100 + i);
		const spki = COSE.toSPKI(
			new Map<number, number | Uint8Array>([
				[1, 2],
				[-1, 1],
				[-2, x],
				[-3, y],
			]),
		);
		const point = spki.slice(-65);

		expect(spki[0]).toBe(0x30);
		expect(spki.length).toBe(91);
		expect(point[0]).toBe(0x04);
		expect(point.slice(1, 33)).toEqual(x);
		expect(point.slice(33)).toEqual(y);
	});

	test("toSPKI rejects unsupported key type", () => {
		expect(() =>
			COSE.toSPKI(
				new Map<number, number | Uint8Array>([
					[1, 1],
					[-1, 1],
					[-2, new Uint8Array(32)],
					[-3, new Uint8Array(32)],
				]),
			),
		).toThrow("Invalid COSE type");
	});

	test("toSPKI rejects unsupported curve", () => {
		expect(() =>
			COSE.toSPKI(
				new Map<number, number | Uint8Array>([
					[1, 2],
					[-1, 2],
					[-2, new Uint8Array(32)],
					[-3, new Uint8Array(32)],
				]),
			),
		).toThrow("Invalid COSE curve");
	});

	test("toSPKI rejects missing coordinate bytes", () => {
		expect(() =>
			COSE.toSPKI(
				new Map<number, number | Uint8Array>([
					[1, 2],
					[-1, 1],
					[-2, 1],
					[-3, new Uint8Array(32)],
				]),
			),
		).toThrow("Invalid COSE coordinates");
	});
});
