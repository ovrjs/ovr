import { parseMultipartRequest } from "@remix-run/multipart-parser";
import * as ovr from "ovr";
import { bench, describe } from "vitest";

const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
const encoder = new TextEncoder();

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

// Helper to create a streaming multipart Request with a large binary file (generated in 64KB packets)
function createStreamingLargeFileRequest(mb: number) {
	const size = mb * 1024 * 1024;
	let written = 0;

	const body = new ReadableStream({
		start(controller) {
			const header = `--${boundary}\r\nContent-Disposition: form-data; name="largeFile"; filename="large-file-${mb}mb.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
			controller.enqueue(encoder.encode(header));
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

	return new Request("http://localhost:3000/upload", {
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

// Helper to fully consume the multipart stream for ovr (iterate parts and drain bodies manually)
async function consumeOvr(req: Request) {
	for await (const _part of new ovr.Parser(req).data());
}

// Helper to fully consume the multipart stream for remix (iterate parts and drain bodies)
async function consumeRemix(req: Request) {
	for await (const _part of parseMultipartRequest(req, {
		maxFileSize: 1000 * 1024 * 1024,
	}));
}

describe("simple text", () => {
	// Baseline: Simple text-only request (small payload, streamed)
	const req = createStreamingSimpleTextRequest();

	bench("ovr", async () => {
		await consumeOvr(req.clone());
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});

describe("10MB file", () => {
	// Large file: 10MB binary file (single part, streamed in packets)
	const req = createStreamingLargeFileRequest(10);

	bench("ovr", async () => {
		await consumeOvr(req.clone()); // 50MB max buffer (streams without full load)
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});

describe("50MB file", () => {
	// Even larger: 50MB binary file (for more stress testing, streamed in packets)
	const req = createStreamingLargeFileRequest(50);

	bench("ovr", async () => {
		await consumeOvr(req.clone()); // 50MB max buffer (streams without full load)
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});

describe("mixed 10MB", () => {
	const req = createStreamingMixedRequest(10);

	bench("ovr", async () => {
		await consumeOvr(req.clone());
	});

	bench("remix", async () => {
		await consumeRemix(req.clone());
	});
});
