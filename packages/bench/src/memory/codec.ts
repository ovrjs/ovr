/**
 * The most memory reading a whole body takes, as the MCP endpoint reads a
 * JSON-RPC request and a route's response: `Codec.read` against the way it
 * read bodies before, which joined the chunks once all had arrived.
 *
 * Node's counters do not count resizable buffers consistently, so this
 * compares the process's peak resident memory instead, each way in a fresh
 * process, reading a body large enough to stand out from the rest, and
 * collecting as it reads so chunks already copied are not counted.
 *
 * node packages/bench/src/memory/codec.ts
 *
 * `node packages/bench/src/memory/codec.ts speed` times both ways instead,
 * for bodies of one chunk and of many.
 */
import { Codec } from "../../../ovr/dist/util/index.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const size = 64 * 1024 * 1024;
const chunk = 64 * 1024;

/** The previous `Codec.read`, for comparison */
const before = async (body: ReadableStream<Uint8Array>, limit: number) => {
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if ((size += value.length) > limit) {
			await reader.cancel();
			return;
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
};

const gc = (globalThis as { gc?: () => void }).gc;

/**
 * @param length Bytes
 * @returns A body of `length` bytes in 64 KiB chunks, collecting garbage
 * every 64 chunks when run with `--expose-gc`, so the peak is what is held
 * rather than chunks waiting to be collected
 */
const body = (length = size) => {
	let sent = 0;
	return new ReadableStream<Uint8Array>({
		pull(c) {
			if (gc && (sent / chunk) % 64 === 63) gc();
			if (sent >= length) return c.close();
			c.enqueue(new Uint8Array(Math.min(chunk, length - sent)).fill(97));
			sent += chunk;
		},
	});
};

const variant = process.argv[2];

if (variant === "speed") {
	for (const [length, limit, times] of [
		[2_000, 16 * 1024, 20_000],
		[100 * 1024, 4 * 1024 * 1024, 5_000],
		[4 * 1024 * 1024, 4 * 1024 * 1024, 200],
	] as const) {
		for (const [name, read] of [
			["before", before],
			["after", Codec.read],
		] as const) {
			const runs: string[] = [];
			for (let run = 0; run < 3; run++) {
				const time = performance.now();
				for (let i = 0; i < times; i++) await read(body(length), limit);
				runs.push((((performance.now() - time) / times) * 1000).toFixed(1));
			}
			console.log(`${length} bytes, ${name}: ${runs.join(", ")} µs per read`);
		}
	}
} else if (variant) {
	const read = variant === "before" ? before : Codec.read;
	const start = process.resourceUsage().maxRSS;
	const time = performance.now();
	const bytes = await read(body(), size);
	const ms = performance.now() - time;
	console.log(
		`${variant}: peak resident memory grew ${((process.resourceUsage().maxRSS - start) / 1024).toFixed(1)} MB to read ${bytes!.length / 1024 / 1024} MB, ${ms.toFixed(1)} ms`,
	);
} else {
	const self = fileURLToPath(import.meta.url);
	for (let run = 0; run < 3; run++)
		for (const name of ["before", "after"])
			process.stdout.write(
				execFileSync(process.execPath, ["--expose-gc", self, name], {
					encoding: "utf8",
				}),
			);
}
