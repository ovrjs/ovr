import { describe, expect, test } from "vitest";
import { AuthData } from "./auth-data.js";

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
 * Build a minimal EC2/P-256 COSE key map payload.
 *
 * @param x X coordinate bytes
 * @param y Y coordinate bytes
 * @returns CBOR bytes
 */
const cose = (x: Uint8Array, y: Uint8Array) =>
	bytes(
		Uint8Array.from([0xa4, 0x01, 0x02, 0x20, 0x01, 0x21, 0x58, 0x20]),
		x,
		Uint8Array.from([0x22, 0x58, 0x20]),
		y,
	);

describe("AuthData", () => {
	test("parses authenticator data without attested credential data", () => {
		const rpIdHash = Uint8Array.from({ length: 32 }, (_v, i) => i);
		const data = bytes(rpIdHash, Uint8Array.of(0x05), Uint8Array.of(0, 0, 0, 1));

		const parsed = AuthData.parse(data);

		expect(parsed.flags).toBe(0x05);
		expect(parsed.attestedCredentialData).toBeNull();
		expect(parsed.rpIdHash).toEqual(rpIdHash);
	});

	test("parses attested credential data including COSE public key", () => {
		const rpIdHash = Uint8Array.from({ length: 32 }, (_v, i) => i + 1);
		const aaguid = new Uint8Array(16).fill(7);
		const credentialId = Uint8Array.of(1, 2, 3, 4);
		const x = new Uint8Array(32).fill(9);
		const y = new Uint8Array(32).fill(10);
		const data = bytes(
			rpIdHash,
			Uint8Array.of(0x45),
			Uint8Array.of(0, 0, 0, 1),
			aaguid,
			Uint8Array.of(0x00, credentialId.length),
			credentialId,
			cose(x, y),
		);

		const parsed = AuthData.parse(data);

		expect(parsed.flags).toBe(0x45);
		expect(parsed.attestedCredentialData?.aaguid).toEqual(aaguid);
		expect(parsed.attestedCredentialData?.credentialId).toEqual(credentialId);
		expect(parsed.attestedCredentialData?.publicKey.get(1)).toBe(2);
		expect(parsed.attestedCredentialData?.publicKey.get(-1)).toBe(1);
		expect(parsed.attestedCredentialData?.publicKey.get(-2)).toEqual(x);
		expect(parsed.attestedCredentialData?.publicKey.get(-3)).toEqual(y);
	});

	test("throws for too-short authenticator data", () => {
		expect(() => AuthData.parse(new Uint8Array(36))).toThrow("Invalid credential");
	});

	test("throws when attested credential id length is zero", () => {
		const rpIdHash = new Uint8Array(32).fill(1);
		const data = bytes(
			rpIdHash,
			Uint8Array.of(0x40),
			Uint8Array.of(0, 0, 0, 1),
			new Uint8Array(16),
			Uint8Array.of(0x00, 0x00),
		);

		expect(() => AuthData.parse(data)).toThrow("Invalid credential");
	});

	test("throws when attested COSE bytes are missing", () => {
		const rpIdHash = new Uint8Array(32).fill(1);
		const credentialId = Uint8Array.of(1);
		const data = bytes(
			rpIdHash,
			Uint8Array.of(0x40),
			Uint8Array.of(0, 0, 0, 1),
			new Uint8Array(16),
			Uint8Array.of(0x00, credentialId.length),
			credentialId,
		);

		expect(() => AuthData.parse(data)).toThrow("Invalid credential");
	});
});
