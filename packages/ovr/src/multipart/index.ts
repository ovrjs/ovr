import { encoder } from "../util/encoder.js";
import { parseHeader } from "../util/parse-header.js";

class ParseContext {
	/** Request body reader */
	reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;

	/** Current chunk(s) in the buffer */
	buffer!: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;

	/** Start index of the found needle */
	start = 0;

	/** End index of the found needle */
	end = 0;

	find: (needle: Needle) => Uint8Array<ArrayBuffer> | undefined;

	findStream: (needle: Needle) => ReadableStream<Uint8Array<ArrayBuffer>>;

	/**
	 * Use `ParseContext.init` to create a new parse context and read
	 * the first chunk into the buffer.
	 *
	 * @param reader
	 */
	constructor(reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>) {
		this.reader = reader;

		this.find = (needle) => {
			if (!this.buffer.value) return;

			const haystackLength = this.buffer.value.length;

			for (
				// start the search at the last char of the needle
				// since it could be at the very start
				let cursor = needle.end;
				cursor < haystackLength; // end - not found
				cursor += needle.skip[this.buffer.value[cursor]!]!
			) {
				for (
					let needleIndex = needle.end;
					needleIndex >= 0 &&
					needle.bytes[needleIndex] === this.buffer.value[cursor];
					needleIndex--, cursor-- // check previous char when there's a match
				) {
					if (needleIndex === 0) {
						// all characters match
						this.start = cursor;
						this.end = cursor + needle.length;
						return this.shift();
					}
				}
			}

			if (needle.length < haystackLength) {
				// where to safely start the next search in the concatenated chunk result
				// go back len - 1 in case it was partially at the end
				this.start = this.buffer.value.length - (needle.length - 1);
				this.end = this.buffer.value.length - 1;
			} else {
				this.start = 0;
				this.end = 0;
			}
		};

		this.findStream = (needle) =>
			new ReadableStream({
				type: "bytes",
				pull: async (controller) => {
					if (!this.buffer.value) return;

					for (;;) {
						const found = this.find(needle);

						if (found) {
							// found within current chunk
							console.log("found");
							controller.enqueue(found);
							break;
						}

						// not found within current chunk
						console.log("not found");

						let cursor = this.buffer.value.length - 1;
						const lastByte = this.buffer.value[cursor]!;
						const needleIndices = needle.map[lastByte];

						if (needleIndices) {
							// last char is in the boundary, check for partial boundary
							for (
								// iterate backwards through the indices
								let byteIndex = needleIndices.length - 1;
								byteIndex >= 0;
								byteIndex--
							) {
								for (
									let needleIndex = needleIndices[byteIndex]!;
									needleIndex <= 0 &&
									needle.bytes[needleIndex] === this.buffer.value[cursor];
									needleIndex--, cursor--
								) {
									if (needleIndex === 0) {
										this.start = this.end = cursor;
										// rerun check if next has the rest
									}
								}
							}
						}

						const before = this.shift();

						if (before.length) {
							controller.enqueue(before);
						}

						await this.concatNext();
					}

					controller.close();
				},
			});
	}

	static async init(
		reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>,
	) {
		const pc = new ParseContext(reader);
		pc.buffer = await pc.reader.read();
		return pc;
	}

	shift() {
		const before = this.buffer.value!.slice(0, this.start);
		this.buffer.value = this.buffer.value!.slice(this.end); // after
		this.start = 0;
		this.end = 0;

		return before;
	}

	async concatNext() {
		const next = await this.reader.read();

		if (this.buffer.done || next.done) return false;

		const result = new Uint8Array(this.buffer.value.length + next.value.length);

		result.set(this.buffer.value!);
		result.set(next.value, this.buffer.value.length);

		this.buffer.value = result;

		return true;
	}

	async findConcat(needle: Needle) {
		if (!this.buffer.value) return;

		for (;;) {
			// try to find in the next chunk
			const found = this.find(needle);
			if (found) return found;

			if (!(await this.concatNext())) return; // no more chunks
		}
	}
}

class Needle {
	/** Sequence of bytes to find */
	bytes: Uint8Array<ArrayBuffer>;

	/** Length of the needle */
	length: number;

	/** Index of the last character in the needle */
	end: number;

	/**
	 * Stores the how far from the last character each char in the needle is so
	 * the iterator know how far to safely skip forward when the character is
	 * found the rest of the array is filled with the length (default skip)
	 */
	skip: Uint8Array<ArrayBuffer>;

	/** Stores where each byte is located in the needle */
	map: Record<string, number[]> = {};

	constructor(pattern: string) {
		this.bytes = encoder.encode(pattern);
		this.length = this.bytes.length;
		this.end = this.length - 1;
		this.skip = new Uint8Array(256).fill(this.length);

		for (let i = 0; i < this.length; i++) {
			const byte = this.bytes[i]!;

			if (i !== this.end) {
				// skip the last char of the needle since that would be a find
				this.skip[byte] = this.end - i;
			}

			this.map[byte] ??= [];
			this.map[byte].push(i);
		}
	}
}

export class Parser {
	readonly #req: Request;

	constructor(req: Request) {
		this.#req = req;
	}

	static #headers(raw: string) {
		const headers = new Headers();
		const lines = raw.split("\r\n");

		for (const line of lines) {
			const [name, value] = line.split(":");
			if (name && value) headers.append(name, value);
		}

		return headers;
	}

	static #CRLF = new Needle("\r\n\r\n");

	/**
	 * Handle multi-part form data streams.
	 *
	 * @yields Form data `Part`s
	 */
	async *data() {
		const reader = this.#req.body?.getReader();
		const decoder = new TextDecoder();
		const boundaryStr = parseHeader(this.#req.headers.get("content-type")).get(
			"boundary",
		);

		if (!boundaryStr || !reader) return;

		const pc = await ParseContext.init(reader);

		const boundary = new Needle(`--${boundaryStr}\r\n`);

		if (!(await pc.findConcat(boundary))) return;

		const headers = Parser.#headers(
			decoder.decode(await pc.findConcat(Parser.#CRLF)),
		);

		const part = new Part(headers, pc.findStream(boundary));

		console.log(part);

		yield part;
	}
}

export class Part {
	/** Form input `name` attribute */
	readonly name: string;

	/** Filename from Content-Disposition header if file */
	readonly filename?: string;

	/** Headers of the part */
	readonly headers: Headers;

	/** Part body */
	readonly body: ReadableStream<Uint8Array<ArrayBuffer>>;

	/**
	 * Create a new multi-part part.
	 *
	 * @param headers
	 * @param body
	 */
	constructor(headers: Headers, body: ReadableStream<Uint8Array<ArrayBuffer>>) {
		this.headers = headers;
		this.body = body;

		const disposition = parseHeader(headers.get("content-disposition"));

		this.filename = disposition.get("filename");

		const name = disposition.get("name");
		if (name === undefined) throw new Error("Input name not found.");
		this.name = name;
	}

	/**
	 * Parse the part body with a specific parser function.
	 *
	 * @example await part.parse(Number) // returns number
	 * @example await part.parse(JSON.parse) // returns any
	 */
	parse<T>(parser: (buffer: string) => T): Promise<T>;
	/**
	 * Buffers the part body and returns it as a string.
	 *
	 * @example await part.parse() // returns string
	 */
	parse(): Promise<string>;
	async parse<T>(parser?: (buffer: string) => T) {
		const decoder = new TextDecoder();
		const reader = this.body.getReader();
		let buffer = "";

		while (true) {
			const chunk = await reader.read();
			console.log({ chunk });
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value);
		}

		// buffer = buffer.trim(); //?????????

		if (parser) return parser(buffer);

		return buffer;
	}
}
