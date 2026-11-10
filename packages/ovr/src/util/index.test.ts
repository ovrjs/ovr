import { Codec } from "./index.js";
import { describe, expect, test } from "vitest";

/**
 * @param chunks Chunks the body is read in
 * @returns The body, and whether it was cancelled
 */
const body = (...chunks: Uint8Array[]) => {
	const state = { cancelled: false, body: null as ReadableStream | null };
	state.body = new ReadableStream<Uint8Array>({
		pull(c) {
			const chunk = chunks.shift();
			if (chunk) c.enqueue(chunk);
			else c.close();
		},
		cancel() {
			state.cancelled = true;
		},
	});
	return state as { cancelled: boolean; body: ReadableStream<Uint8Array> };
};

const bytes = (text: string) => Codec.encode(text);

describe("Codec.read", () => {
	test("no body is empty", async () => {
		expect(await Codec.read(null, 10)).toEqual(new Uint8Array());
		expect(await Codec.read(body().body, 10)).toEqual(new Uint8Array());
	});

	test("a body of one chunk is that chunk", async () => {
		const chunk = bytes("hello");
		expect(await Codec.read(body(chunk).body, 10)).toBe(chunk);
	});

	test("chunks are joined in order, up to the limit", async () => {
		const read = await Codec.read(
			body(bytes("ab"), bytes("cde"), bytes(""), bytes("fghij")).body,
			10,
		);
		expect(Codec.decode(read)).toBe("abcdefghij");
		expect(read!.length).toBe(10);
	});

	test("many chunks grow the bytes they are copied into", async () => {
		const chunks = Array.from({ length: 100 }, (_, i) => bytes(`${i % 10}`));
		const read = await Codec.read(body(...chunks).body, 1000);
		expect(Codec.decode(read)).toBe("0123456789".repeat(10));
	});

	test("a body over the limit is cancelled", async () => {
		for (const chunks of [
			[bytes("hello world")],
			[bytes("hello"), bytes(" world")],
		]) {
			const state = body(...chunks);
			expect(await Codec.read(state.body, 10)).toBeUndefined();
			expect(state.cancelled).toBe(true);
		}
	});
});
