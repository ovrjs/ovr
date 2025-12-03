import { parseMultipartRequest } from "@remix-run/multipart-parser";
import * as ovr from "ovr";
import { bench, describe } from "vitest";

const logMemory = true;

const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
const encoder = new TextEncoder();

// Memory tracker helper (tweaked for better peak detection)
async function measureMemory(fn: () => Promise<any>) {
	const before = process.memoryUsage();
	// Optional: GC before for cleaner baseline (requires --expose-gc)
	if (global.gc) global.gc();

	let peakHeapUsed = before.heapUsed;

	const interval = setInterval(() => {
		const usage = process.memoryUsage();
		if (usage.heapUsed > peakHeapUsed) peakHeapUsed = usage.heapUsed;
	}, 1); // Faster poll: 1ms for bursty allocations

	const promise = fn();
	// Sample immediately after fn completes (catches post-run peak)
	const postFnSample = () => {
		const usage = process.memoryUsage();
		if (usage.heapUsed > peakHeapUsed) peakHeapUsed = usage.heapUsed;
	};

	return promise
		.finally(() => {
			clearInterval(interval);
			postFnSample();
			// Optional: GC after for net delta accuracy
			if (global.gc) global.gc();
		})
		.then(() => {
			const after = process.memoryUsage();
			return { before, after, peakHeapUsed };
		});
}

function createStreamingSimpleTextRequest() {
	const body = new ReadableStream({
		start(controller) {
			const part = `--${boundary}\r\nContent-Disposition: form-data; name="textField"\r\n\r\nsimple text value\r\n--${boundary}--\r\n`;
			controller.enqueue(encoder.encode(part));
			controller.close();
		},
	});
	return new Request("http://localhost:3000/simple", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
		body,
		// @ts-expect-error - required for streaming
		duplex: "half",
	});
}

// Helper to create a streaming multipart Request with a small text field + large binary file
function createStreamingMixedRequest(mb: number) {
	const size = mb * 1024 * 1024;
	let written = 0;
	const body = new ReadableStream({
		start(controller) {
			const textPart = `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\nsome small text\r\n`;
			const fileHeader = `--${boundary}\r\nContent-Disposition: form-data; name="largeFile"; filename="mixed-large-${mb}mb.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
			controller.enqueue(encoder.encode(textPart + fileHeader));
		},
		pull(controller) {
			if (written >= size) {
				const closing = `\r\n--${boundary}--\r\n`;
				controller.enqueue(encoder.encode(closing));
				controller.close();
				return;
			}
			const chunkSize = Math.min(64 * 1024, size - written); // Simulate 64KB network packets
			const chunk = new Uint8Array(chunkSize);
			for (let i = 0; i < chunkSize; i++) {
				chunk[i] = ((written + i) % 256) + 1; // Simple non-zero pattern
			}
			controller.enqueue(chunk);
			written += chunkSize;
		},
	});
	return new Request("http://localhost:3000/mixed", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
		body,
		// @ts-expect-error - required for streaming
		duplex: "half",
	});
}

// Helper to create a streaming multipart Request with a small text field + 3 large binary files
function createStreamingMultiFileRequest(mb: number) {
	const fileSize = mb * 1024 * 1024;
	const numFiles = 5;
	const written = new Array(numFiles).fill(0); // Track per-file progress
	let currentFile = 0; // Cycle through files
	let totalWritten = 0;
	const totalSize = fileSize * numFiles;

	const body = new ReadableStream({
		start(controller) {
			const textPart = `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\nsome small text\r\n`;
			// Enqueue headers for all 3 files
			const fileHeaders = Array.from(
				{ length: numFiles },
				(_, i) =>
					`--${boundary}\r\nContent-Disposition: form-data; name="largeFile${i + 1}"; filename="multi-large-${i + 1}-${mb}mb.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
			).join("");
			controller.enqueue(encoder.encode(textPart + fileHeaders));
		},
		pull(controller) {
			if (totalWritten >= totalSize) {
				// Close each file body and the multipart
				const closings =
					Array.from({ length: numFiles }, () => "\r\n").join("") +
					`--${boundary}--\r\n`;
				controller.enqueue(encoder.encode(closings));
				controller.close();
				return;
			}

			const file = written[currentFile];
			const remainingInFile = fileSize - file;
			const chunkSize = Math.min(64 * 1024, remainingInFile);
			const chunk = new Uint8Array(chunkSize);
			for (let i = 0; i < chunkSize; i++) {
				chunk[i] = ((file + i) % 256) + 1; // Simple non-zero pattern per file
			}
			controller.enqueue(chunk);
			written[currentFile] += chunkSize;
			totalWritten += chunkSize;

			if (written[currentFile] >= fileSize) {
				// File done: Enqueue \r\n boundary transition (but since headers are pre-enqueued, just switch)
				controller.enqueue(encoder.encode("\r\n")); // End current body, start next header (already enqueued)
				currentFile = (currentFile + 1) % numFiles;
				if (currentFile === 0 && totalWritten < totalSize) {
					// All files started; continue cycling if needed (but with 3, it's sequential)
				}
			}
		},
	});
	return new Request("http://localhost:3000/multi", {
		method: "POST",
		headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
		body,
		// @ts-expect-error - required for streaming
		duplex: "half",
	});
}

async function consumeOvr(req: Request): Promise<void> {
	const result = await measureMemory(async () => {
		for await (const _part of ovr.Parser.data(req));
	});
	if (logMemory)
		console.log("ovr memory:", {
			heapDelta: result.after.heapUsed - result.before.heapUsed,
			peakHeapUsed: result.peakHeapUsed - result.before.heapUsed,
			rssDelta: result.after.rss - result.before.rss,
		});
}

async function consumeRemix(req: Request): Promise<void> {
	const result = await measureMemory(async () => {
		for await (const _part of parseMultipartRequest(req, {
			maxFileSize: 3000 * 1024 * 1024,
		}));
	});
	if (logMemory)
		console.log("remix memory:", {
			heapDelta: result.after.heapUsed - result.before.heapUsed,
			peakHeapUsed: result.peakHeapUsed - result.before.heapUsed,
			rssDelta: result.after.rss - result.before.rss,
		});
}

describe("text", () => {
	const req = createStreamingSimpleTextRequest();

	bench("ovr", async () => {
		await consumeOvr(req.clone());
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});

describe("10MB file", () => {
	const req = createStreamingMixedRequest(10);

	bench("ovr", async () => {
		await consumeOvr(req.clone());
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});

describe("100MB file", () => {
	const req = createStreamingMixedRequest(100);

	bench("ovr", async () => {
		await consumeOvr(req.clone());
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});

// describe("1000MB file", () => {
// 	const req = createStreamingMixedRequest(1000);

// 	bench("ovr", async () => {
// 		await consumeOvr(req.clone());
// 	});

// 	bench("remix", async () => {
// 		await consumeRemix(req.clone());
// 	});
// });

describe("5x 100MB files", () => {
	const req = createStreamingMultiFileRequest(100);

	bench("ovr", async () => {
		await consumeOvr(req.clone());
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});
