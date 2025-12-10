import { parseMultipartRequest } from "@remix-run/multipart-parser";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Multipart } from "ovr";
import { bench, describe } from "vitest";

const benchMemory = false;

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
	const consume = async () => {
		for await (const _part of new Multipart(req, { payload: Infinity }));
	};

	if (benchMemory) {
		const result = await measureMemory(consume);
		if (benchMemory)
			console.log("ovr memory:", {
				heapDelta: result.after.heapUsed - result.before.heapUsed,
				peakHeapUsed: result.peakHeapUsed - result.before.heapUsed,
				rssDelta: result.after.rss - result.before.rss,
			});
	} else {
		await consume();
	}
}

async function consumeRemix(req: Request): Promise<void> {
	const consume = async () => {
		for await (const _ of parseMultipartRequest(req, {
			maxFileSize: Infinity,
		}));
	};

	if (benchMemory) {
		const result = await measureMemory(consume);
		if (benchMemory)
			console.log("remix memory:", {
				heapDelta: result.after.heapUsed - result.before.heapUsed,
				peakHeapUsed: result.peakHeapUsed - result.before.heapUsed,
				rssDelta: result.after.rss - result.before.rss,
			});
	} else {
		await consume();
	}
}

async function generateTempFilename(): Promise<string> {
	const tempDir = os.tmpdir();
	const randomSuffix = crypto.randomBytes(8).toString("hex");
	return path.join(tempDir, `bench-file-${randomSuffix}.bin`);
}

async function cleanupTempFile(tempFile: string): Promise<void> {
	await fs.promises.unlink(tempFile).catch(() => {}); // Ignore if already deleted
}

async function processOvr(req: Request): Promise<void> {
	const tempFile = await generateTempFilename();
	try {
		const multipart = new Multipart(req, { payload: Infinity });
		for await (const part of multipart) {
			if (!part.filename) {
				// Consume small text parts minimally
				await part.text();
			} else {
				// Stream write the file part to disk
				const writeStream = fs.createWriteStream(tempFile);
				const writePromise = new Promise<void>((resolve, reject) => {
					writeStream.on("finish", resolve);
					writeStream.on("error", reject);
				});
				try {
					const reader = part.body.getReader();
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							writeStream.write(value);
						}
					} finally {
						reader.releaseLock();
					}
					writeStream.end();
					await writePromise;
				} catch (e) {
					writeStream.destroy(e as Error);
					throw e;
				}
			}
		}
	} finally {
		await cleanupTempFile(tempFile);
	}
}

async function processRemix(req: Request): Promise<void> {
	const tempFile = await generateTempFilename();
	try {
		for await (const part of parseMultipartRequest(req, {
			maxFileSize: Infinity,
		})) {
			if (part.filename) {
				// Buffered write the file part to disk
				fs.writeFileSync(tempFile, part.bytes);
			}
			// Text parts are auto-consumed by the parser
		}
	} finally {
		await cleanupTempFile(tempFile);
	}
}

describe("Multipart", () => {
	describe("consume", () => {
		describe.skip("text", () => {
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

		describe.skip("100MB file", () => {
			const req = createStreamingMixedRequest(100);

			bench("ovr", async () => {
				await consumeOvr(req.clone());
			});

			bench("remix", async () => {
				await consumeRemix(req.clone());
			});
		});

		describe.skip("1GB file", () => {
			const req = createStreamingMixedRequest(1024);

			bench("ovr", async () => {
				await consumeOvr(req.clone());
			});

			bench("remix", async () => {
				await consumeRemix(req.clone());
			});
		});

		describe.skip("5x 100MB files", () => {
			const req = createStreamingMultiFileRequest(100);

			bench("ovr", async () => {
				await consumeOvr(req.clone());
			});

			bench("remix", async () => {
				await consumeRemix(req.clone());
			});
		});
	});

	describe("write to disk", () => {
		describe("10MB file", () => {
			const req = createStreamingMixedRequest(10);

			bench("ovr", async () => {
				await processOvr(req.clone());
			});

			bench("remix", async () => {
				await processRemix(req.clone());
			});
		});

		describe.skip("100MB file", () => {
			const req = createStreamingMixedRequest(100);

			bench(
				"ovr",
				async () => {
					await processOvr(req.clone());
				},
				{ iterations: 1 },
			);

			bench(
				"remix",
				async () => {
					await processRemix(req.clone());
				},
				{ iterations: 1 },
			);
		});

		describe.skip("1GB file", () => {
			const req = createStreamingMixedRequest(1024);

			bench(
				"ovr",
				async () => {
					await processOvr(req.clone());
				},
				{ iterations: 1 },
			);

			bench(
				"remix",
				async () => {
					await processRemix(req.clone());
				},
				{ iterations: 1 },
			);
		});
	});
});
