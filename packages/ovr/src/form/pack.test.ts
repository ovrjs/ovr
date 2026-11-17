import { pack, unpack } from "./pack.js";
import { describe, expect, test } from "vitest";

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * @param length Number of bytes
 * @returns Bytes that do not compress, the same each run
 */
const noise = (length: number) => {
	let seed = 7;
	return Uint8Array.from({ length }, () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed >>> 16;
	});
};

describe("pack", () => {
	test("gives back what it was given", () => {
		for (const bytes of [
			new Uint8Array(),
			Uint8Array.of(0),
			Uint8Array.of(255, 255),
			encode("a"),
			// a code used as it is defined
			encode("aaaaaaaaaaaaaaaa"),
			encode("abababababababab"),
			encode('{"issues":[{"path":["title"],"message":"Required field"}]}'),
			encode("Crème brûlée, jalapeño, 🍲 and 日本語"),
			Uint8Array.from({ length: 256 }, (_, byte) => byte),
			noise(5000),
		])
			expect(unpack(pack(bytes), 1 << 20)).toEqual(bytes);
	});

	test("is only characters a URL takes as they are", () => {
		expect(pack(noise(2000))).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(pack(new Uint8Array())).toBe("");
	});

	test("makes text about half as long as Base64 would", () => {
		const text = JSON.stringify({
			values: {
				ingredients: Array.from({ length: 20 }, (_, i) => ({
					amount: String(i + 1),
					unit: i % 2 ? "cup" : "tbsp",
					name: `ingredient ${i}`,
					prep: i % 3 ? "finely chopped" : "",
				})),
				steps: [
					"Heat the oil in a large pot over medium-high heat until it shimmers.",
					"Add the onion and cook, stirring now and then, until soft and golden.",
					"Stir in the garlic and spices and cook until fragrant, 30 seconds.",
				],
			},
		});
		const bytes = encode(text);

		expect(pack(bytes).length).toBeLessThan(bytes.toBase64().length / 2);
	});

	test("keeps its place when the table is full", () => {
		// more sequences than a table holds
		const bytes = noise(200_000);

		expect(unpack(pack(bytes), 1 << 20)).toEqual(bytes);
	});
});

describe("unpack", () => {
	test("refuses what pack did not write", () => {
		expect(unpack("not packed!", 1000)).toBeUndefined();
		expect(unpack("eyJpc3N1ZXMiOltdfQ==", 1000)).toBeUndefined();
		// a first code that is not a byte, and a code not yet defined
		expect(unpack("__", 1000)).toBeUndefined();
		expect(unpack(`${pack(encode("ab"))}____`, 1000)).toBeUndefined();
	});

	test("never throws, whatever a URL holds", () => {
		const packed = pack(encode("the same words, the same words, the same"));

		for (let cut = 0; cut <= packed.length; cut++)
			expect(() => unpack(packed.slice(0, cut), 1000)).not.toThrow();
		for (let at = 0; at < packed.length; at++)
			expect(() =>
				unpack(`${packed.slice(0, at)}_${packed.slice(at + 1)}`, 1000),
			).not.toThrow();
	});

	test("stops at its limit, so a short text cannot ask for much", () => {
		const bomb = pack(new Uint8Array(1_000_000));

		expect(bomb.length).toBeLessThan(5000);
		expect(unpack(bomb, 10_000)).toBeUndefined();
		expect(unpack(bomb, 1_000_000)?.length).toBe(1_000_000);
	});
});
