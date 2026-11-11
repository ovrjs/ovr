import type { Context } from "../context/index.js";
import { Limit, Malformed } from "../multipart/index.js";
import { Size } from "../util/index.js";

/**
 * Auth validation issue.
 *
 * Used for non-schema auth/passkey validation failures.
 */
export class Issue extends Error {
	/**
	 * Read the body in Auth's handlers, bounded in size. A body that is too
	 * large or not form data is answered like any other failed form.
	 *
	 * @template T Parsed form data
	 * @param c Request context
	 * @returns The parsed form data, or `null` for a body the client got wrong
	 * @throws Any other error
	 */
	static async data<T>(c: {
		data: (options: { payload: number }) => Promise<T>;
	}) {
		try {
			return await c.data({ payload: 128 * Size.kb });
		} catch (error) {
			if (error instanceof Limit || error instanceof Malformed) return null;
			throw error;
		}
	}

	/**
	 * Answer a request over one of Auth's limits.
	 *
	 * @param c Request context
	 * @param seconds When to try again
	 */
	static limited(c: Pick<Context, "res" | "text">, seconds: number) {
		c.res.headers.set("retry-after", String(seconds));
		c.text("Too many authentication requests. Try again later.", 429);
	}

	/**
	 * Create a new auth issue.
	 *
	 * @param expected Expected auth value/state
	 */
	constructor(expected: string) {
		super(`Invalid ${expected}`);

		this.name = "Auth.Issue";
	}
}
