import { baseline } from "./baseline.js";
import { Multipart } from "ovr";
import { bench, describe, expect } from "vitest";

const { Multipart: Before }: { Multipart: typeof Multipart } = await import(
	baseline("multipart")
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
		else {
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

const parsers = { before: Before, after: Multipart };
for (const workload of workloads) {
	for (const parser of Object.values(parsers)) {
		expect(await consume(parser, workload.body, workload.size)).toEqual({
			parts: workload.parts,
			bytes: workload.bytes,
		});
	}
	describe(`Multipart compaction: ${workload.name}`, () => {
		for (const [name, parser] of Object.entries(parsers)) {
			bench(
				name,
				async () => {
					await consume(parser, workload.body, workload.size);
				},
				{ time: 2000, warmupTime: 1000, setup: () => global.gc?.() },
			);
		}
	});
}
