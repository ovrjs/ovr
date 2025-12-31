/** General utility types */
export namespace Util {
	export type DeepArray<T> = T | DeepArray<T>[];
}

/** Media type utils */
export class Mime {
	static readonly html = Mime.#text("html");
	static readonly text = Mime.#text("plain");
	static readonly json = Mime.#application("json");
	static readonly stream = Mime.#application("octet-stream");
	static readonly #multipartBase = "multipart/";
	static readonly multipartFormData = Mime.#multipart("form-data");

	static #text<T extends string>(type: T) {
		return `text/${type}` as const;
	}

	static #application<T extends string>(type: T) {
		return `application/${type}` as const;
	}

	static #multipart<T extends string>(type: T) {
		return `${Mime.#multipartBase}${type}` as const;
	}

	static readonly #markup = new Set<string>([
		Mime.html,
		Mime.#text("xml"),
		Mime.#application("xml"),
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
		return mime?.startsWith(Mime.#multipartBase);
	}
}

/** Header parsing utils */
export class Header {
	static readonly type = "content-type";
	static readonly disposition = "content-disposition";
	static readonly etag = "etag";
	static readonly ifNoneMatch = "if-none-match";
	static readonly cookie = "cookie";
	static readonly setCookie = "set-cookie";

	/**
	 * @param mime
	 * @returns mime; charset=utf-8
	 */
	static utf8<M extends string>(mime: M) {
		return `${mime}; charset=utf-8` as const;
	}

	/**
	 * @param header header value to parse
	 * @returns Base/first param
	 */
	static shift(header: string | null): [string | null, string | null] {
		if (header) {
			const semi = header.indexOf(";");
			if (semi !== -1) {
				return [header.slice(0, semi), header.slice(semi)];
			}
		}

		return [header, null];
	}

	/**
	 * @param header header value to parse
	 * @returns Map containing each key=value pair
	 */
	static params(header: string | null) {
		const parsed: Record<string, string> = {};

		if (header) {
			const headerLength = header.length;

			for (let cursor = 0; cursor < headerLength; ) {
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

				const key = header.slice(cursor, equal).trim();

				if (!(key in parsed)) {
					// first value should take precedence

					let value = header.slice(equal + 1, semi).trim();

					if (value[0] === '"' && value[value.length - 1] === '"') {
						// remove quotes
						value = value.slice(1, -1);
					}

					if (value.includes("%")) {
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

	static base64 = {
		/**
		 * Encodes bytes into a base64 string.
		 *
		 * @param bytes Bytes to encode
		 * @returns Base64 string
		 */
		encode(bytes: Uint8Array) {
			return btoa(String.fromCharCode(...bytes));
		},

		/**
		 * Decodes a base64 string into bytes.
		 *
		 * @param s Base64 string
		 * @returns Decoded bytes
		 */
		decode(s: string) {
			return new Uint8Array(Array.from(atob(s), (c) => c.charCodeAt(0)));
		},
	};
}

/** HTTP methods */
export class Method {
	static readonly get = "GET";
	static readonly post = "POST";
	static readonly head = "HEAD";
}

/** Times in milliseconds */
export class Time {
	static readonly second = 1000;
	static readonly minute = 60 * Time.second;
	static readonly hour = 60 * Time.minute;
	static readonly day = 24 * Time.hour;
	static readonly week = 7 * Time.day;
}
