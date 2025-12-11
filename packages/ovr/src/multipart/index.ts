import { Codec, Header } from "../util/index.js";

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
		super(Codec.encode(needle).buffer);

		for (let i = 0; i < this.length; i++) {
			const byte = this[i]!;

			// skip the last char of the needle since that would be a find
			if (i !== this.end) this.skip[byte] = this.end - i;

			(this.loc[byte] ??= []).push(i);
		}
	}
}

/** Multipart part */
class Part extends Request {
	/**
	 * Form input `name` attribute
	 *
	 * @example
	 *
	 * ```html
	 * <input type="file" name="photo">
	 * ```
	 */
	readonly name: string | null;

	/**
	 * Filename from Content-Disposition header if file
	 *
	 * @example "my-image.png"
	 */
	readonly filename: string | null;

	/**
	 * Media type of the part
	 *
	 * @example "image/png"
	 */
	readonly type: string | null;

	// part body will always be defined, this removes the `null` type
	/** Part body */
	declare readonly body: ReadableStream<Uint8Array<ArrayBuffer>>;

	/**
	 * Create a new multipart part
	 *
	 * @param req Original request
	 * @param body Part body
	 * @param rawHeaders Raw buffer of HTTP headers for the part
	 */
	constructor(req: Request, body: ReadableStream, rawHeaders: Uint8Array) {
		const headers: [string, string][] = [];

		// create headers
		for (const line of Codec.decode(rawHeaders).split("\r\n")) {
			const colon = line.indexOf(":");

			if (colon !== -1) {
				headers.push([
					line.slice(0, colon).trim(),
					// no need to trim value - Headers.set does this already
					line.slice(colon + 1),
				]);
			}
		}

		super(req, {
			headers,
			body,
			// @ts-expect-error - streaming https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#duplex
			duplex: "half",
		});

		[this.type] = Header.shift(this.headers.get(Header.contentType));

		({ name: this.name = null, filename: this.filename = null } = Header.params(
			this.headers.get("content-disposition"),
		));
	}
}

export namespace Multipart {
	/** Multipart options */
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
		 * const memory = 8 * 1024 * 1024; // increase to 8MB
		 * new Multipart(request, { memory });
		 * ```
		 */
		memory?: number;

		/**
		 * Maximum `Request.body` size in bytes (default 16MB)
		 *
		 * Prevents attackers from creating massive requests.
		 *
		 * Since the parser doesn't buffer all chunks in memory, it's possible
		 * to handle very large requests. Use this option to adjust the
		 * maximum total request body size that will be processed.
		 *
		 * @default 16 * 1024 * 1024
		 * @example
		 *
		 * ```ts
		 * const payload = 1024 ** 3; // increase to 1GB
		 * new Multipart(request, { payload });
		 * ```
		 */
		payload?: number;

		/**
		 * Maximum number of parts.
		 *
		 * @default Infinity
		 * @example
		 *
		 * ```ts
		 * const parts = 4; // only allow 4 parts
		 * new Multipart(request, { parts });
		 * ```
		 */
		parts?: number;
	};

	/** Type for a `Part` of the multipart body */
	export type Part = InstanceType<typeof Part>;
}

/** Multipart request */
export class Multipart extends Request {
	static readonly #kb = 1024;
	static readonly #mb = 1024 ** 2;

	/** New line needle to share across requests and parts */
	static readonly #newLine = new Needle("\r\n\r\n");

	/** Parser options */
	readonly #options: Required<Multipart.Options> = {
		memory: 4 * Multipart.#mb,
		payload: 16 * Multipart.#mb,
		parts: Infinity,
	};

	/** Request body reader */
	readonly #reader: ReadableStreamDefaultReader;

	/** Current values being buffered in memory */
	readonly #memory: Uint8Array<ArrayBuffer>;

	/** Opening boundary needle */
	readonly #opening: Needle;

	/** Part boundary needle */
	readonly #boundary: Needle;

	/** Where valid data ends, valid < #valid >= invalid or empty space */
	#valid = 0;

	/** Start index of the found needle */
	#start = 0;

	/** End index of the found needle */
	#end = 0;

	/** Total bytes read from the stream */
	#payloadSize = 0;

	/**
	 * Split a multipart request into parts.
	 *
	 * @param req Multipart request
	 * @param options Options
	 * @yields Multipart form data `Part`(s)
	 * @throws {TypeError} If request headers are invalid
	 * @example
	 *
	 * ```ts
	 * for await (const part of new Multipart(request)) {
	 * 	// ...
	 * }
	 * ```
	 */
	constructor(req: Request, options?: Multipart.Options) {
		super(req);

		const [type, params] = Header.shift(this.headers.get(Header.contentType));

		if (!type?.startsWith("multipart/")) {
			throw new TypeError("Unsupported Media Type");
		}

		const { boundary } = Header.params(params);

		if (!boundary) throw new TypeError("Boundary Not Found");
		if (!this.body) throw new TypeError("No Request Body");

		Object.assign(this.#options, options);
		this.#reader = this.body.getReader();
		this.#opening = new Needle(`--${boundary}\r\n`);
		this.#boundary = new Needle(`\r\n--${boundary}`);

		this.#memory = new Uint8Array(
			new ArrayBuffer(
				// slightly larger than common chunk size/high water mark 64kb for leftover boundary
				// prevents having to resize memory for most requests
				65 * Multipart.#kb,
				// cap max chunk size + leftover
				{ maxByteLength: this.#options.memory },
			),
		);
	}

	/**
	 * Reads the next chunk in the request stream and concatenates it
	 * onto the buffer.
	 *
	 * @param append
	 * @returns `true` if done
	 */
	async #read(append = true) {
		const next = await this.#reader.read();

		if (next.done) return true;

		const nextLength = next.value.length;

		if ((this.#payloadSize += nextLength) > this.#options.payload) {
			throw new RangeError("Payload Too Large");
		}

		if (append) {
			const required = this.#valid + nextLength;
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

			// write at the valid cutoff
			this.#memory.set(next.value, this.#valid);
			this.#valid += nextLength;
		}
	}

	/**
	 * Cuts off the buffer < end index.
	 *
	 * @returns Shifted off buffer < start index
	 */
	#shift() {
		const before = this.#memory.slice(0, this.#start);

		// how much data is left after the found needle
		const remainder = this.#valid - this.#end;

		if (remainder) {
			// copy remainder to the start of the buffer
			// this doesn't move the chunks, just copies to the start
			// old will be overwritten
			this.#memory.copyWithin(0, this.#end, this.#valid);
		}

		this.#valid = remainder;
		this.#start = this.#end = 0;

		return before;
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
		const haystackLength = this.#valid;

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
					const lastIndex = this.#valid - 1;
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

	/** @yields Multipart form data `Part`(s) */
	async *[Symbol.asyncIterator]() {
		try {
			await this.#findConcat(this.#opening);

			let headers: Uint8Array | undefined;

			for (
				let i = 0;
				(headers = await this.#findConcat(Multipart.#newLine));
				i++
			) {
				if (i === this.#options.parts) throw new RangeError("Too Many Parts");

				const part = new Part(this, this.#findStream(this.#boundary), headers);
				yield part;

				// to get next part, the entire body must be read
				// cannot cancel, chunks would be in the next header
				if (part.body && !part.bodyUsed) {
					const partReader = part.body.getReader();
					try {
						while (!(await partReader.read()).done);
					} finally {
						partReader.releaseLock();
					}
				}

				if (
					// ensures invalid characters aren't used to determine if it's done
					this.#valid > 1 &&
					// check for --
					// if not done it would be \r\nNEXT-HEADER
					this.#memory[0] === 45 &&
					this.#memory[1] === 45
				) {
					// done, drain any epilogue
					while (!(await this.#read(false)));
					break;
				}
			}
		} finally {
			this.#reader.releaseLock();
		}
	}

	/**
	 * Drop in replacement for `Request.formData` enhanced with size thresholds.
	 *
	 * Only use `data` when buffering all content is needed, otherwise iterate through
	 * the multipart using `for await...of` instead.
	 *
	 * @returns Buffered `FormData`
	 */
	async data() {
		const data = new FormData();

		for await (const part of this) {
			if (part.name) {
				let value: string | File;

				if (part.filename || part.type === "application/octet-stream") {
					const blob = await part.blob();
					value = new File([blob], part.filename ?? "blob", {
						type: blob.type,
					});
				} else {
					value = await part.text();
				}

				data.append(part.name, value);
			}
		}

		return data;
	}
}
