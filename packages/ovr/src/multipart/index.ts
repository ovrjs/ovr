import * as codec from "../util/codec.js";
import * as header from "../util/header.js";

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

	/**
	 * @param needle String to find within the stream
	 */
	constructor(needle: string) {
		super(codec.encode(needle).buffer);

		for (let i = 0; i < this.length; i++) {
			const byte = this[i]!;

			if (i !== this.end) {
				// skip the last char of the needle since that would be a find
				this.skip[byte] = this.end - i;
			}

			(this.loc[byte] ??= []).push(i);
		}
	}
}

class Part extends Response {
	/** Form input `name` attribute */
	readonly name?: string;

	/** Filename from Content-Disposition header if file */
	readonly filename?: string;

	/**
	 * Create a new multi-part part.
	 *
	 * @param body Part body
	 * @param rawHeaders Raw buffer of HTTP headers for the part
	 */
	constructor(body: ReadableStream, rawHeaders: Uint8Array) {
		super(body);

		// create headers
		for (const line of codec.decode(rawHeaders).split("\r\n")) {
			const colon = line.indexOf(":");

			if (colon !== -1) {
				this.headers.append(
					line.slice(0, colon).trim(),
					// no need to trim value - Headers.set does this already
					line.slice(colon + 1),
				);
			}
		}

		const disposition = header.parse(this.headers.get("content-disposition"));
		this.name = disposition.name;
		this.filename = disposition.filename;
	}
}

/** Multipart form data parser */
export class Parser {
	/** Multipart request */
	readonly #req: Request;

	/** Request body reader */
	readonly #reader: ReadableStreamDefaultReader;

	/** Current values being buffered in memory */
	readonly #memory = new Uint8Array(128 * 1024);

	/** Where valid data ends, valid < #cursor >= empty space */
	#cursor = 0;

	/** Start index of the found needle */
	#start = 0;

	/** End index of the found needle */
	#end = 0;

	/** New line needle to share across requests and parts */
	static #newLine = new Needle("\r\n\r\n");

	/**
	 * Create a new Parser.
	 *
	 * @param req Request
	 */
	constructor(req: Request) {
		this.#req = req;
		if (!req.body) throw new Error("No request body");
		this.#reader = req.body.getReader();
	}

	/** @param reader Reader from the stream to drain */
	static async #drain(reader: ReadableStreamDefaultReader) {
		while (!(await reader.read()).done);
		reader.releaseLock();
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

		// write at the cursor
		this.#memory.set(next.value, this.#cursor);
		this.#cursor += next.value.length;
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
		const boundaryStr = header.parse(
			this.#req.headers.get(header.contentType),
		).boundary;
		if (!boundaryStr) return;

		const opening = new Needle(`--${boundaryStr}\r\n`);
		const boundary = new Needle(`\r\n--${boundaryStr}`);

		await this.#findConcat(opening);

		let headers: Uint8Array | undefined;
		while ((headers = await this.#findConcat(Parser.#newLine))) {
			const part = new Part(this.#findStream(boundary), headers);
			yield part;

			// in order to get the next part, the entire body of the
			// current part must be read - can't collect the next and
			// save the body for later it must be read by the user
			// or drained
			// cannot just cancel, then the chunks would be in the
			// next header
			if (part.body && !part.bodyUsed) {
				await Parser.#drain(part.body.getReader());
			}

			if (this.#memory[0] === 0x2d && this.#memory[1] === 0x2d) {
				// done - drain any epilogue
				return Parser.#drain(this.#reader);
			}
		}
	}

	/**
	 * Parse multi-part form data streams.
	 *
	 * @param req
	 * @yields Multipart form data `Part`(s)
	 */
	static data(req: Request) {
		return new Parser(req).#run();
	}
}
