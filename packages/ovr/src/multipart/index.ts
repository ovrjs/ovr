import { Codec } from "../util/codec.js";
import { parseHeader } from "../util/parse-header.js";

class Needle {
	/** Sequence of bytes to find */
	readonly bytes: Uint8Array<ArrayBuffer>;

	/** Length of the needle */
	readonly length: number;

	/** Index of the last character in the needle */
	readonly end: number;

	/**
	 * Stores the how far from the last character each char in the needle is so
	 * the iterator know how far to safely skip forward when the character is
	 * found the rest of the array is filled with the length (default skip)
	 */
	readonly skip: Uint8Array<ArrayBuffer>;

	/** Stores where each byte is located in the needle */
	readonly map: Record<string, number[]> = {};

	/**
	 * @param s String to find within the stream
	 */
	constructor(s: string) {
		this.bytes = Codec.encode(s);
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

class Part {
	/** Headers of the part */
	readonly headers = new Headers();

	/** Readable stream containing the body of the part */
	readonly body: ReadableStream<Uint8Array<ArrayBuffer>>;

	/** Parsed Content-Disposition header */
	readonly #disposition: Record<string, string>;

	/** Cached buffers to return if drain is called more than once */
	#drain?: Uint8Array<ArrayBuffer>[];

	/** Cached bytes to return if bytes is called more than once */
	#bytes?: Uint8Array<ArrayBuffer>;

	/**
	 * Create a new multi-part part.
	 *
	 * @param headers Raw buffer of HTTP headers for the part
	 * @param body Part body
	 */
	constructor(
		headers: Uint8Array<ArrayBuffer>,
		body: ReadableStream<Uint8Array<ArrayBuffer>>,
	) {
		this.body = body;

		// create headers
		const lines = Codec.decode(headers).split("\r\n");
		for (const line of lines) {
			const i = line.indexOf(":");
			if (i === -1) continue;
			const name = line.slice(0, i).trim();
			const value = line.slice(i + 1).trim();
			if (name && value) this.headers.append(name, value);
		}

		this.#disposition = parseHeader(this.headers.get("content-disposition"));
	}

	/** Form input `name` attribute */
	get name() {
		return this.#disposition.name;
	}

	/** Filename from Content-Disposition header if file */
	get filename() {
		return this.#disposition.filename;
	}

	/**
	 * Drain the part body so the reader can proceed to the next part.
	 *
	 * @returns Values from each body chunk.
	 * If already drained, the cached values are returned.
	 */
	async drain() {
		if (!this.#drain) {
			this.#drain = [];
			const reader = this.body.getReader();

			let chunk: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;
			while (!(chunk = await reader.read()).done) {
				this.#drain.push(chunk.value);
			}
		}

		return this.#drain;
	}

	/**
	 * Drain the body and concatenates the bytes into a single array.
	 *
	 * @returns Part body bytes
	 */
	async bytes() {
		if (!this.#bytes) {
			const arrays = await this.drain();

			this.#bytes = new Uint8Array(
				arrays.reduce((acc, buffer) => acc + buffer.length, 0),
			);

			let i = 0;
			for (const array of arrays) {
				this.#bytes.set(array, i);
				i += array.length;
			}
		}

		return this.#bytes;
	}

	/**
	 * Parse the part body text with a specific parser function.
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
		const buffer = Codec.decode(await this.bytes());

		return parser ? parser(buffer) : buffer;
	}
}

/** Multipart form data parser */
export class Parser {
	readonly #req: Request;

	/** Request body reader */
	readonly #reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;

	/** Current chunk(s) in the buffer */
	#buffer!: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>;

	/** Start index of the found needle */
	#start = 0;

	/** End index of the found needle */
	#end = 0;

	/** New line needle to share across requests and parts */
	static #CRLF = new Needle("\r\n\r\n");

	/**
	 * Attempts to find the needle within the current buffer (haystack).
	 * Sets start and end to the start and end of the found needle, or the
	 * safe place to start the next search from if not found.
	 *
	 * @param needle Needle to find
	 * @returns If found, shifts the buffer and returns the result.
	 */
	readonly #find: (needle: Needle) => Uint8Array<ArrayBuffer> | undefined;

	/**
	 * @param needle Needle to find
	 * @returns Stream that streams the content until the next find
	 */
	readonly #findStream: (
		needle: Needle,
	) => ReadableStream<Uint8Array<ArrayBuffer>>;

	/**
	 * Create a new Parser.
	 *
	 * @param req
	 */
	constructor(req: Request) {
		this.#req = req;

		if (!req.body) throw new Error("No request body");

		this.#reader = req.body.getReader();

		this.#find = (needle) => {
			if (!this.#buffer.value) return;

			const haystackLength = this.#buffer.value.length;
			// start the search at the last char of the needle
			// since it could be at the very start
			let i = this.#start + needle.end;

			while (i < haystackLength) {
				for (
					let needleIndex = needle.end, cursor = i;
					needleIndex >= 0 &&
					needle.bytes[needleIndex] === this.#buffer.value[cursor];
					needleIndex--, cursor--
				) {
					if (needleIndex === 0) {
						this.#start = cursor;
						this.#end = cursor + needle.length;
						return this.#shift();
					}
				}

				i += needle.skip[this.#buffer.value[i]!]!;
			}

			// where to safely start the next search in the concatenated chunk result
			// go back len - 1 in case it was partially at the end
			const safeStart =
				needle.length < haystackLength
					? haystackLength - (needle.length - 1)
					: 0;

			this.#start = this.#end = safeStart;
		};

		this.#findStream = (needle) =>
			new ReadableStream({
				type: "bytes",
				pull: async (controller) => {
					for (;;) {
						const found = this.#find(needle);

						if (found) {
							// found within current chunk
							if (found.length) {
								controller.enqueue(found);
							}
							controller.close();
							return;
						}

						if (this.#buffer.done) {
							if (this.#buffer.value?.length) {
								controller.enqueue(this.#buffer.value);
							}
							controller.close();
							return;
						}

						// not found within current chunk
						const lastIndex = this.#buffer.value.length - 1;
						const lastByte = this.#buffer.value[lastIndex]!;
						const needleIndices = needle.map[lastByte];

						if (needleIndices) {
							// last char is in the boundary, check for partial boundary
							// iterate backwards through the indices
							indices: for (let i = needleIndices.length - 1; i >= 0; i--) {
								for (
									let needleIndex = needleIndices[i]!, cursor = lastIndex;
									needleIndex >= 0 &&
									needle.bytes[needleIndex] === this.#buffer.value[cursor];
									needleIndex--, cursor--
								) {
									if (needleIndex === 0) {
										// these are the same since no needle was found
										this.#start = this.#end = cursor;
										// rerun check if next has the rest
										break indices;
									}
								}
							}
						}

						const before = this.#shift();

						if (before.length) {
							controller.enqueue(before);
							return; // wait for next pull
						}

						await this.#read();
					}
				},
			});
	}

	/**
	 * Cuts off the buffer < end index.
	 *
	 * @returns Shifted off buffer < start index
	 */
	#shift() {
		const before = this.#buffer.value!.slice(0, this.#start);
		this.#buffer.value = this.#buffer.value!.slice(this.#end); // after
		this.#start = 0;
		this.#end = 0;

		return before;
	}

	/**
	 * Reads the next chunk in the request stream and concatenates it
	 * onto the buffer.
	 */
	async #read() {
		const next = await this.#reader.read();

		if (!(this.#buffer.done = next.done)) {
			const result = new Uint8Array(
				this.#buffer.value.length + next.value.length,
			);

			result.set(this.#buffer.value);
			result.set(next.value, this.#buffer.value.length);

			this.#buffer.value = result;
		}
	}

	/**
	 * Tries to find the needle in the buffer, if not found, the next
	 * chunk is read an concatenated onto the buffer.
	 *
	 * @param needle Needle to find
	 * @returns Buffer up until the found needle
	 */
	async #findConcat(needle: Needle) {
		if (!this.#buffer.value) return;

		for (;;) {
			// try to find in the next chunk
			const found = this.#find(needle);
			if (found) return found;

			await this.#read();
			if (this.#buffer.done) return; // no more chunks
		}
	}

	/**
	 * Parse multi-part form data streams.
	 *
	 * @yields Multipart form data `Part`(s)
	 */
	async *data() {
		this.#buffer = await this.#reader.read();

		const boundaryStr = parseHeader(
			this.#req.headers.get("content-type"),
		).boundary;
		if (!boundaryStr) return;

		const opening = new Needle(`--${boundaryStr}\r\n`);
		const boundary = new Needle(`\r\n--${boundaryStr}`);

		await this.#findConcat(opening);

		while (true) {
			const headers = await this.#findConcat(Parser.#CRLF);

			if (!headers) break;

			const part = new Part(headers, this.#findStream(boundary));

			yield part;

			await part.drain();
		}
	}
}
