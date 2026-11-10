import { Codec, Header, Mime, Size } from "../util/index.js";

/** Sequence of bytes to find within the stream */
/** A request body over one of the parser's limits. */
export class Limit extends RangeError {}

/** A request that is not valid multipart form data, the client's error. */
export class Malformed extends TypeError {}

/** A request body of another type than multipart form data. */
export class Unsupported extends Malformed {}

class Needle extends Uint8Array {
	/** Index of the last character in the needle */
	readonly end = this.length - 1;

	/** Stores where each byte is located in the needle */
	readonly loc: (number[] | undefined)[] = new Array(256);

	/**
	 * Index of a byte that occurs once in the needle, such as the `\r` of a
	 * boundary, searched for first. A match can only start at its occurrences,
	 * and comparing from each is linear in the haystack whatever the client
	 * chose as its boundary.
	 */
	readonly anchor: number;

	/** @param needle String to find within the stream, at most 255 bytes */
	constructor(needle: string) {
		super(Codec.encode(needle).buffer);

		// boundaries are at most 70 characters, checked before a needle is made

		for (let i = 0; i < this.length; i++) (this.loc[this[i]!] ??= []).push(i);

		// a short needle without a unique byte, such as "\r\n\r\n", starts at 0
		const unique = this.findIndex((byte) => this.loc[byte]!.length === 1);
		this.anchor = unique === -1 ? 0 : unique;
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

	// this is named `type` instead of `mime` to align with `Blob.type`
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

		// each byte as one character, so `Headers` accepts the UTF-8 bytes
		// browsers send in names and filenames, decoded below
		let text = "";
		for (const byte of rawHeaders) text += String.fromCharCode(byte);

		// create headers
		for (const line of text.split("\r\n")) {
			const colon = line.indexOf(":");

			if (colon !== -1) {
				headers.push([
					line.slice(0, colon).trim(),
					// no need to trim value - Headers.set does this already
					line.slice(colon + 1),
				]);
			}
		}

		let parsed: Headers;
		try {
			parsed = new Headers(headers);
		} catch {
			// an invalid name or value, the client's error
			throw new Malformed("Invalid Part Header");
		}

		super(req, {
			headers: parsed,
			body,
			// @ts-expect-error - streaming https://developer.mozilla.org/en-US/docs/Web/API/RequestInit#duplex
			duplex: "half",
		});

		[this.type] = Header.shift(this.headers.get(Header.name.type));

		const { name, filename } = Header.params(
			this.headers.get(Header.name.disp),
			true,
		);
		this.name = Part.#utf8(name);
		this.filename = Part.#utf8(filename);
	}

	/**
	 * @param value Header parameter, one character per byte
	 * @returns The UTF-8 text it encodes, or `null` without one
	 */
	static #utf8(value: string | undefined) {
		if (value === undefined) return null;
		try {
			return Codec.decode(Uint8Array.from(value, (c) => c.charCodeAt(0)));
		} catch {
			// not UTF-8, the client's error
			throw new Malformed("Invalid Part Header");
		}
	}

	/**
	 *
	 * @returns Buffered FormDataEntryValue
	 */
	async value(): Promise<FormDataEntryValue> {
		if (this.filename || this.type === Mime.type.stream) {
			const blob = await this.blob();

			return new File([blob], this.filename ?? "blob", { type: blob.type });
		}

		return this.text();
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
		parts?: number | undefined;
	};

	/** Type for a `Part` of the multipart body */
	export type Part = InstanceType<typeof Part>;
}

/** Default most memory a request body takes while it is read, 4MB */
export const memory = 4 * Size.mb;

/** Multipart request */
export class Multipart extends Request {
	/** New line needle to share across requests and parts */
	static readonly #newLine = new Needle("\r\n\r\n");

	/** Parser options */
	readonly #options: Required<Multipart.Options> = {
		memory,
		payload: 16 * Size.mb,
		parts: Infinity,
	};

	/** Request body reader */
	readonly #reader: ReadableStreamDefaultReader;

	/** Current values being buffered in memory */
	#memory = new Uint8Array(0);

	/** Owned storage for headers and boundaries spanning input chunks. */
	readonly #scratch: Uint8Array<ArrayBuffer>;

	/** Dash and boundary, the first delimiter without a new line before it */
	readonly #opening: Needle;

	/** Part boundary needle */
	readonly #boundary: Needle;

	/** Where valid data ends, valid < #valid >= invalid or empty space */
	#valid = 0;

	/** Start index of the found needle */
	#start = 0;

	/** Start of unread data within the buffer. */
	#offset = 0;

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
		// from its parts, since a server's own request object, such as srvx's,
		// is not one the platform's constructor can copy
		super(req.url, {
			method: req.method,
			headers: req.headers,
			body: req.body,
			signal: req.signal,
			// a streamed body needs this in Node
			duplex: "half",
		} as RequestInit);

		const [mime, params] = Header.shift(this.headers.get(Header.name.type));

		if (!Mime.multipart(mime)) throw new Unsupported("Unsupported Media Type");

		const { boundary } = Header.params(params, true);

		if (!boundary) throw new Malformed("Boundary Not Found");
		// RFC 2046: 1 to 70 characters from a limited set, not ending in a space
		if (!/^[\w'()+,./:=? -]{0,69}[\w'()+,./:=?-]$/.test(boundary))
			throw new Malformed("Invalid Boundary");
		if (!this.body) throw new Malformed("No Request Body");

		Object.assign(this.#options, options);
		this.#reader = this.body.getReader();
		this.#opening = new Needle(`--${boundary}`);
		this.#boundary = new Needle(`\r\n--${boundary}`);

		this.#scratch = new Uint8Array(
			new ArrayBuffer(
				// slightly larger than common chunk size/high water mark 64kb for leftover boundary
				// prevents having to resize memory for most requests
				65 * Size.kb,
				// cap max chunk size + leftover
				{ maxByteLength: this.#options.memory },
			),
		);
	}

	/** Account for a source read and append or temporarily borrow its bytes. */
	#read(
		next: ReadableStreamReadResult<Uint8Array<ArrayBuffer>>,
		append = true,
		borrow = false,
	) {
		if (next.done) return true;
		const nextLength = next.value.length;
		if ((this.#payloadSize += nextLength) > this.#options.payload) {
			throw new Limit("Payload Too Large");
		}
		if (append) {
			const length = this.#valid - this.#offset;
			const required = length + nextLength;
			if (required > this.#scratch.buffer.maxByteLength) {
				throw new Limit("Multipart buffer limit exceeded");
			}
			if (length || !borrow) {
				this.#retain();
				if (required > this.#scratch.length) {
					this.#scratch.buffer.resize(
						Math.min(
							this.#scratch.buffer.maxByteLength,
							Math.max(required, this.#scratch.length * 2),
						),
					);
				}
				this.#scratch.set(next.value, length);
			} else {
				// The caller must consume or retain these bytes before yielding.
				this.#memory = next.value;
			}
			this.#valid = required;
			this.#start -= this.#offset;
			this.#end -= this.#offset;
			this.#offset = 0;
		}
	}

	/** Preserve unread bytes before the source can reuse its input storage. */
	#retain() {
		const length = this.#valid - this.#offset;
		if (length > this.#scratch.length) this.#scratch.buffer.resize(length);
		this.#scratch.set(this.#memory.subarray(this.#offset, this.#valid));
		this.#memory = this.#scratch;
		this.#valid = length;
		this.#start -= this.#offset;
		this.#end -= this.#offset;
		this.#offset = 0;
	}

	/**
	 * Cuts off the buffer < end index.
	 *
	 * @returns Shifted off buffer < start index
	 */
	#shift() {
		const before = this.#memory.subarray(this.#offset, this.#start);
		this.#offset = this.#start = this.#end;

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
		const haystack = this.#memory.subarray(0, haystackLength);
		const { anchor, length } = needle;
		const byte = needle[anchor]!;

		for (
			let at = haystack.indexOf(byte, this.#start + anchor);
			at !== -1;
			at = haystack.indexOf(byte, at + 1)
		) {
			const start = at - anchor;
			// may still be completed by the next chunk
			if (start + length > haystackLength) break;

			let i = 0;
			while (i < length && needle[i] === haystack[start + i]) i++;

			if (i === length) {
				this.#start = start;
				this.#end = start + length;
				return this.#shift();
			}
		}

		// where to safely start the next search in the concatenated chunk result
		// go back len - 1 in case it was partially at the end
		this.#start = this.#end = Math.max(
			this.#offset,
			haystackLength - (length - 1),
		);
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
		while (
			!(found = this.#find(needle)) &&
			!this.#read(await this.#reader.read())
		);
		return found;
	}

	/**
	 * @param needle Needle to find
	 * @returns Stream that streams the content until the next find, and its
	 * state: whether it reached the needle, and its pull in progress
	 */
	#findStream(needle: Needle) {
		let pending: Uint8Array<ArrayBuffer> | undefined;
		const state: {
			/** Reached the needle */
			ended: boolean;
			/** The parser moved on, so a reader left on it gets no more */
			detached: boolean;
			/** Pull in progress, finished before the parser reads on */
			pulling?: Promise<void>;
		} = { ended: false, detached: false };
		const pull = async (c: ReadableByteStreamController) => {
			if (state.detached) {
				c.close();
				c.byobRequest?.respond(0);
				return;
			}

			if (!pending?.length) {
				let found: Uint8Array<ArrayBuffer> | undefined;
				for (
					let done: boolean | undefined;
					!(found = this.#find(needle)) && !done;
					done = this.#read(await this.#reader.read(), true, true)
				) {
					// Retain only a suffix that could begin a boundary.
					this.#start = this.#end = this.#valid;
					const last = this.#valid - 1;
					const indices =
						this.#valid > this.#offset
							? needle.loc[this.#memory[last]!]
							: undefined;
					if (indices) {
						search: for (let i = indices.length - 1; i >= 0; i--) {
							for (
								let match = indices[i]!, cursor = last;
								match >= 0 &&
								cursor >= this.#offset &&
								needle[match] === this.#memory[cursor];
								match--, cursor--
							) {
								if (match === 0) {
									this.#start = this.#end = cursor;
									break search;
								}
							}
						}
					}
					pending = this.#shift();
					if (pending.length) break;
					if (this.#memory !== this.#scratch) this.#retain();
				}
				if (!pending?.length) {
					// the body ended inside the part
					if (!found) throw new Malformed("Unexpected End of Body");
					pending = found;
					state.ended = true;
				}
			}

			if (pending?.length) {
				const request = c.byobRequest;
				const view = request?.view;
				if (view) {
					const length = Math.min(view.byteLength, pending.length);
					new Uint8Array(view.buffer, view.byteOffset, length).set(
						pending.subarray(0, length),
					);
					pending = pending.subarray(length);
					request.respond(length);
				} else {
					// Byte-stream enqueue transfers this independent allocation.
					c.enqueue(new Uint8Array(pending));
					pending = undefined;
				}
			}
			if (this.#memory !== this.#scratch) {
				// Source buffers may be reused on the next pull. Borrow only
				// within this synchronous continuation, including small BYOB reads.
				if (pending?.length) pending = new Uint8Array(pending);
				this.#retain();
			}
			if (state.ended && !pending?.length) {
				c.close();
				// An empty part or final short BYOB read still needs a response.
				c.byobRequest?.respond(0);
			}
		};

		const stream = new ReadableStream({
			type: "bytes",
			pull: (c) => (state.pulling = pull(c)),
		});

		return { stream, state };
	}

	/**
	 * Discard the rest of a part its reader stopped reading, up to its
	 * boundary, so its bytes are never parsed as the next part.
	 *
	 * @param needle Boundary
	 * @returns `false` when the body ends first
	 */
	async #skip(needle: Needle) {
		while (!this.#find(needle)) {
			// only a suffix that could begin the boundary is kept
			this.#offset = this.#start;
			if (this.#read(await this.#reader.read())) return false;
		}
		return true;
	}

	/**
	 * Reads what follows a delimiter: `--` ends the body, a new line starts
	 * the next part's headers, which it is left in front of. Spaces and tabs
	 * before the new line are transport padding, which RFC 2046 says to ignore.
	 *
	 * @returns `true` when the delimiter closes the body
	 * @throws {Malformed} Otherwise, since RFC 2046 does not let the boundary
	 * start a line of content, as in `--boundary-suffix`
	 */
	async #closed() {
		/**
		 * @param i Index after the offset
		 * @returns The byte there, reading the next chunk if needed
		 */
		const at = async (i: number) => {
			while (
				this.#valid - this.#offset <= i &&
				!this.#read(await this.#reader.read())
			);
			return this.#valid - this.#offset > i
				? this.#memory[this.#offset + i]
				: undefined;
		};

		if ((await at(0)) === 45 && (await at(1)) === 45) {
			// done, drain any epilogue without parsing it
			while (!this.#read(await this.#reader.read(), false));
			return true;
		}

		// consumed as it is read, so padding cannot fill the buffer
		for (let byte = await at(0); byte === 32 || byte === 9; byte = await at(0))
			this.#start = this.#end = ++this.#offset;

		if ((await at(0)) === 13 && (await at(1)) === 10) return false;

		throw new Malformed("Invalid Boundary");
	}

	/** @yields Multipart form data `Part`(s) */
	async *[Symbol.asyncIterator]() {
		let complete = false;

		try {
			let preamble = await this.#findConcat(this.#opening);
			// the first delimiter starts the body or a line, one mentioned within
			// a line of the preamble is not one
			if (
				preamble?.length &&
				!(preamble.at(-2) === 13 && preamble.at(-1) === 10)
			)
				preamble = await this.#findConcat(this.#boundary);
			if (!preamble) throw new Malformed("Missing Opening Boundary");

			// a form without fields sends only the closing delimiter
			for (let i = 0; !(await this.#closed()); i++) {
				const headers = await this.#findConcat(Multipart.#newLine);
				// a body ends with the closing delimiter, after the last part
				if (!headers) throw new Malformed("Unexpected End of Body");
				if (i === this.#options.parts) throw new Limit("Too Many Parts");

				const { stream, state } = this.#findStream(this.#boundary);
				yield new Part(this, stream, headers);

				// the next part starts after this one's boundary, however much of it
				// was read: skip the rest here, never parse it as headers
				if (!state.ended) {
					state.detached = true;
					await state.pulling?.catch(() => {});
					if (!state.ended && !(await this.#skip(this.#boundary)))
						throw new Malformed("Unexpected End of Body");
				}
			}

			complete = true;
		} finally {
			// stopped early by a limit, an error, or the caller, so stop the upload
			if (!complete) await this.#reader.cancel().catch(() => {});
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
			if (part.name) data.append(part.name, await part.value());
		}

		return data;
	}
}
