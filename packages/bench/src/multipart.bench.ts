import { parseMultipartRequest } from "@remix-run/multipart-parser";
import * as ovr from "ovr";
import { bench, describe } from "vitest";

// Helper to create a large binary buffer (e.g., 10MB file for benchmarking)
function createLargeBuffer(sizeInMB: number): Uint8Array {
	const size = sizeInMB * 1024 * 1024;
	const buffer = new Uint8Array(size);
	// Fill with a simple pattern to avoid zeroed memory optimizations
	for (let i = 0; i < size; i++) {
		buffer[i] = (i % 256) + 1; // Non-zero bytes
	}
	return buffer;
}

// Helper to create a multipart Request with a large file
function createLargeFileRequest(sizeInMB: number): Request {
	const formData = new FormData();
	const largeBuffer = createLargeBuffer(sizeInMB);
	const largeFile = new File(
		[largeBuffer as any],
		`large-file-${sizeInMB}mb.bin`,
		{ type: "application/octet-stream" },
	);
	formData.append("largeFile", largeFile);

	return new Request("http://localhost:3000/upload", {
		method: "POST",
		body: formData,
	});
}

// Helper to create a simple text-only multipart Request (for baseline comparison)
function createSimpleTextRequest(): Request {
	const formData = new FormData();
	formData.append("textField", "simple text value");

	return new Request("http://localhost:3000/simple", {
		method: "POST",
		body: formData,
	});
}

// Helper to create a mixed request with one large file + small text field
function createMixedRequest(sizeInMB: number): Request {
	const formData = new FormData();
	const largeBuffer = createLargeBuffer(sizeInMB);
	const largeFile = new File(
		[largeBuffer as any],
		`mixed-large-${sizeInMB}mb.bin`,
		{ type: "application/octet-stream" },
	);
	formData.append("largeFile", largeFile);
	formData.append("metadata", "some small text");

	return new Request("http://localhost:3000/mixed", {
		method: "POST",
		body: formData,
	});
}

// Helper to fully consume the multipart stream for ovr (iterate parts and drain bodies manually)
async function consumeOvr(req: Request): Promise<void> {
	const parser = new ovr.Parser(req, { max: 50 * 1024 * 1024 });
	for await (const _part of parser.data());
}

// Helper to fully consume the multipart stream for remix (iterate parts and drain bodies)
async function consumeRemix(req: Request): Promise<void> {
	for await (const _part of parseMultipartRequest(req, {
		maxFileSize: 50 * 1024 * 1024,
	}));
}

describe("simple text", () => {
	// Baseline: Simple text-only request (small payload)
	const simpleReq = createSimpleTextRequest();

	bench("ovr: simple text (drain stream)", async () => {
		await consumeOvr(simpleReq.clone());
	});

	bench("remix: simple text (drain stream)", async () => {
		await consumeRemix(simpleReq.clone());
	});
});

describe("10MB file", () => {
	// Large file: 10MB binary file (single part)
	const largeReq10mb = createLargeFileRequest(10);

	bench("ovr: 10MB file (drain stream)", async () => {
		await consumeOvr(largeReq10mb.clone()); // 16MB max buffer
	});

	bench("remix: 10MB file (drain stream)", async () => {
		await consumeRemix(largeReq10mb.clone());
	});
});

describe("50MB file", () => {
	// Even larger: 50MB binary file (for more stress testing)
	// Note: This may be too large for quick benches; consider running separately
	const largeReq50mb = createLargeFileRequest(50);

	bench("ovr: 50MB file (drain stream)", async () => {
		await consumeOvr(largeReq50mb.clone()); // Larger buffer allowance
	});

	bench("remix: 50MB file (drain stream)", async () => {
		await consumeRemix(largeReq50mb.clone());
	});
});

describe("mixed 10MB", () => {
	const mixedReq10mb = createMixedRequest(10);

	bench("ovr: mixed 10MB (drain stream)", async () => {
		await consumeOvr(mixedReq10mb.clone());
	});

	bench("remix: mixed 10MB (drain stream)", async () => {
		await consumeRemix(mixedReq10mb.clone());
	});
});
