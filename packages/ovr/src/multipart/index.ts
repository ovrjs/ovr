import * as codec from "../util/codec.js";
import * as header from "../util/header.js";

/** Sequence of bytes to find within the stream */
class Needle extends Uint8Array {
	/** Index of the last character in the needle */
	readonly end = this.length - 1;

	/**
	 * Stores the how far from the last character each char in the needle is so
	 * the iterator know how far to safely skip forward when the character is
	 * found the rest of the array is filled with the length (default skip)
	 */
	readonly skip = new Uint8Array(256).fill(this.length);

	/** Stores where each byte is located in the needle */
	readonly loc: (number[] | undefined)[] = new Array(256);

	/** @param needle String to find within the stream */
	constructor(needle: string) {
		super(codec.encode(needle).buffer);

		for (let i = 0; i < this.length; i++) {
			const byte = this[i]!;

			// skip the last char of the needle since that would be a find
			if (i !== this.end) this.skip[byte] = this.end - i;

			(this.loc[byte] ??= []).push(i);
		}
	}
}

/** Multipart part */
class Part extends Response {
	/**
	 * Form input `name` attribute
	 *
	 * @example
	 *
	 * ```html
	 * <input type="file" name="photo">
	 * ```
	 */
	readonly name?: string;

	/**
	 * Filename from Content-Disposition header if file
	 *
	 * @example "my-image.png"
	 */
	readonly filename?: string;

	/**
	 * Media type of the part
	 *
	 * @example "image/png"
	 */
	readonly mime?: string;

	/**
	 * Create a new multi-part part
	 *
	 * @param body Part body
	 * @param rawHeaders Raw buffer of HTTP headers for the part
	 */
	constructor(body: ReadableStream, rawHeaders: Uint8Array) {
		const headers: [string, string][] = [];

		// create headers
		for (const line of codec.decode(rawHeaders).split("\r\n")) {
			const colon = line.indexOf(":");

			if (colon !== -1) {
				headers.push([
					line.slice(0, colon).trim(),
					// no need to trim value - Headers.set does this already
					line.slice(colon + 1),
				]);
			}
		}

		super(body, { headers });

		const disp = header.parse(this.headers.get("content-disposition"));

		this.name = disp.name;
		this.filename = disp.filename;

		this.mime = this.headers.get(header.contentType)?.split(";", 1)[0];
	}
}

export namespace Parser {
	/** Parser options */
	export type Options = {
		/**
		 * Maximum memory allocation for request body processing (default 4MB)
		 *
		 * Even for large files, the parser does not hold the entire file in memory,
		 * it processes each chunk of the request body as it arrives.
		 * Set to a larger number if for example clients are sending all the
		 * data in a massive chunk instead of broken into smaller packets.
		 *
		 * @default 4 * 1024 * 1024
		 * @example
		 *
		 * ```ts
		 * const memory = 12 * 1024 * 1024; // increase to 12MB
		 * Parser.data(request, { memory });
		 * ```
		 */
		memory?: number;

		/**
		 * Maximum request body size in bytes (default 10MB)
		 *
		 * Prevents attackers from creating massive requests.
		 *
		 * Since the parser doesn't hold chunks in memory, it's possible for
		 * it to handle very large requests. Use this option to adjust the
		 * maximum total request body size that will run through the server.
		 *
		 * @default 10 * 1024 * 1024
		 * @example
		 *
		 * ```ts
		 * const size = 1024 ** 3; // increase to 1GB
		 * Parser.data(request, { size });
		 * ```
		 */
		size?: number | bigint;
	};

	/** Type for a `Part` of the multipart body */
	export type Part = InstanceType<typeof Part>;
}

/**
 * Multipart request body parser.
 *
 * @example
 *
 * ```ts
 * for await (const part of Parser.data(request)) {
 * 	// ...
 * }
 * ```
 */
export class Parser {
	static readonly #kb = 1024;
	static readonly #mb = 1024 ** 2;

	/** New line needle to share across requests and parts */
	static readonly #newLine = new Needle("\r\n\r\n");

	/** Parser options */
	readonly #options: Required<Parser.Options> = {
		memory: 4 * Parser.#mb,
		size: 10 * Parser.#mb,
	};

	/** Request body reader */
	readonly #reader: ReadableStreamDefaultReader;

	/** Current values being buffered in memory */
	readonly #memory: Uint8Array<ArrayBuffer>;

	/** Opening boundary needle */
	readonly #opening: Needle;

	/** Part boundary needle */
	readonly #boundary: Needle;

	/** Where valid data ends, valid < #cursor >= empty space */
	#cursor = 0;

	/** Start index of the found needle */
	#start = 0;

	/** End index of the found needle */
	#end = 0;

	/** Total bytes read from the stream */
	#totalBytes = 0n;

	/**
	 * Use `Parser.data` to run the parser.
	 *
	 * @param req Request
	 * @param options Parser options
	 */
	constructor(req: Request, options?: Parser.Options) {
		const boundary = header.parse(req.headers.get(header.contentType)).boundary;

		if (!boundary) throw new TypeError("Boundary Not Found");
		if (!req.body) throw new TypeError("No Request Body");

		Object.assign(this.#options, options);
		this.#reader = req.body.getReader();
		this.#opening = new Needle(`--${boundary}\r\n`);
		this.#boundary = new Needle(`\r\n--${boundary}`);

		this.#memory = new Uint8Array(
			new ArrayBuffer(
				// slightly larger than common chunk size/high water mark 64kb for leftover boundary
				65 * Parser.#kb,
				// cap max chunk size + leftover
				{ maxByteLength: this.#options.memory },
			),
		);
	}

	/** @param reader Reader from the stream to drain */
	static async #drain(reader: ReadableStreamDefaultReader) {
		while (!(await reader.read()).done);
	}

	/**
	 * Attempts to find the needle within the current buffer (haystack).
	 * Sets start and end to the start and end of the found needle, or the
	 * safe place to start the next search from if not found.
	 *
	 * @param needle Needle to find
	 * @returns If found, shifts the buffer and returns the result.
	 */
	#find(needle: Needle) {
		const haystackLength = this.#cursor;

		// start the search at the last char of the needle
		// since it could be at the very start
		let i = this.#start + needle.end;

		while (i < haystackLength) {
			for (
				let needleIndex = needle.end, cursor = i;
				needleIndex >= 0 && needle[needleIndex] === this.#memory[cursor];
				needleIndex--, cursor--
			) {
				if (needleIndex === 0) {
					this.#start = cursor;
					this.#end = cursor + needle.length;
					return this.#shift();
				}
			}

			i += needle.skip[this.#memory[i]!]!;
		}

		// where to safely start the next search in the concatenated chunk result
		// go back len - 1 in case it was partially at the end
		this.#start = this.#end =
			needle.length < haystackLength ? haystackLength - (needle.length - 1) : 0;
	}

	/**
	 * @param needle Needle to find
	 * @returns Stream that streams the content until the next find
	 */
	#findStream(needle: Needle) {
		return new ReadableStream({
			type: "bytes",
			pull: async (c) => {
				let found: Uint8Array<ArrayBuffer> | undefined;

				for (
					let done: boolean | undefined;
					!(found = this.#find(needle)) && !done;
					done = await this.#read()
				) {
					// not found within current chunk
					const lastIndex = this.#cursor - 1;
					const needleIndices = needle.loc[this.#memory[lastIndex]!];

					if (needleIndices) {
						// last char is in the boundary, check for partial boundary
						// iterate backwards through the indices
						indices: for (let i = needleIndices.length - 1; i >= 0; i--) {
							for (
								let needleIndex = needleIndices[i]!, cursor = lastIndex;
								needleIndex >= 0 &&
								needle[needleIndex] === this.#memory[cursor];
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
						c.enqueue(before);
						return; // wait for next pull
					}
				}

				if (found?.length) c.enqueue(found);

				c.close();
			},
		});
	}

	/**
	 * Cuts off the buffer < end index.
	 *
	 * @returns Shifted off buffer < start index
	 */
	#shift() {
		const before = this.#memory.slice(0, this.#start);

		// how much data is left after the found needle
		const remainder = this.#cursor - this.#end;

		if (remainder) {
			// copy remainder to the start of the buffer
			// this doesn't move the chunks, just copies to the start
			// old will be overwritten
			this.#memory.copyWithin(0, this.#end, this.#cursor);
		}

		this.#cursor = remainder;
		this.#start = this.#end = 0;

		return before;
	}

	/**
	 * Reads the next chunk in the request stream and concatenates it
	 * onto the buffer.
	 *
	 * @returns `true` if done
	 */
	async #read() {
		const next = await this.#reader.read();

		if (next.done) return true;

		const nextLength = next.value.length;

		if ((this.#totalBytes += BigInt(nextLength)) > this.#options.size) {
			throw new RangeError("Payload Too Large");
		}

		const required = this.#cursor + nextLength;
		const size = this.#memory.buffer.byteLength;

		// resize if full
		if (required > size) {
			this.#memory.buffer.resize(
				Math.min(
					this.#options.memory, // in case double is larger than the max
					Math.max(required, size * 2),
				),
			);
		}

		// write at the cursor
		this.#memory.set(next.value, this.#cursor);
		this.#cursor += nextLength;
	}

	/**
	 * Tries to find the needle in the buffer, if not found, the next
	 * chunk is read an concatenated onto the buffer.
	 *
	 * @param needle Needle to find
	 * @returns Buffer up until the found needle
	 */
	async #findConcat(needle: Needle) {
		let found: Uint8Array | undefined;
		while (!(found = this.#find(needle)) && !(await this.#read()));
		return found;
	}

	/**
	 * @yields Multipart form data `Part`(s)
	 */
	async *#run() {
		try {
			await this.#findConcat(this.#opening);

			let headers: Uint8Array | undefined;
			while ((headers = await this.#findConcat(Parser.#newLine))) {
				const part = new Part(this.#findStream(this.#boundary), headers);
				yield part;

				// to get next part, the entire body must be read
				// cannot collect the next and save the body for later
				// also cannot cancel, chunks would be in the next header
				if (part.body && !part.bodyUsed) {
					const reader = part.body.getReader();
					await Parser.#drain(reader);
					reader.releaseLock();
				}

				if (this.#memory[0] === 45 && this.#memory[1] === 45) {
					// -- = done, drain any epilogue
					// if not done it is \r\nNEXT-HEADER
					await Parser.#drain(this.#reader);
					break;
				}
			}
		} finally {
			this.#reader.releaseLock();
		}
	}

	/**
	 * Parse multi-part form data streams.
	 *
	 * @param req Request
	 * @param options Parse options
	 * @yields Multipart form data `Part`(s)
	 * @example
	 *
	 * ```ts
	 * for await (const part of Parser.data(request)) {
	 * 	// ...
	 * }
	 * ```
	 */
	static data(req: Request, options?: Parser.Options) {
		return new Parser(req, options).#run();
	}
}
