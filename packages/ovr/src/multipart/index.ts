import { encoder } from "../util/encoder.js";
import { parseHeader } from "../util/parse-header.js";

type ParseContext = {
	/** Request body reader */
	reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;

	/** Current chunk(s) in the buffer */
	buffer: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;

	/** Start index of the last item found */
	start: number;

	/** End index of the last item found */
	end: number;
};

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
	/** stores where each byte is located in the needle */
	bytes: Record<string, [number, ...number[]]> = {};

	#length: number;

	find: (pc: ParseContext) => Promise<true | undefined>;
	findGen: (
		pc: ParseContext,
	) => AsyncGenerator<ReadableStreamReadResult<Uint8Array>>;

	constructor(pattern: string) {
		const needle = encoder.encode(pattern);
		this.#length = needle.length;
		const needleEnd = this.#length - 1;

		// this table stores the how far from the last character
		// each char in the needle is so the iterator know how far to
		// safely skip forward when the character is found
		// the rest of the table is filled with the length (default skip)
		const skip = new Uint8Array(256).fill(this.#length);

		for (let i = 0; i < this.#length; i++) {
			const byte = needle[i]!;

			if (i !== needleEnd) {
				// skip the last char of the needle since that would be a find
				skip[byte] = needleEnd - i;
			}
			if (this.bytes[byte]) {
				this.bytes[byte].push(i);
			} else {
				this.bytes[byte] = [i];
			}
		}

		this.find = async (pc: ParseContext) => {
			if (!pc.buffer.value) return;

			const haystackLength = pc.buffer.value.length;

			for (
				// start the search at the last char of the needle
				// since it could be at the very start
				pc.start += needleEnd;
				pc.start < haystackLength; // end - not found
				pc.start += skip[pc.buffer.value[pc.start]!]!
			) {
				for (
					let i = needleEnd;
					i >= 0 && needle[i] === pc.buffer.value[pc.start];
					i--, pc.start-- // check previous char when there's a match
				) {
					if (i === 0) {
						// all characters match
						pc.end = pc.start + this.#length;
						return true;
					}
				}
			}
		};

		this.findGen = async function* (pc) {};
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
			pc.start = pc.buffer.value.length - (this.#length - 1);

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

		const pc: ParseContext = {
			reader,
			buffer: await reader.read(), // read the first chunk
			start: 0,
			end: 0,
		};

		if (pc.buffer.done) return;

		const boundary = new Finder(`--${boundaryStr}\r\n`);
		if (!(await boundary.findConcat(pc))) return;

		const headerStart = pc.end;

		if (!(await Parser.#CRLF.findConcat(pc))) return;

		const part = new Part(
			Parser.#createHeaders(
				decoder.decode(pc.buffer.value.slice(headerStart, pc.start)),
			),
			new ReadableStream({
				type: "bytes",
				async pull(controller) {
					if (!pc.buffer.value) return;

					const bodyStart = pc.end; // header end
					const found = await boundary.find(pc);

					if (found) {
						console.log("found");
						controller.enqueue(pc.buffer.value.slice(bodyStart, pc.start));
						pc.buffer.value = pc.buffer.value.slice(pc.end);
					} else {
						// not found
						const lastByte = pc.buffer.value[pc.buffer.value.length - 1]!;
						const lastByteIndices = boundary.bytes[lastByte];

						if (lastByteIndices) {
							console.log("partial???");

							// check for partial boundary
							// if found send up until
							// read next chunk, check for boundary
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
			}),
		);

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
