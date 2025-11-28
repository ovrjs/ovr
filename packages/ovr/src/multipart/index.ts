import { encoder } from "../util/encoder.js";
import { parseHeader } from "../util/parse-header.js";

class ParseContext {
	/** Request body reader */
	reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;

	/** Current chunk(s) in the buffer */
	buffer: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;

	/** Start index of the last item found */
	start = 0;

	/** End index of the last item found */
	end = 0;

	constructor(
		reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>,
		buffer: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>,
	) {
		this.reader = reader;
		this.buffer = buffer;
	}
}

const concat = (...buffers: Uint8Array[]) => {
	let totalLength = 0;
	for (const buffer of buffers) {
		totalLength += buffer.length;
	}

	const result = new Uint8Array(totalLength);

	let i = 0;
	for (const buffer of buffers) {
		result.set(buffer, i);
		i += buffer.length;
	}

	return result;
};

class Finder {
	/** Stores where each byte is located in the needle */
	bytes: Record<string, number[]> = {};

	/** Sequence of bytes to find */
	needle: Uint8Array<ArrayBuffer>;

	/** Length of the needle */
	needleLength: number;

	/** Index of the last character in the needle */
	needleEnd: number;

	/**
	 * Stores the how far from the last character each char in the needle is so
	 * the iterator know how far to safely skip forward when the character is
	 * found the rest of the array is filled with the length (default skip)
	 */
	skip: Uint8Array<ArrayBuffer>;

	find: (pc: ParseContext) => Promise<true | undefined>;
	findStream: (pc: ParseContext) => ReadableStream<Uint8Array<ArrayBuffer>>;

	constructor(pattern: string) {
		this.needle = encoder.encode(pattern);
		this.needleLength = this.needle.length;
		this.needleEnd = this.needleLength - 1;
		this.skip = new Uint8Array(256).fill(this.needleLength);

		for (let i = 0; i < this.needleLength; i++) {
			const byte = this.needle[i]!;

			if (i !== this.needleEnd) {
				// skip the last char of the needle since that would be a find
				this.skip[byte] = this.needleEnd - i;
			}

			this.bytes[byte] ??= [];
			this.bytes[byte].push(i);
		}

		this.find = async (pc: ParseContext) => {
			if (!pc.buffer.value) return;

			const haystackLength = pc.buffer.value.length;

			for (
				// start the search at the last char of the needle
				// since it could be at the very start
				pc.start += this.needleEnd;
				pc.start < haystackLength; // end - not found
				pc.start += this.skip[pc.buffer.value[pc.start]!]!
			) {
				for (
					let i = this.needleEnd;
					i >= 0 && this.needle[i] === pc.buffer.value[pc.start];
					i--, pc.start-- // check previous char when there's a match
				) {
					if (i === 0) {
						// all characters match
						pc.end = pc.start + this.needleLength;
						return true;
					}
				}
			}
		};

		this.findStream = (pc) =>
			new ReadableStream({
				type: "bytes",
				pull: async (controller) => {
					if (!pc.buffer.value) return;

					if (await this.find(pc)) {
						// found within current chunk
						console.log("found");

						// send up until the boundary
						controller.enqueue(pc.buffer.value.slice(0, pc.start));
						// update buffer to part after the boundary
						pc.buffer.value = pc.buffer.value.slice(pc.end);
					} else {
						// not found within current chunk
						console.log("not found");

						const end = pc.buffer.value.length - 1;
						const lastByte = pc.buffer.value[end]!;
						const lastByteIndices = this.bytes[lastByte];

						if (lastByteIndices) {
							// last char is in the boundary, check for partial boundary
							for (
								let byteIndex = lastByteIndices.length - 1;
								byteIndex >= 0;
								byteIndex--
							) {
								// iterate backwards through the indices
								for (
									let charIndex = lastByteIndices[byteIndex]!,
										needleIndex = end;
									charIndex <= 0 &&
									pc.buffer.value[charIndex] === this.needle[needleIndex];
									charIndex--, needleIndex--
								) {
									if (charIndex === 0) {
										// send up until, check if next has the rest
										controller.enqueue(pc.buffer.value.slice(0));
									}
								}
							}

							// if not found then check again for partial tail
						} else {
							console.log("no partial match");
							controller.enqueue(pc.buffer.value);
							// send current,
							// read next chunk, check for boundary
							// if not found then check again for partial tail
						}
					}

					controller.close();
				},
			});
	}

	async findConcat(pc: ParseContext) {
		if (!pc.buffer.value) return;

		let next: ReadableStreamReadResult<Uint8Array>;

		for (;;) {
			// try to find in the next chunk
			if (await this.find(pc)) return true;

			if ((next = await pc.reader.read()).done) return; // no more chunks

			// where to start the search in the concatenated chunk result
			// go back len - 1 in case it was partially at the end
			pc.start = pc.buffer.value.length - (this.needleLength - 1);

			// add the next chunk onto the end of current
			pc.buffer.value = concat(pc.buffer.value, next.value);
		}
	}
}

export class Parser {
	readonly #req: Request;

	constructor(req: Request) {
		this.#req = req;
	}

	static #createHeaders(raw: string) {
		const headers = new Headers();
		const lines = raw.split("\r\n");

		for (const line of lines) {
			const [name, value] = line.split(":");
			if (name && value) headers.append(name, value);
		}

		return headers;
	}

	static #CRLF = new Finder("\r\n\r\n");

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

		const pc = new ParseContext(reader, await reader.read());

		if (pc.buffer.done) return;

		const boundary = new Finder(`--${boundaryStr}\r\n`);
		if (!(await boundary.findConcat(pc))) return;

		const headerStart = pc.end;

		if (!(await Parser.#CRLF.findConcat(pc))) return;

		const headers = Parser.#createHeaders(
			decoder.decode(pc.buffer.value.slice(headerStart, pc.start)),
		);

		pc.buffer.value = pc.buffer.value.slice(pc.end);
		pc.start = 0;
		pc.end = 0;

		const part = new Part(headers, boundary.findStream(pc));

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

		return parser?.(buffer) ?? buffer;
	}
}
