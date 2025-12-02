import { Parser } from "./index.js";
import { describe, expect, it } from "vitest";

/**
 * Creates a ReadableStream that yields the provided chunks.
 * This simulates network packets arriving one by one.
 */
function createStreamFromChunks(
	chunks: Uint8Array[],
): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(chunk);
			}
			controller.close();
		},
	});
}

/**
 * Creates a multipart payload string.
 */
function createMultipartPayload(
	boundary: string,
	parts: { name: string; filename?: string; content: string }[],
) {
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
}

describe("MultipartParser", () => {
	it("should parse simple text fields", async () => {
		const formData = new FormData();
		formData.append("username", "alice");
		formData.append("role", "admin");

		const req = new Request("http://localhost:3000", {
			method: "POST",
			body: formData,
		});

		const parser = new Parser(req);

		let i = 0;
		for await (const part of parser.data()) {
			i++;

			if (part.name === "username") {
				const username = await part.text();
				expect(username).toBe("alice");
			} else if (part.name === "") {
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

		const parser = new Parser(req);

		let i = 0;
		for await (const part of parser.data()) {
			i++;

			if (part.name === "") {
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

		const parser = new Parser(req);

		for await (const part of parser.data()) {
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

		const parser = new Parser(req);

		let i = 0;
		for await (const part of parser.data()) {
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
		const payload = createMultipartPayload(BOUNDARY, [
			{ name: "field1", content: "value1" },
			{ name: "file1", filename: "test.txt", content: "file content" },
		]);

		const req = new Request("http://localhost", {
			method: "POST",
			headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
			body: payload,
		});

		const parser = new Parser(req);
		const parts = [];

		for await (const part of parser.data()) {
			parts.push({
				name: part.name,
				filename: part.filename,
				body: await part.text(),
			});
		}

		expect(parts).toHaveLength(2);
		expect(parts[0]).toEqual({
			name: "field1",
			filename: undefined,
			body: "value1",
		});
		expect(parts[1]).toEqual({
			name: "file1",
			filename: "test.txt",
			body: "file content",
		});
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
					body: createStreamFromChunks([chunk1, chunk2]),
					// @ts-expect-error - required for streaming
					duplex: "half",
				});

				const parser = new Parser(req);
				let partCount = 0;

				for await (const part of parser.data()) {
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

			const payload = createMultipartPayload(BOUNDARY, [
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
				body: createStreamFromChunks([chunk1, chunk2]),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			const parser = new Parser(req);

			for await (const part of parser.data()) {
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
				body: createStreamFromChunks(chunks),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			const parser = new Parser(req);
			let found = false;

			for await (const part of parser.data()) {
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

			const stream = createStreamFromChunks([header, chunk1, chunk2, footer]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: stream,
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			const parser = new Parser(req);

			for await (const part of parser.data()) {
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
				body: createStreamFromChunks([
					new TextEncoder().encode(headerPart1),
					new TextEncoder().encode(headerPart2),
				]),
				// @ts-expect-error - required for streaming
				duplex: "half",
			});

			const parser = new Parser(req);
			for await (const part of parser.data()) {
				expect(part.name).toBe("splitHeader");
				expect(await part.text()).toBe("value");
			}
		});

		it("ignores preamble and epilogue data", async () => {
			const preamble = "This is preamble text that should be ignored\r\n";
			const epilogue = "\r\nThis is epilogue text";

			const payload = createMultipartPayload(BOUNDARY, [
				{ name: "data", content: "foo" },
			]);

			const req = new Request("http://localhost", {
				method: "POST",
				headers: {
					"content-type": `multipart/form-data; boundary=${BOUNDARY}`,
				},
				body: preamble + payload + epilogue,
			});

			const parser = new Parser(req);
			let count = 0;
			for await (const part of parser.data()) {
				expect(part.name).toBe("data");
				expect(await part.text()).toBe("foo");
				count++;
			}
			expect(count).toBe(1);
		});
	});
});
