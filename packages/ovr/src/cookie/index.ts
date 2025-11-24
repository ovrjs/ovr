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
		readonly priority?: "low" | "medium" | "high";
	};

	/**
	 * Configuration options for setting a cookie.
	 *
	 * [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie)
	 */
	export type Options<Name extends string = string> = BaseOptions &
		(Name extends `__Host-${string}`
			? {
					/**
					 * Limits the scope of the cookie to a secure context (HTTPS).
					 * Required for `SameSite=None` and Partitioned cookies.
					 *
					 * **Requirement:** `__Host-` cookies must be Secure.
					 */
					readonly secure: true;

					/**
					 * Specifies the path that must exist in the requested URL for the browser
					 * to send the Cookie header.
					 *
					 * **Requirement:** `__Host-` cookies must use the path "/".
					 */
					readonly path?: "/";

					/**
					 * Specifies the domain for which the cookie is valid.
					 *
					 * **Requirement:** `__Host-` cookies must not have a defined domain.
					 */
					readonly domain?: never;

					/**
					 * Controls whether the cookie is sent with cross-site requests.
					 * - `lax`: Sent with same-site requests and top-level navigation.
					 * - `strict`: Sent only with same-site requests.
					 * - `none`: Sent with all requests (requires `secure: true`).
					 */
					readonly sameSite?: "lax" | "strict" | "none";

					/**
					 * Indicates that the cookie should be stored using partitioned storage (CHIPS).
					 * Requires `secure: true`.
					 */
					readonly partitioned?: boolean;
				}
			: Name extends `__Secure-${string}`
				? {
						/**
						 * Limits the scope of the cookie to a secure context (HTTPS).
						 * Required for `SameSite=None` and Partitioned cookies.
						 *
						 * **Requirement:** `__Secure-` cookies must be Secure.
						 */
						readonly secure: true;

						/**
						 * Controls whether the cookie is sent with cross-site requests.
						 * - `lax`: Sent with same-site requests and top-level navigation.
						 * - `strict`: Sent only with same-site requests.
						 * - `none`: Sent with all requests (requires `secure: true`).
						 */
						readonly sameSite?: "lax" | "strict" | "none";

						/**
						 * Indicates that the cookie should be stored using partitioned storage (CHIPS).
						 * Requires `secure: true`.
						 */
						readonly partitioned?: boolean;
					}
				:
						| {
								/**
								 * Limits the scope of the cookie to a secure context (HTTPS).
								 * Required for `SameSite=None` and Partitioned cookies.
								 */
								readonly secure: true;

								/**
								 * Controls whether the cookie is sent with cross-site requests.
								 * - `lax`: Sent with same-site requests and top-level navigation.
								 * - `strict`: Sent only with same-site requests.
								 * - `none`: Sent with all requests (requires `secure: true`).
								 */
								readonly sameSite?: "lax" | "strict" | "none";

								/**
								 * Indicates that the cookie should be stored using partitioned storage (CHIPS).
								 * Requires `secure: true`.
								 */
								readonly partitioned?: boolean;
						  }
						| {
								/** Limits the scope of the cookie to a secure context (HTTPS). */
								readonly secure?: false;

								/**
								 * Controls whether the cookie is sent with cross-site requests.
								 * **Note:** `"none"` is not allowed unless `secure` is true.
								 */
								readonly sameSite?: "lax" | "strict";

								/**
								 * Indicates that the cookie should be stored using partitioned storage (CHIPS).
								 * **Note:** `true` is not allowed unless `secure` is true.
								 */
								readonly partitioned?: false;
						  });
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
	 * @param args Options configuration. Required if name starts with `__Secure-` or `__Host-`.
	 */
	set<Name extends string>(
		name: Name,
		value: string,
		...[options]: Name extends `__Secure-${string}` | `__Host-${string}`
			? [options: Cookie.Options<Name>]
			: [options?: Cookie.Options<Name>]
	) {
		// Use Partial to safely handle the default empty object without casting
		options ??= {};

		const parts = [
			`${name}=${encodeURIComponent(value)}`,
			`Path=${options.path ?? "/"}`,
		];

		if (options.domain) parts.push(`Domain=${options.domain}`);
		if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
		if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
		if (options.httpOnly) parts.push("HttpOnly");
		if (options.partitioned) parts.push("Partitioned");
		if (options.secure) parts.push("Secure");
		if (options.priority) parts.push(`Priority=${options.priority}`);
		if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);

		this.#c.res.headers.append("set-cookie", parts.join("; "));
	}

	/**
	 * Invalidates a cookie by setting its max age to `0`.
	 *
	 * @param name The name of the cookie to delete.
	 * @param options Path and Domain options.
	 * These must match the options used when the cookie was originally set for the deletion to succeed.
	 */
	delete<Name extends string>(
		name: Name,
		...[options]: Name extends `__Secure-${string}` | `__Host-${string}`
			? [
					options: Omit<
						Cookie.Options<Name>,
						"maxAge" | "expires" | "priority" | "httpOnly"
					>,
				]
			: [
					options?: Omit<
						Cookie.Options<Name>,
						"maxAge" | "expires" | "priority" | "httpOnly"
					>,
				]
	) {
		this.set(
			name,
			"",
			// @ts-expect-error - tuple type
			Object.assign(options ?? {}, { maxAge: 0 }),
		);
	}
}
