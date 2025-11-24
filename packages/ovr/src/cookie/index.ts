import type { Context } from "../context/index.js";

export namespace Cookie {
	type BaseOptions = {
		/**
		 * Specifies the domain for which the cookie is valid.
		 * If not specified, this defaults to the host portion of the current document location.
		 */
		readonly domain?: string;

		/**
		 * The maximum lifetime of the cookie as an HTTP-date timestamp.
		 * If unspecified, the cookie becomes a session cookie.
		 */
		readonly expires?: Date;

		/**
		 * If true, the cookie is inaccessible to the JavaScript `Document.cookie` API.
		 * Used to help prevent cross-site scripting (XSS) attacks.
		 */
		readonly httpOnly?: boolean;

		/**
		 * The number of **seconds** until the cookie expires.
		 * A zero or negative number will expire the cookie immediately.
		 */
		readonly maxAge?: number;

		/**
		 * Specifies the path that must exist in the requested URL for the browser
		 * to send the Cookie header.
		 *
		 * @default "/"
		 */
		readonly path?: string;

		/** Determines which cookies to keep when the browser limit is exceeded. */
		readonly priority?: "Low" | "Medium" | "High";
	};

	type HostPrefixOptions = BaseOptions & {
		/**
		 * Limits the scope of the cookie to a secure context (HTTPS).
		 * **Requirement:** `__Host-` cookies must be Secure.
		 */
		readonly secure: true;

		/**
		 * Specifies the path that must exist in the requested URL.
		 * **Requirement:** `__Host-` cookies must use the path "/".
		 */
		readonly path?: "/";

		/**
		 * Specifies the domain for which the cookie is valid.
		 * **Requirement:** `__Host-` cookies must not have a defined domain.
		 */
		readonly domain?: never;

		/** Controls whether the cookie is sent with cross-site requests. */
		readonly sameSite?: "Lax" | "Strict" | "None";

		/** Indicates that the cookie should be stored using partitioned storage (CHIPS). */
		readonly partitioned?: boolean;
	};

	type SecurePrefixOptions = BaseOptions & {
		/**
		 * Limits the scope of the cookie to a secure context (HTTPS).
		 * **Requirement:** `__Secure-` cookies must be Secure.
		 */
		readonly secure: true;

		/** Controls whether the cookie is sent with cross-site requests. */
		readonly sameSite?: "Lax" | "Strict" | "None";

		/** Indicates that the cookie should be stored using partitioned storage (CHIPS). */
		readonly partitioned?: boolean;
	};

	type SecureOptions = BaseOptions & {
		/** Limits the scope of the cookie to a secure context (HTTPS). */
		readonly secure: true;

		/** Controls whether the cookie is sent with cross-site requests. */
		readonly sameSite?: "Lax" | "Strict" | "None";

		/** Indicates that the cookie should be stored using partitioned storage (CHIPS). */
		readonly partitioned?: boolean;
	};

	type InsecureOptions = BaseOptions & {
		/** Limits the scope of the cookie to a secure context (HTTPS). */
		readonly secure?: false;

		/**
		 * Controls whether the cookie is sent with cross-site requests.
		 * **Note:** `"none"` is not allowed unless `secure` is true.
		 */
		readonly sameSite?: "Lax" | "Strict";

		/**
		 * Indicates that the cookie should be stored using partitioned storage (CHIPS).
		 * **Note:** `true` is not allowed unless `secure` is true.
		 */
		readonly partitioned?: false;
	};

	/**
	 * Configuration options for setting a cookie.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
	 */
	export type Options<Name extends string = string> =
		Name extends `__${"host" | "secure"}-${string}`
			? never // typos
			: Name extends `__Host-${string}`
				? HostPrefixOptions
				: Name extends `__Secure-${string}`
					? SecurePrefixOptions
					: SecureOptions | InsecureOptions;
}

/** HTTP cookie manager */
export class Cookie {
	/** Current context */
	readonly #c: Context;

	/** Lazily parsed cookie map */
	#parsed?: Map<string, string>;

	/**
	 * Create a new cookie manager.
	 *
	 * @param c Request context
	 */
	constructor(c: Context) {
		this.#c = c;
	}

	/**
	 * Retrieves a specific cookie value from the request headers.
	 *
	 * @param name Name of the cookie to retrieve
	 * @returns Value of the cookie, or `undefined` if not found
	 */
	get(name: string) {
		if (this.#parsed) return this.#parsed.get(name);

		this.#parsed = new Map();

		const header = this.#c.req.headers.get("cookie") ?? "";
		const { length } = header;

		for (let cursor = 0; cursor < length; ) {
			const equal = header.indexOf("=", cursor);
			if (equal === -1) break; // done

			let semi = header.indexOf(";", cursor);
			if (semi === -1) semi = length;

			if (equal > semi) {
				// equal is in the next cookie, current is malformed
				// move the cursor to the start of the next and ignore
				cursor = header.lastIndexOf(";", equal - 1) + 1;
				continue;
			}

			const key = header.slice(cursor, equal).trim();

			if (!this.#parsed.has(key)) {
				// first cookie should take precedence

				let value = header.slice(equal + 1, semi).trim();

				if (value[0] === '"' && value[value.length - 1] === '"') {
					// remove quotes
					value = value.slice(1, -1);
				}

				if (value.includes("%")) {
					// most cookies don't need to be decoded
					try {
						// cookie must be a simple string
						value = decodeURIComponent(value);
					} catch {
						// ignore
					}
				}

				this.#parsed.set(key, value);
			}

			cursor = semi + 1;
		}

		return this.#parsed.get(name);
	}

	/**
	 * Sets a cookie on the response using the `Set-Cookie` header.
	 *
	 * @param name Name of the cookie
	 * @param value Value to store
	 * @param options Options configuration
	 */
	set<Name extends string>(
		name: Name,
		value: string,
		...[
			options,
		]: Name extends `__${"Secure" | "secure" | "Host" | "host"}-${string}`
			? [options: Cookie.Options<Name>]
			: [options?: Cookie.Options<Name>]
	) {
		options ??= {};

		const cookie = [
			`${name}=${encodeURIComponent(value)}`,
			`Path=${options.path ?? "/"}`,
		];

		if (options.secure) cookie.push("Secure");
		if (options.httpOnly) cookie.push("HttpOnly");
		if (options.partitioned) cookie.push("Partitioned");
		if (options.domain) cookie.push(`Domain=${options.domain}`);
		if (options.priority) cookie.push(`Priority=${options.priority}`);
		if (options.sameSite) cookie.push(`SameSite=${options.sameSite}`);
		if (options.maxAge !== undefined) cookie.push(`Max-Age=${options.maxAge}`);
		if (options.expires)
			cookie.push(`Expires=${options.expires.toUTCString()}`);

		this.#c.res.headers.append("set-cookie", cookie.join("; "));
	}
}
