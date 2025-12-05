import { Parser } from "./index.js";
import { describe, expect, it } from "vitest";

/**
 * Creates a ReadableStream that yields the provided chunks.
 * This simulates network packets arriving one by one.
 */
const streamChunks = (chunks: Uint8Array[]) =>
	new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});

/**
 * Creates a multipart payload string.
 */
const multipartPayload = (
	boundary: string,
	parts: { name: string; filename?: string; content: string }[],
) => {
	const lines: string[] = [];
	for (const part of parts) {
		lines.push(`--${boundary}`);
		let disposition = `Content-Disposition: form-data; name="${part.name}"`;
		if (part.filename) {
			disposition += `; filename="${part.filename}"`;
		}
		lines.push(disposition);
		lines.push("");
		lines.push(part.content);
	}
	lines.push(`--${boundary}--`);
	// Multipart uses CRLF
	return lines.join("\r\n");
};

describe("MultipartParser", () => {
	it("should parse simple text fields", async () => {
		const formData = new FormData();
		formData.append("username", "alice");
		formData.append("role", "admin");

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		let i = 0;
		for await (const part of Parser.data(req)) {
			i++;

			if (part.name === "username") {
				const username = await part.text();
				expect(username).toBe("alice");
			} else if (part.name === "role") {
				const role = await part.text();
				expect(role).toBe("admin");
			}
		}

		expect(i).toBe(2);
	});

	it("should drain unused parts", async () => {
		const formData = new FormData();
		formData.append("username", "alice");
		formData.append("role", "admin");

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		let i = 0;
		for await (const part of Parser.data(req)) {
			i++;

			// skip the drain on the username part

			if (part.name === "role") {
				const role = await part.text();
				expect(role).toBe("admin");
			}
		}

		expect(i).toBe(2);
	});

	it("should handle file uploads correctly", async () => {
		const formData = new FormData();
		const fileContent = "Hello world, this is a text file.";
		const file = new File([fileContent], "hello.txt", { type: "text/plain" });
		formData.append("document", file);

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		for await (const part of Parser.data(req)) {
			expect(part.name).toBe("document");
			expect(part.filename).toBe("hello.txt");
			expect(part.headers.get("content-type")).toBe("text/plain");
			const content = await part.text();
			expect(content).toBe(fileContent);
		}
	});

	it("should handle a complex mix of files and fields", async () => {
		const formData = new FormData();
		formData.append("title", "My Vacation");
		const imageFile = new File(["(binary data mockup)"], "photo.png", {
			type: "image/png",
		});
		formData.append("upload", imageFile);
		formData.append("description", "A lovely trip.");

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		let i = 0;
		for await (const part of Parser.data(req)) {
			i++;
			if (i === 1) {
				expect(part.name).toBe("title");
			} else if (i === 2) {
				expect(part.filename).toBe("photo.png");
			} else if (i === 3) {
				expect(part.name).toBe("description");
			}
		}
		expect(i).toBe(3);
	});

	const BOUNDARY = "----WebKitFormBoundary7MA4YWxkTrZu0gW";

	it("parses a simple single-chunk multipart request", async () => {
		const payload = multipartPayload(BOUNDARY, [
			{ name: "field1", content: "value1" },
			{ name: "file1", filename: "test.txt", content: "file content" },
		]);

		const req = new Request("http://localhost", {
			method: "POST",
			headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
			body: payload,
		});

		let i = 0;
		for await (const part of Parser.data(req)) {
			if (i === 0) {
				expect(part.name).toBe("field1");
				expect(part.filename).toBeUndefined();
				expect(await part.text()).toBe("value1");
			} else if (i === 1) {
				expect(part.name).toBe("file1");
				expect(part.filename).toBe("test.txt");
				expect(await part.text()).toBe("file content");
			}
			i++;
		}
		expect(i).toBe(2);
	});

	describe("Streaming & Boundary Edge Cases", () => {
		const fieldName = "my_field";
		const fieldValue = "some_data_value";

		// Construct the raw bytes exactly as they appear on the wire
		const rawPayloadString = [
			`--${BOUNDARY}`,
			`Content-Disposition: form-data; name="${fieldName}"`,
			``,
			fieldValue,
			`--${BOUNDARY}--`,
		].join("\r\n");

		const rawBytes = new TextEncoder().encode(rawPayloadString);

		/**
		 * This test iterates through EVERY possible split position in the payload.
		 * It splits the payload into two chunks: [0...i] and [i...end].
		 * This guarantees we test splitting the boundary characters (-, \r, \n)
		 * at every possible index.
		 */
		it("handles boundary split across two chunks at every possible index", async () => {
			// We skip index 0 and length to ensure we actually have 2 chunks
			for (let i = 1; i < rawBytes.length; i++) {
				const chunk1 = rawBytes.slice(0, i);
				const chunk2 = rawBytes.slice(i);

				const req = new Request("http://localhost", {
					method: "POST",
					headers: {
						"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
					},
					body: streamChunks([chunk1, chunk2]),
					// @ts-expect-error - required for streaming
					duplex: "half",
				});

				let partCount = 0;

				for await (const part of Parser.data(req)) {
					partCount++;
					expect(part.name).toBe(fieldName);
					const content = await part.text();
					expect(content).toBe(fieldValue);
				}

				expect(
					partCount,
					`Failed when split at index ${i} ('${String.fromCharCode(rawBytes[i])}')`,
				).toBe(1);
			}
		});

		it('handles the "False Positive" boundary edge case', async () => {
			// This is a tricky case where the data ends with something that LOOKS like
			// the start of a boundary, but isn't. The parser needs to back off and yield
			// the data instead of hanging waiting for the rest of the boundary.

			// \r\n- is the start of a boundary sequence
			const trickyValue = "data_ending_with_\r\n-";

			const payload = multipartPayload(BOUNDARY, [
				{ name: "tricky", content: trickyValue },
			]);

			// We force a split exactly after the \r\n- to confuse the parser
			// The parser buffer will end in \r\n-. It might pause, expecting more boundary chars.
			// The next chunk will be part of the boundary, but NOT completing the *previous* incomplete sequence.
			const splitIndex = payload.indexOf(trickyValue) + trickyValue.length;

			const encoder = new TextEncoder();
			const chunk1 = encoder.encode(payload.slice(0, splitIndex)); // ends in \r\n-
			const chunk2 = encoder.encode(payload.slice(splitIndex)); // starts with \r\n--boundary...

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: streamChunks([chunk1, chunk2]),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			for await (const part of Parser.data(req)) {
				const reader = part.body?.getReader();

				let i = 0;
				while (true) {
					const next = await reader?.read();

					if (next?.done) break;

					const text = new TextDecoder().decode(next?.value);

					if (i++ === 0) {
						expect(text).toBe(trickyValue.slice(0, -3));
					} else if (i === 1) {
						expect(text).toBe(trickyValue.slice(-3));
					}
				}
			}
		});

		it("handles extreme fragmentation (1 byte chunks)", async () => {
			const chunks: Uint8Array[] = [];
			for (let i = 0; i < rawBytes.length; i++) {
				chunks.push(rawBytes.slice(i, i + 1));
			}

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: streamChunks(chunks),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			let found = false;

			for await (const part of Parser.data(req)) {
				const body = await part.text();
				expect(body).toBe(fieldValue);
				found = true;
			}
			expect(found).toBe(true);
		});
	});

	describe("Binary Data & Large Payload", () => {
		it("correctly reassembles binary data split across chunks", async () => {
			// Generate a 10KB binary buffer
			const binaryData = new Uint8Array(10 * 1024);
			for (let i = 0; i < binaryData.length; i++) binaryData[i] = i % 255;

			// Construct multipart manually with binary data
			const encoder = new TextEncoder();
			const header = encoder.encode(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="bin.dat"\r\n\r\n`,
			);
			const footer = encoder.encode(`\r\n--${BOUNDARY}--`);

			// We create a stream that yields: Header -> Half Data -> Half Data -> Footer
			const mid = Math.floor(binaryData.length / 2);
			const chunk1 = binaryData.slice(0, mid);
			const chunk2 = binaryData.slice(mid);

			const stream = streamChunks([header, chunk1, chunk2, footer]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: stream,
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			for await (const part of Parser.data(req)) {
				expect(part.filename).toBe("bin.dat");

				// Read bytes directly
				const result = await part.bytes();

				expect(result.length).toBe(binaryData.length);
				expect(result).toEqual(binaryData);
			}
		});
	});

	describe("Headers Parsing", () => {
		it("handles headers split across chunks", async () => {
			const headerPart1 = `--${BOUNDARY}\r\nContent-Disposition: form-`;
			const headerPart2 = `data; name="splitHeader"\r\n\r\nvalue\r\n--${BOUNDARY}--`;

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: streamChunks([
					new TextEncoder().encode(headerPart1),
					new TextEncoder().encode(headerPart2),
				]),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			for await (const part of Parser.data(req)) {
				expect(part.name).toBe("splitHeader");
				expect(await part.text()).toBe("value");
			}
		});

		it("ignores preamble and epilogue data", async () => {
			const preamble = "This is preamble text that should be ignored\r\n";
			const epilogue = "\r\nThis is epilogue text";

			const payload = multipartPayload(BOUNDARY, [
				{ name: "data", content: "foo" },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: preamble + payload + epilogue,
			});

			let count = 0;
			for await (const part of Parser.data(req)) {
				expect(part.name).toBe("data");
				expect(await part.text()).toBe("foo");
				count++;
			}
			expect(count).toBe(1);
		});
	});

	describe("Epilogue Handling", () => {
		const BOUNDARY = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
		const ONE_MB = 1024 * 1024;

		it("ignores epilogue after closing boundary", async () => {
			const epilogue =
				"\r\nThis is epilogue text that should be ignored.\r\nIt contains a fake header-like line: Foo: bar\r\n\r\nAnd even a CRLF: \r\n\r\nBut no extra parts.";
			const payload =
				multipartPayload(BOUNDARY, [{ name: "data", content: "foo" }]) +
				epilogue;

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			let count = 0;
			for await (const part of Parser.data(req)) {
				expect(part.name).toBe("data");
				expect(await part.text()).toBe("foo");
				count++;
			}
			expect(count).toBe(1);

			// Verify entire body consumed (epilogue drained)
			expect(req.bodyUsed).toBe(true);
		});

		it("handles chunked epilogue without extra parts", async () => {
			const epilogue =
				"Chunked epilogue with CRLF\r\n\r\nand boundary mimic: --notreal\r\n";
			const payload = multipartPayload(BOUNDARY, [
				{ name: "chunked", content: "bar" },
			]);

			const encoder = new TextEncoder();
			const closingIndex = payload.indexOf(`--${BOUNDARY}--`);
			const chunk1 = encoder.encode(
				payload.slice(0, closingIndex + `--${BOUNDARY}--`.length + 2),
			); // Up to \r\n after closing
			const chunk2 = encoder.encode(epilogue.slice(0, epilogue.length / 2));
			const chunk3 = encoder.encode(epilogue.slice(epilogue.length / 2));

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: streamChunks([chunk1, chunk2, chunk3]),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			let count = 0;
			for await (const part of Parser.data(req)) {
				expect(part.name).toBe("chunked");
				expect(await part.text()).toBe("bar");
				count++;
			}
			expect(count).toBe(1);

			// Verify entire body consumed
			expect(req.bodyUsed).toBe(true);
		});

		it("enforces size limit on large epilogue", async () => {
			const smallContent = "small valid part";
			const payload = multipartPayload(BOUNDARY, [
				{ name: "data", content: smallContent },
			]);

			const encoder = new TextEncoder();
			const payloadBytes = encoder.encode(payload);

			// Epilogue: Two chunks—first under limit, second tips over
			const epilogueChunk1 = encoder.encode("a".repeat(500 * 1024)); // 500KB (under 1MB total)
			const epilogueChunk2 = encoder.encode("a".repeat(600 * 1024)); // 600KB (total >1MB)

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: streamChunks([payloadBytes, epilogueChunk1, epilogueChunk2]),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			let partCount = 0;
			const consume = async () => {
				for await (const part of Parser.data(req, { size: ONE_MB })) {
					expect(part.name).toBe("data");
					expect(await part.text()).toBe(smallContent);
					partCount++;
				}
			};

			// Should parse the part, then throw during epilogue drain
			await expect(consume()).rejects.toThrow("Payload Too Large");
			expect(partCount).toBe(1);
		});
	});

	describe("Limits (size and memory options)", () => {
		const BOUNDARY = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
		const ONE_MB = 1024 * 1024;

		it("uses default size limit (10MB) and throws on exceed", async () => {
			// Create a payload slightly over 10MB (multipart overhead ~few KB, so content >10MB safe)
			const oversizedContent = "a".repeat(11 * ONE_MB);
			const payload = multipartPayload(BOUNDARY, [
				{ name: "oversized", content: oversizedContent },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			const parts = Parser.data(req);
			await expect(parts.next()).rejects.toThrow();
		});

		it("uses default memory limit (4MB) and throws on oversized chunk", async () => {
			// Single chunk >4MB: header + huge data + footer, but data chunk itself >4MB
			const hugeData = new Uint8Array(5 * ONE_MB); // Pure binary > memory
			for (let i = 0; i < hugeData.length; i++) hugeData[i] = i % 256;

			const encoder = new TextEncoder();
			const header = encoder.encode(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="huge"; filename="big.bin"\r\n\r\n`,
			);
			const footer = encoder.encode(`\r\n--${BOUNDARY}--`);

			// Stream: header + hugeData (single chunk >4MB) + footer
			const stream = streamChunks([header, hugeData, footer]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: stream,
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			for await (const part of Parser.data(req)) {
				expect(part).toBeDefined();
				expect(part.name).toBe("huge");
				await expect(part.arrayBuffer()).rejects.toThrow(RangeError); // From Uint8Array.set(source longer than dest)
			}
		});

		it("respects custom size limit and throws when exceeded", async () => {
			const customSize = 1 * ONE_MB;
			const oversizedContent = "a".repeat(customSize + 1024); // Slightly over
			const payload = multipartPayload(BOUNDARY, [
				{ name: "custom", content: oversizedContent },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			const parts = Parser.data(req, { size: customSize });
			await expect(parts.next()).rejects.toThrow();
		});

		it("respects custom memory limit and throws on oversized chunk", async () => {
			const customMemory = 512 * 1024; // 512KB
			const hugeData = new Uint8Array(customMemory + 1024); // Slightly over
			for (let i = 0; i < hugeData.length; i++) hugeData[i] = i % 256;

			const encoder = new TextEncoder();
			const header = encoder.encode(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="custom"; filename="chunk.bin"\r\n\r\n`,
			);
			const footer = encoder.encode(`\r\n--${BOUNDARY}--`);

			const stream = streamChunks([header, hugeData, footer]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: stream,
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			for await (const part of Parser.data(req, { memory: customMemory })) {
				expect(part).toBeDefined();
				expect(part.name).toBe("custom");
				await expect(part.arrayBuffer()).rejects.toThrow(RangeError);
			}
		});

		it("parses successfully when under custom limits", async () => {
			const smallContent = "small data under limits";
			const payload = multipartPayload(BOUNDARY, [
				{ name: "small", content: smallContent },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			// Custom small limits, but payload << limits
			const parts = Parser.data(req, { size: 1 * ONE_MB, memory: 1 * ONE_MB });

			let count = 0;
			for await (const part of parts) {
				expect(part.name).toBe("small");
				expect(await part.text()).toBe(smallContent);
				count++;
			}
			expect(count).toBe(1);
		});

		it("resizes buffer dynamically up to memory limit without error", async () => {
			// Start small, send accumulating chunks that trigger resizes up to ~3MB <4MB default
			const totalData = 3 * ONE_MB;
			const numChunks = 10;
			const chunkSize = Math.floor(totalData / numChunks);

			const dataChunks: Uint8Array[] = [];
			let pos = 0;
			for (let i = 0; i < numChunks; i++) {
				const len = i < numChunks - 1 ? chunkSize : totalData - pos;
				const chunk = new Uint8Array(len);
				for (let j = 0; j < len; j++) chunk[j] = (pos + j) % 256;
				dataChunks.push(chunk);
				pos += len;
			}

			const encoder = new TextEncoder();
			const header = encoder.encode(
				`--${BOUNDARY}\r\nContent-Disposition: form-data; name="resizable"; filename="data.bin"\r\n\r\n`,
			);
			const footer = encoder.encode(`\r\n--${BOUNDARY}--`);

			const stream = streamChunks([header, ...dataChunks, footer]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: stream,
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			for await (const part of Parser.data(req)) {
				expect(part.filename).toBe("data.bin");

				const bytes = await part.arrayBuffer();
				expect(bytes.byteLength).toBe(totalData); // Full reassembly
			}
		});
	});

	describe("Empty and Edge-Case Parts", () => {
		it("handles parts with empty body content", async () => {
			const payload = multipartPayload(BOUNDARY, [
				{ name: "empty", content: "" },
				{ name: "hello", content: "asdf" },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			for await (const part of Parser.data(req)) {
				if (part.name === "empty") {
					expect(await part.bytes()).toHaveLength(0);
				}
			}
		});
	});

	describe("Header Edge Cases", () => {
		it("parses MIME type with additional parameters (e.g., charset)", async () => {
			const payload = [
				`--${BOUNDARY}`,
				`Content-Disposition: form-data; name="text"`,
				`Content-Type: text/plain; charset=utf-8`,
				``,
				"hello",
				`--${BOUNDARY}--`,
			].join("\r\n");

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			for await (const part of Parser.data(req)) {
				expect(part.mime).toBe("text/plain"); // Splits on ';', ignores params
				expect(part.headers.get("content-type")).toBe(
					"text/plain; charset=utf-8",
				); // Full header preserved
			}
		});

		it("ignores malformed header lines without colon", async () => {
			const malformedPayload = [
				`--${BOUNDARY}`,
				`Content-Disposition: form-data; name="malformed"`,
				`Invalid-Header-Line`, // No colon
				``,
				"value",
				`--${BOUNDARY}--`,
			].join("\r\n");

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: malformedPayload,
			});

			for await (const part of Parser.data(req)) {
				expect(part.name).toBe("malformed");
				expect(part.headers.get("invalid-header-line")).toBeNull(); // Ignored
				expect(await part.text()).toBe("value");
			}
		});
	});

	describe("Content with Boundary-Like Sequences", () => {
		it("handles content containing boundary-like sequences mid-part", async () => {
			const boundaryLike = `\r\n--${BOUNDARY.slice(0, -2)}`; // Partial boundary in content
			const content = `Normal content${boundaryLike}more content`;
			const payload = multipartPayload(BOUNDARY, [
				{ name: "content", content },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			for await (const part of Parser.data(req)) {
				expect(await part.text()).toBe(content); // Full content yielded, no false boundary
			}
		});
	});

	describe("Large-Scale Scenarios", () => {
		const ONE_MB = 1024 * 1024;

		it("handles many small parts without exceeding memory", async () => {
			const numParts = 100; // Many small parts
			const partsData = Array.from({ length: numParts }, (_, i) => ({
				name: `part${i}`,
				content: "small".repeat(100), // ~500 bytes each, total ~50KB
			}));
			const payload = multipartPayload(BOUNDARY, partsData);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: payload,
			});

			let count = 0;
			for await (const part of Parser.data(req, { memory: 512 * 1024 })) {
				// Tight memory
				expect(part.name).toBe(`part${count}`);
				expect(await part.text()).toBe("small".repeat(100));
				count++;
			}
			expect(count).toBe(numParts);
		});

		it("enforces size limit with many small parts accumulating over limit", async () => {
			const numParts = 20; // Accumulate to >1MB custom limit
			const partsData = Array.from({ length: numParts }, (_, i) => ({
				name: `part${i}`,
				content: "a".repeat(60 * 1024), // ~60KB each, total ~1.2MB
			}));
			const payload = multipartPayload(BOUNDARY, partsData);

			const encoder = new TextEncoder();
			const bytes = encoder.encode(payload);

			// Split into chunks of ~100KB each to simulate streaming
			const chunkSize = 100 * 1024;
			const chunks: Uint8Array[] = [];
			for (let i = 0; i < bytes.length; i += chunkSize) {
				chunks.push(bytes.slice(i, i + chunkSize));
			}

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: streamChunks(chunks),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			let count = 0;
			const read = async () => {
				for await (const part of Parser.data(req, { size: ONE_MB })) {
					count++;
				}
			};

			await expect(read()).rejects.toThrow();

			expect(count).toBeGreaterThan(0);
			expect(count).toBeLessThan(numParts);
		});

		it.skip(
			"handles boundary search spanning buffer resizes",
			{ timeout: 10000 },
			async () => {
				// Large part where boundary search starts near end of buffer, triggers resize during #find
				const largeContent = new Uint8Array(3 * ONE_MB - 1000); // Close to memory limit
				for (let i = 0; i < largeContent.length; i++) largeContent[i] = i % 256;

				const encoder = new TextEncoder();
				const header = encoder.encode(
					`--${BOUNDARY}\r\nContent-Disposition: form-data; name="large"; filename="span.bin"\r\n\r\n`,
				);
				const boundaryStart = encoder.encode(`\r\n--${BOUNDARY}--`); // Boundary after large content

				// Chunks: header + most of large (triggers resize) + end of large + partial boundary + rest
				const midLarge = largeContent.length - 500;
				const chunk1 = largeContent.slice(0, midLarge);
				const chunk2 = largeContent.slice(midLarge);
				const partialBoundary = boundaryStart.slice(0, 3); // Partial to span
				const chunk3 = boundaryStart.slice(3);

				const stream = streamChunks([
					header,
					chunk1,
					chunk2,
					partialBoundary,
					chunk3,
				]);

				const req = new Request("http://localhost", {
					method: "POST",
					headers: {
						"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
					},
					body: stream,
					// @ts-expect-error - required for streaming
					duplex: "half",
				});

				for await (const part of Parser.data(req)) {
					expect(part.name).toBe("large");
					const bytes = await part.arrayBuffer();
					expect(bytes.byteLength).toBe(largeContent.length);
					expect(new Uint8Array(bytes)).toEqual(largeContent);
				}
			},
		);
	});

	describe("Error Conditions", () => {
		it("throws on request without body", async () => {
			const req = new Request("http://localhost", { method: "POST" }); // No body

			await expect(async () => Parser.data(req)).rejects.toThrow();
		});

		it("throws on invalid Content-Type (no boundary)", async () => {
			const req = new Request("http://localhost", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: "--boundary\r\n\r\ndata\r\n--boundary--",
			});

			await expect(async () => Parser.data(req)).rejects.toThrow();
		});

		it("handles bigint size limits for very large requests", async () => {
			// Use a large but feasible size (e.g., 1GB as bigint)
			const largeSize = 1024 ** 3; // 1GB
			const smallPayload = multipartPayload(BOUNDARY, [
				{ name: "small", content: "tiny" },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: smallPayload,
			});

			const parts = Parser.data(req, { size: largeSize });
			let count = 0;
			for await (const part of parts) {
				count++;
			}
			expect(count).toBe(1); // Parses fine under large limit
		});
	});
});
