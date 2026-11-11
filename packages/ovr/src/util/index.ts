/** General utility types */
export namespace Util {
	/**
	 * Function type wrapper that opts into bivariant parameter checking.
	 *
	 * Useful for public structural types that need to accept handlers from
	 * compatible but differently-parameterized generic instances.
	 *
	 * @template Fn Function type
	 */
	export type Bivariant<Fn extends (...args: any[]) => any> = {
		bivariant(...args: Parameters<Fn>): ReturnType<Fn>;
	}["bivariant"];

	/**
	 * Recursive array type that allows a value or nested arrays of that value.
	 *
	 * @template T Item type
	 */
	export type DeepArray<T> = T | DeepArray<T>[];

	/**
	 * Flattens an inferred object type for improved readability in tooling.
	 *
	 * @template T Object type to normalize
	 */
	export type Prettify<T> = { [K in keyof T]: T[K] } & {};
}

/** Media type utils */
export class Mime {
	/**
	 * Mime type constants. Written out, since a static computed by calling
	 * other members is a side effect, which keeps the class in every bundle
	 * that imports this module.
	 */
	static type = {
		html: "text/html",
		md: "text/markdown",
		text: "text/plain",
		json: "application/json",
		stream: "application/octet-stream",
		mp: "multipart/form-data",
	} as const;

	static readonly #markup = new Set<string>([
		"text/html",
		"text/xml",
		"application/xml",
	]);

	/**
	 * @param mime Media type
	 * @returns `true` if the mime is markup
	 */
	static markup(mime: string) {
		return (
			Mime.#markup.has(mime) ||
			// covers other xml types like svg
			mime.includes("+xml")
		);
	}

	/**
	 * @param mime Media type
	 * @returns `true` if the mime is multipart
	 */
	static multipart(mime: string | null) {
		return mime?.startsWith("multipart/");
	}
}

/** Header parsing utils */
export class Header {
	/** Header name constants */
	static readonly name = {
		type: "content-type",
		disp: "content-disposition",
		etag: "etag",
		cache: "cache-control",
		none: "if-none-match",
		cookie: "cookie",
		set: "set-cookie",
		loc: "location",
		origin: "origin",
		fetch: "sec-fetch-site",
		accept: "accept",
		vary: "vary",
	} as const;

	/**
	 * @template M Media type
	 * @param mime Media type
	 * @returns The media type with `; charset=utf-8`
	 */
	static utf8<M extends string>(mime: M) {
		return `${mime}; charset=utf-8` as const;
	}

	/**
	 * @param header header value to parse
	 * @returns Base, trimmed and lowercase since media types ignore case, and its params
	 */
	static shift(header: string | null): [string | null, string | null] {
		if (header === null) return [null, null];
		const semi = header.indexOf(";");

		return semi === -1
			? [header.trim().toLowerCase(), null]
			: [header.slice(0, semi).trim().toLowerCase(), header.slice(semi)];
	}

	/**
	 * @param accept `Accept` header
	 * @param mime Media type to look for
	 * @param exact Ignore wildcard ranges
	 * @returns The quality the header gives the type, by its most specific match
	 */
	static quality(accept: string | null, mime: string, exact?: boolean) {
		if (!accept) return 0;
		const [type] = mime.split("/");
		let best = -1;
		let q = 0;

		for (const range of accept.split(",")) {
			// trimmed and lowercase by `shift`
			const [match, params] = Header.shift(range);
			const score =
				match === mime
					? 2
					: exact
						? -1
						: match === `${type}/*`
							? 1
							: match === "*/*"
								? 0
								: -1;

			if (score > best) {
				best = score;
				const quality = Number(
					Header.params(params?.slice(1) ?? "", true).q ?? 1,
				);
				q = Number.isNaN(quality) ? 0 : quality;
			}
		}

		return q;
	}

	/**
	 * @param header header value to parse
	 * @param insensitive Lowercase each key, a parameter's name is
	 * case-insensitive, a cookie's is not
	 * @returns Map containing each key=value pair
	 */
	static params(header: string | null, insensitive?: boolean) {
		// without a prototype, so a key such as "__proto__" is only a key
		const parsed: Record<string, string> = Object.create(null);

		if (header) {
			const headerLength = header.length;

			for (let cursor = 0; cursor < headerLength;) {
				const equal = header.indexOf("=", cursor);
				if (equal === -1) break; // done

				let semi = header.indexOf(";", cursor);
				if (semi === -1) semi = headerLength;

				if (equal > semi) {
					// equal is in the next pair, current is malformed
					// move the cursor to the start of the next and ignore
					cursor = header.lastIndexOf(";", equal - 1) + 1;
					continue;
				}

				let key = header.slice(cursor, equal).trim();
				if (insensitive) key = key.toLowerCase();
				let value: string;
				let quoted = false;

				// a quoted value ends at its closing quote, it can contain ";"
				let start = equal + 1;
				while (header[start] === " " || header[start] === "\t") start++;
				if (header[start] === '"') {
					quoted = true;
					value = "";
					let i = start + 1;
					for (; i < headerLength && header[i] !== '"'; i++)
						value += header[i] === "\\" ? (header[++i] ?? "") : header[i];
					semi = header.indexOf(";", i);
					if (semi === -1) semi = headerLength;
				} else value = header.slice(start, semi).trim();

				// first value should take precedence
				if (!(key in parsed)) {
					if (quoted) {
						// browsers escape only these in a quoted multipart filename,
						// so other "%" are the name's own, like "100%41.txt"
						value = value.replace(/%(22|0D|0A)/gi, (escape) =>
							decodeURIComponent(escape),
						);
					} else if (value.includes("%")) {
						// most values don't need to be decoded
						try {
							// cookies must be a simple string
							value = decodeURIComponent(value);
						} catch {
							// ignore
						}
					}

					parsed[key] = value;
				}

				cursor = semi + 1;
			}
		}

		return parsed;
	}
}

/**
 * Keeps a response out of shared and browser caches, for one that is
 * personal or used once.
 *
 * @param headers Response headers
 */
export const noStore = (headers: Headers) =>
	headers.set("cache-control", "no-store");

/** Checksum util */
export class Checksum {
	/**
	 * Fast checksum algorithm - [djb2](http://www.cse.yorku.ca/~oz/hash.html)
	 *
	 * @param s String to check
	 * @returns Checksum
	 */
	static djb2(s: string) {
		let c = 5381;
		let i = s.length;

		while (i) c = (c * 33) ^ s.charCodeAt(--i);

		return (c >>> 0).toString(36);
	}
}

/** Shared encoding to use across features */
export class Codec {
	static #encoder = new TextEncoder();
	static #decoder = new TextDecoder("utf-8", { fatal: true });

	/**
	 * Encodes a string into UTF-8 bytes.
	 *
	 * @param s String to encode
	 * @returns UTF-8 bytes
	 */
	static encode(s: string) {
		return Codec.#encoder.encode(s);
	}

	/**
	 * Decodes UTF-8 bytes into a string.
	 *
	 * Note: do not use this for incremental/stream decoding.
	 *
	 * @param bytes UTF-8 bytes
	 * @returns Decoded string
	 */
	static decode(bytes?: Uint8Array) {
		return Codec.#decoder.decode(bytes);
	}

	/**
	 * Reads a body, cancelling it as soon as it exceeds the limit.
	 *
	 * @param body Body to read
	 * @param limit Largest size in bytes
	 * @returns The bytes, or `undefined` when the body is too large
	 */
	static async read(body: ReadableStream<Uint8Array> | null, limit: number) {
		if (!body) return new Uint8Array();

		const reader = body.getReader();
		/** The first chunk, the whole body when it is the only one, as most are */
		let first: Uint8Array | undefined;
		/**
		 * A body of more chunks is copied in as they arrive, into memory that
		 * grows with what was sent and never past the limit, so it is not held
		 * twice at the end, as its chunks and as the bytes they are joined into
		 */
		let buffer: ArrayBuffer | undefined;
		let size = 0;

		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const end = size + value.length;
			if (end > limit) {
				await reader.cancel();
				return;
			}
			if (!first) first = value;
			else {
				// reserved once a second chunk arrives: it costs more than a small
				// body takes to read, and a body of one chunk needs none
				if (!buffer) {
					buffer = new ArrayBuffer(0, { maxByteLength: limit });
					buffer.resize(Math.min(limit, Math.max(end, size * 2)));
					new Uint8Array(buffer).set(first);
				} else if (end > buffer.byteLength)
					buffer.resize(Math.min(limit, Math.max(end, buffer.byteLength * 2)));
				new Uint8Array(buffer, size).set(value);
			}
			size = end;
		}

		// a chunk read is the reader's own, so a body of one is not copied
		return buffer
			? new Uint8Array(buffer, 0, size)
			: (first ?? new Uint8Array());
	}

	static readonly Base64 = class Base64 {
		/**
		 * Encodes bytes into a Base64 string.
		 *
		 * @param bytes Bytes to encode
		 * @returns Base64 string
		 */
		static encode(bytes: Uint8Array) {
			return bytes.toBase64();
		}

		/**
		 * Decodes a Base64 string into bytes.
		 *
		 * @param s Base64 string
		 * @returns Decoded bytes
		 */
		static decode(s: string) {
			return Uint8Array.fromBase64(s);
		}
	};

	static readonly Base64Url = class Base64Url {
		/**
		 * Encodes bytes into a Base64Url string.
		 *
		 * @param bytes Bytes to encode
		 * @returns Base64Url string
		 */
		static encode(bytes: Uint8Array) {
			return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
		}

		/**
		 * Decodes a Base64Url string into bytes.
		 *
		 * @param s Base64Url string
		 * @returns Decoded bytes
		 */
		static decode(s: string) {
			return Uint8Array.fromBase64(s, { alphabet: "base64url" });
		}
	};
}

/** HTTP methods */
export class Method {
	static readonly get = "GET";
	static readonly post = "POST";
	static readonly head = "HEAD";
}

// Each constant is written out: a static that reads another one is a side
// effect, which keeps the class in every bundle that imports this module.

/** Byte size constants */
export class Size {
	static readonly kb = 1024;
	static readonly mb = 1024 * 1024;
}

/** Times in milliseconds */
export class Time {
	static readonly second = 1000;
	static readonly minute = 60 * 1000;
	static readonly hour = 60 * 60 * 1000;
	static readonly day = 24 * 60 * 60 * 1000;
	static readonly week = 7 * 24 * 60 * 60 * 1000;
}
