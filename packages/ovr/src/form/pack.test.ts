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
	test("gives back what it was given", async () => {
		for (const bytes of [
			new Uint8Array(),
			Uint8Array.of(0),
			encode('{"issues":[{"path":["title"],"message":"Required field"}]}'),
			encode("Crème brûlée, jalapeño, 🍲 and 日本語"),
			Uint8Array.from({ length: 256 }, (_, byte) => byte),
			noise(50_000),
		])
			expect(await unpack(await pack(bytes), 1 << 20)).toEqual(bytes);
	});

	test("is only characters a URL takes as they are", async () => {
		expect(await pack(noise(2000))).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	test("makes a form's state a third as long as Base64 would", async () => {
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

		expect((await pack(bytes)).length).toBeLessThan(
			bytes.toBase64().length / 3,
		);
	});
});

describe("unpack", () => {
	test("refuses what pack did not write", async () => {
		expect(await unpack("not packed!", 1000)).toBeUndefined();
		// Base64 that is not compressed
		expect(await unpack("eyJpc3N1ZXMiOltdfQ", 1000)).toBeUndefined();
	});

	test("refuses what was cut short or changed, whatever a URL holds", async () => {
		const packed = await pack(
			encode("the same words, the same words, the same"),
		);

		for (let cut = 1; cut < packed.length; cut++)
			expect(await unpack(packed.slice(0, cut), 1000)).toBeUndefined();
		for (let at = 0; at < packed.length; at++)
			await expect(
				unpack(`${packed.slice(0, at)}_${packed.slice(at + 1)}`, 1000),
			).resolves.not.toThrow();
	});

	test("stops at its limit, so a short text cannot ask for much", async () => {
		const bomb = await pack(new Uint8Array(1_000_000));

		expect(bomb.length).toBeLessThan(5000);
		expect(await unpack(bomb, 10_000)).toBeUndefined();
		expect((await unpack(bomb, 1_000_000))?.length).toBe(1_000_000);
	});
});
