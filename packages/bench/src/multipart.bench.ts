import { baseline } from "./baseline.js";
import type { Multipart } from "ovr";
import { bench, describe, expect } from "vitest";

const { Multipart: Before }: { Multipart: typeof Multipart } = await import(
	baseline("multipart")
);
const { Multipart: Compaction }: { Multipart: typeof Multipart } = await import(
	baseline("multipart", {}, "1ded0b04d90b8c00ab1462624d7f842714685c01")
);
const { Multipart: After }: { Multipart: typeof Multipart } = await import(
	new URL("../../ovr/dist/multipart/index.js", import.meta.url).href
);
const boundary = "ovr-bench-boundary";
const encoder = new TextEncoder();
const workloads = [
	{
		name: "1000 fields, 1 MiB chunks",
		body: encoder.encode(
			Array.from(
				{ length: 1000 },
				(_, i) =>
					`--${boundary}\r\nContent-Disposition: form-data; name="field-${i}"\r\n\r\n${"x".repeat(1024)}\r\n`,
			).join("") + `--${boundary}--\r\n`,
		),
		size: 1024 * 1024,
		parts: 1000,
		bytes: 1000 * 1024,
	},
	{
		name: "10 MiB file, 64 KiB chunks",
		body: encoder.encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="file.bin"\r\nContent-Type: application/octet-stream\r\n\r\n${"x".repeat(10 * 1024 * 1024)}\r\n--${boundary}--\r\n`,
		),
		size: 64 * 1024,
		parts: 1,
		bytes: 10 * 1024 * 1024,
	},
];

async function consume(
	parser: typeof Multipart,
	bytes: Uint8Array,
	size: number,
	byob = false,
) {
	let offset = 0;
	const request = new Request("http://localhost/multipart", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
		body: new ReadableStream(
			{
				pull(controller) {
					if (offset === bytes.length) controller.close();
					else {
						controller.enqueue(bytes.subarray(offset, offset + size));
						offset = Math.min(offset + size, bytes.length);
					}
				},
			},
			{ highWaterMark: 0 },
		),
		// @ts-expect-error - Node requires duplex for streaming request bodies
		duplex: "half",
	});
	let parts = 0;
	let length = 0;
	for await (const part of new parser(request)) {
		parts++;
		if (!part.filename) length += (await part.text()).length;
		else if (byob) {
			const reader = part.body.getReader({ mode: "byob" });
			let buffer = new ArrayBuffer(64 * 1024);
			try {
				while (true) {
					const result = await reader.read(new Uint8Array(buffer));
					if (result.value) {
						length += result.value.byteLength;
						buffer = result.value.buffer;
					}
					if (result.done) break;
				}
			} finally {
				reader.releaseLock();
			}
		} else {
			const reader = part.body.getReader();
			try {
				while (true) {
					const result = await reader.read();
					if (result.done) break;
					length += result.value.byteLength;
				}
			} finally {
				reader.releaseLock();
			}
		}
	}
	return { parts, bytes: length };
}

const parsers = { before: Before, compaction: Compaction, after: After };
for (const workload of workloads) {
	for (const byob of workload.parts === 1 ? [false, true] : [false]) {
		for (const parser of Object.values(parsers)) {
			expect(await consume(parser, workload.body, workload.size, byob)).toEqual(
				{ parts: workload.parts, bytes: workload.bytes },
			);
		}
		describe(`Multipart parsing: ${workload.name}${byob ? " / BYOB" : ""}`, () => {
			for (const [name, parser] of process.env.OVR_BENCH_REVERSE === "1"
				? Object.entries(parsers).toReversed()
				: Object.entries(parsers)) {
				bench(
					name,
					async () => {
						await consume(parser, workload.body, workload.size, byob);
					},
					{ time: 2000, warmupTime: 1000, setup: () => global.gc?.() },
				);
			}
		});
	}
}
